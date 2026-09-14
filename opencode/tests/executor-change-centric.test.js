import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { analyzeExecutionTasks } from "../plugins/delegation/execution-preflight.js"
import { DelegationRuntime } from "../plugins/delegation/runtime.js"
import { WorkspaceManager } from "../plugins/delegation/workspace-manager.js"

const execFileAsync = promisify(execFile)

async function git(directory, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: directory, encoding: "utf8" })
  return stdout.trim()
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "executor-change-centric-test-"))
  const repository = join(root, "repository")
  await execFileAsync("git", ["init", "-b", "main", repository])
  await git(repository, ["config", "user.name", "Executor Test"])
  await git(repository, ["config", "user.email", "executor@example.invalid"])
  await writeFile(join(repository, "tracked.txt"), "baseline\n")
  await git(repository, ["add", "tracked.txt"])
  await git(repository, ["commit", "-m", "baseline"])
  t.after(async () => rm(root, { recursive: true, force: true }))
  return {
    root,
    repository,
    manager: new WorkspaceManager({ stateDirectory: join(root, "state") }),
  }
}

async function worktreeCount(repository) {
  return (await git(repository, ["worktree", "list", "--porcelain"])).split(/\n\n+/).filter(Boolean).length
}

function fakeClient() {
  return {
    session: {
      create: async () => ({ data: { id: "child" } }),
      promptAsync: async () => ({ data: undefined }),
      abort: async () => ({ data: true }),
      status: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
    },
  }
}

test("preflight reconciles dependencies and overlapping write scopes before topology", () => {
  const result = analyzeExecutionTasks([
    { task_id: "schema", description: "Update schema", write_scope: ["src/schema.sql"] },
    { task_id: "repository", description: "Update repository", dependencies: ["schema"], write_scope: ["src/repository.js"] },
    { task_id: "runtime", description: "Update runtime", dependencies: ["repository"], write_scope: ["src/runtime.js"] },
    { task_id: "tests", description: "Update tests", write_scope: ["src/runtime.test.js", "src/runtime.js"] },
    { task_id: "fixtures", description: "Use unfinished fixture", write_scope: ["test/fixtures"], requires_uncommitted: true },
  ])

  assert.equal(result.execution_mode, "serialize")
  assert.equal(result.parallel_safe, false)
  assert.deepEqual(result.dependency_edges, [
    { from: "schema", to: "repository" },
    { from: "repository", to: "runtime" },
  ])
  assert.deepEqual(result.overlap_pairs, [["runtime", "tests"]])
  assert.ok(result.tasks.find((task) => task.task_id === "runtime").serialization_reasons.includes("dependency edge"))
  assert.deepEqual(result.uncommitted_tasks, ["fixtures"])
})

test("clean main resolves a stable primary change workspace", async (t) => {
  const { repository, manager } = await fixture(t)
  const first = await manager.prepare({ change_id: "change-x", task_id: "task-a" }, repository)
  const second = await manager.prepare({ change_id: "change-x", task_id: "task-b" }, repository)

  assert.equal(first.role, "primary")
  assert.equal(first.branch, "feat/change-x")
  assert.equal(first.directory, second.directory)
  assert.equal(first.workspace_id, second.workspace_id)
  assert.equal(second.reused, true)
  assert.equal(await git(repository, ["branch", "--show-current"]), "main")
  assert.equal(await worktreeCount(repository), 2)
})

test("dirty main is preserved while the primary workspace starts elsewhere", async (t) => {
  const { repository, manager } = await fixture(t)
  const dirtyPath = join(repository, "unrelated.txt")
  await writeFile(dirtyPath, "keep this dirty\n")
  const before = await git(repository, ["status", "--porcelain=v1", "--untracked-files=all"])
  const prepared = await manager.prepare({ change_id: "new-feature", task_id: "task-main-dirty" }, repository)

  assert.notEqual(prepared.directory, repository)
  assert.equal(await git(repository, ["status", "--porcelain=v1", "--untracked-files=all"]), before)
  assert.equal(await readFile(dirtyPath, "utf8"), "keep this dirty\n")
  assert.equal(await git(prepared.directory, ["branch", "--show-current"]), "feat/new-feature")
  assert.equal(await git(prepared.directory, ["status", "--porcelain=v1", "--untracked-files=all"]), "")
})

test("a matching feature branch reuses the current dirty workspace", async (t) => {
  const { repository, manager } = await fixture(t)
  await git(repository, ["switch", "-c", "feat/current-change"])
  const dirtyPath = join(repository, "unfinished.txt")
  await writeFile(dirtyPath, "unfinished same-change work\n")
  const prepared = await manager.prepare({
    change_id: "current-change",
    task_id: "resume-task",
    dirty_ownership: "same-change",
  }, repository)

  assert.equal(prepared.directory, await realpath(repository))
  assert.equal(prepared.managed_worktree, false)
  assert.equal(prepared.branch, "feat/current-change")
  assert.equal(await readFile(dirtyPath, "utf8"), "unfinished same-change work\n")
  assert.equal(await worktreeCount(repository), 1)
})

test("unrelated dirty work on the current branch is left untouched", async (t) => {
  const { repository, manager } = await fixture(t)
  await git(repository, ["switch", "-c", "feat/unrelated-change"])
  const dirtyPath = join(repository, "unrelated.txt")
  await writeFile(dirtyPath, "do not move this\n")
  const prepared = await manager.prepare({ change_id: "target-change", task_id: "target-task" }, repository)

  assert.notEqual(prepared.directory, repository)
  assert.equal(prepared.branch, "feat/target-change")
  assert.equal(await readFile(dirtyPath, "utf8"), "do not move this\n")
  assert.match(await git(repository, ["status", "--porcelain=v1", "--untracked-files=all"]), /unrelated\.txt/)
})

test("a dirty matching branch with explicit unrelated ownership is isolated without changing it", async (t) => {
  const { repository, manager } = await fixture(t)
  await git(repository, ["switch", "-c", "feat/same-change"])
  const dirtyPath = join(repository, "unrelated.txt")
  await writeFile(dirtyPath, "preserve this work\n")
  const prepared = await manager.prepare({
    change_id: "same-change",
    task_id: "isolated-task",
    dirty_ownership: "unrelated",
  }, repository)

  assert.match(prepared.branch, /^feat\/same-change-isolated-/)
  assert.notEqual(prepared.directory, await realpath(repository))
  assert.equal(await git(repository, ["branch", "--show-current"]), "feat/same-change")
  assert.equal(await readFile(dirtyPath, "utf8"), "preserve this work\n")
  await manager.release(prepared.workspace_id, repository)
})

test("unknown ownership on a dirty matching branch fails closed", async (t) => {
  const { repository, manager } = await fixture(t)
  await git(repository, ["switch", "-c", "feat/ambiguous-change"])
  await writeFile(join(repository, "ambiguous.txt"), "do not guess\n")

  await assert.rejects(
    manager.prepare({ change_id: "ambiguous-change", task_id: "ambiguous-task" }, repository),
    /dirty; declare dirty_ownership/,
  )
  assert.match(await git(repository, ["status", "--porcelain=v1", "--untracked-files=all"]), /ambiguous\.txt/)
})

test("legacy unfinished workspace manifests resume as the logical change primary", async (t) => {
  const { root, repository, manager } = await fixture(t)
  const baseline = await git(repository, ["rev-parse", "HEAD"])
  const legacyDirectory = join(root, "legacy-worktree")
  const legacyBranch = "delegation/legacy-task-1234"
  await git(repository, ["worktree", "add", "-b", legacyBranch, legacyDirectory, baseline])
  const facts = await manager.repositoryFacts(repository)
  const manifestDirectory = join(root, "state", "manifests", facts.projectKey)
  await mkdir(manifestDirectory, { recursive: true })
  await writeFile(join(manifestDirectory, "ws_legacy.json"), JSON.stringify({
    version: 1,
    status: "active",
    workspace_id: "ws_legacy",
    task_id: "legacy-task",
    change_id: null,
    directory: await realpath(legacyDirectory),
    branch: legacyBranch,
    base_sha: baseline,
    repository_root: facts.root,
    repository_id: facts.projectKey,
    git_common_dir: facts.commonDir,
    created_at: new Date().toISOString(),
  }))

  const resumed = await manager.prepare({ change_id: "legacy-task", task_id: "legacy-task" }, repository)
  assert.equal(resumed.workspace_id, "ws_legacy")
  assert.equal(resumed.role, "primary")
  assert.equal(resumed.change_id, "legacy-task")
  assert.equal(resumed.reused, true)
  assert.equal(resumed.branch, legacyBranch)
  await manager.release(resumed.workspace_id, repository)
})

test("child workspaces require isolation evidence and release against the primary branch", async (t) => {
  const { repository, manager } = await fixture(t)
  const primary = await manager.prepare({ change_id: "parallel-change", task_id: "primary-task" }, repository)
  await writeFile(join(primary.directory, "primary.txt"), "primary\n")
  await git(primary.directory, ["add", "primary.txt"])
  await git(primary.directory, ["commit", "-m", "primary progress"])

  await assert.rejects(
    manager.prepare({
      change_id: "parallel-change",
      task_id: "child-without-reason",
      role: "child",
      parent_workspace_id: primary.workspace_id,
    }, repository),
    /concrete isolation_reason/,
  )

  const child = await manager.prepare({
    change_id: "parallel-change",
    task_id: "child-task",
    role: "child",
    parent_workspace_id: primary.workspace_id,
    isolation_reason: "independent test fixture scope",
  }, repository)
  assert.equal(child.role, "child")
  assert.equal(child.primary_workspace_id, primary.workspace_id)
  assert.equal(child.integration_target_branch, primary.branch)
  await writeFile(join(child.directory, "child.txt"), "child\n")
  await git(child.directory, ["add", "child.txt"])
  await git(child.directory, ["commit", "-m", "child progress"])
  const childCommit = await git(child.directory, ["rev-parse", "HEAD"])
  await git(primary.directory, ["cherry-pick", childCommit])

  const released = await manager.release(child.workspace_id, repository)
  assert.equal(released.status, "released")
  assert.ok(["ancestor", "patch-equivalent"].includes(released.integration))
  assert.equal(released.branch_preserved, true)
  assert.equal(await worktreeCount(repository), 2)
})

test("a child cannot be based on required uncommitted primary changes", async (t) => {
  const { repository, manager } = await fixture(t)
  const primary = await manager.prepare({ change_id: "dirty-primary", task_id: "primary-task" }, repository)
  await writeFile(join(primary.directory, "required.txt"), "required but uncommitted\n")

  await assert.rejects(
    manager.prepare({
      change_id: "dirty-primary",
      task_id: "child-task",
      role: "child",
      parent_workspace_id: primary.workspace_id,
      isolation_reason: "independent scope",
      requires_uncommitted: true,
    }, repository),
    /uncommitted changes are not shared/,
  )
})

test("a contended primary is not silently duplicated", async (t) => {
  let active = false
  const { repository, root } = await fixture(t)
  const manager = new WorkspaceManager({
    stateDirectory: join(root, "state"),
    hasActiveTasks: async () => active,
  })
  const primary = await manager.prepare({ change_id: "contended-change", task_id: "first-task" }, repository)
  active = true

  await assert.rejects(
    manager.prepare({ change_id: "contended-change", task_id: "second-task" }, repository),
    /currently in use.*isolated child/,
  )
})

test("Executor preflight is available before topology and records repository reality", async (t) => {
  const { root, repository } = await fixture(t)
  const runtime = await DelegationRuntime.create({
    client: fakeClient(),
    stateDirectory: join(root, "state"),
    categories: { quick: { description: "quick", model: "example/model" } },
  })
  const context = { sessionID: "executor", messageID: "turn", agent: "Executor", directory: repository }
  const result = await runtime.executionPreflight({
    change_id: "preflight-change",
    tasks: [
      { task_id: "a", description: "runtime", write_scope: ["src/runtime.js"] },
      { task_id: "b", description: "tests", write_scope: ["src/runtime.test.js"] },
    ],
    acceptance_criteria: ["tests pass"],
    verification: ["unit tests", "Reviewer"],
  }, context)

  assert.equal(result.repository.current.branch, "main")
  assert.equal(result.repository.current.protected, true)
  assert.equal(result.decisions.workspace_strategy, "create-primary")
  assert.equal(result.decisions.execution_mode, "parallel-candidates")
  assert.deepEqual(result.verification_strategy, ["unit tests", "Reviewer"])
  assert.equal(result.logical_change.change_id, "preflight-change")
  assert.equal(result.logical_change.acceptance_criteria[0], "tests pass")

  const workspace = await runtime.workspacePrepare({
    change_id: "preflight-change",
    task_id: "a",
  }, context)
  assert.equal(workspace.role, "primary")
  assert.equal(workspace.branch, "feat/preflight-change")
})

test("Executor implementation delegation cannot target main, while a resolved change workspace can", async (t) => {
  const { root, repository } = await fixture(t)
  const runtime = await DelegationRuntime.create({
    client: fakeClient(),
    stateDirectory: join(root, "state"),
    categories: { quick: { description: "quick", model: "example/model" } },
  })
  const context = { sessionID: "executor", messageID: "turn", agent: "Executor", directory: repository }

  await assert.rejects(runtime.delegate({
    category: "quick",
    change_id: "guarded-change",
    description: "must not edit main",
    prompt: "change tracked.txt",
    run_in_background: true,
  }, context), /cannot delegate implementation.*protected base branch main/)

  const workspace = await runtime.workspacePrepare({ change_id: "guarded-change", task_id: "task" }, context)
  const delegated = await runtime.delegate({
    workspace_id: workspace.workspace_id,
    change_id: "guarded-change",
    category: "quick",
    description: "edit primary",
    prompt: "change tracked.txt",
    run_in_background: true,
  }, context)
  assert.equal(delegated.workspace_id, workspace.workspace_id)
})

test("Git mutation permissions fail closed on protected branches", async (t) => {
  const { root, repository } = await fixture(t)
  const runtime = await DelegationRuntime.create({
    client: fakeClient(),
    stateDirectory: join(root, "state"),
    categories: { git: { description: "git", model: "example/model" } },
  })
  const context = { sessionID: "executor", messageID: "turn", agent: "Executor", directory: repository }
  const task = await runtime.registry.register({
    parent_session_id: context.sessionID,
    parent_message_id: context.messageID,
    parent_agent: context.agent,
    parent_directory: repository,
    execution_directory: repository,
    workspace_id: null,
    change_id: "protected-change",
    category: "git",
    agent: "Implementer",
    description: "commit on main",
    background: false,
  })
  await runtime.registry.start(task.task_id, { child_session_id: "git-child" })
  runtime.profiles.set("git-child", { category: "git", agent: "Implementer", tools: { bash: true } })
  const output = { status: "ask" }
  await runtime.applyPermission({
    sessionID: "git-child",
    type: "bash",
    pattern: "git commit -m forbidden",
  }, output)
  assert.equal(output.status, "deny")
})

test("runtime serializes implementation in one active primary workspace", async (t) => {
  const { root, repository } = await fixture(t)
  const runtime = await DelegationRuntime.create({
    client: fakeClient(),
    stateDirectory: join(root, "state"),
    categories: { quick: { description: "quick", model: "example/model" } },
  })
  const context = { sessionID: "executor", messageID: "turn", agent: "Executor", directory: repository }
  const workspace = await runtime.workspacePrepare({ change_id: "serialized-change", task_id: "first" }, context)
  await runtime.delegate({
    workspace_id: workspace.workspace_id,
    change_id: "serialized-change",
    category: "quick",
    description: "first implementation",
    prompt: "work",
    run_in_background: true,
  }, context)

  await assert.rejects(runtime.delegate({
    workspace_id: workspace.workspace_id,
    change_id: "serialized-change",
    category: "quick",
    description: "second implementation",
    prompt: "work concurrently",
    run_in_background: true,
  }, context), /active task; serialize.*isolated child/)
})
