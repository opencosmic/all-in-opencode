import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { WorkspaceManager } from "../plugins/delegation/workspace-manager.js"

const execFileAsync = promisify(execFile)

async function git(directory, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: directory, encoding: "utf8" })
  return stdout.trim()
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "delegation-workspace-test-"))
  const repository = join(root, "repository")
  await execFileAsync("git", ["init", "-b", "main", repository])
  await git(repository, ["config", "user.name", "Delegation Test"])
  await git(repository, ["config", "user.email", "delegation@example.invalid"])
  await writeFile(join(repository, "tracked.txt"), "baseline\n")
  await git(repository, ["add", "tracked.txt"])
  await git(repository, ["commit", "-m", "baseline"])
  t.after(async () => rm(root, { recursive: true }))
  return {
    root,
    repository,
    manager: new WorkspaceManager({ stateDirectory: join(root, "state") }),
  }
}

test("prepare adopts a clean protected checkout as an in-place primary", async (t) => {
  const { repository, manager } = await fixture(t)
  const baseline = await git(repository, ["rev-parse", "HEAD"])
  const prepared = await manager.prepare({ task_id: "task-1" }, repository)
  assert.equal(prepared.base_sha, baseline)
  assert.match(prepared.workspace_id, /^ws_/)
  assert.equal(prepared.branch, "feat/task-1")
  assert.equal(prepared.role, "primary")
  assert.equal(prepared.directory, await realpath(repository))
  assert.equal(prepared.managed_worktree, false)
  assert.equal(await git(repository, ["branch", "--show-current"]), prepared.branch)
  assert.equal(await git(prepared.directory, ["branch", "--show-current"]), prepared.branch)
  assert.equal(await git(prepared.directory, ["rev-parse", "HEAD"]), baseline)
  assert.equal(await git(prepared.directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), prepared.git_common_dir)
  assert.equal((await git(repository, ["worktree", "list", "--porcelain"])).split(/\n\n+/).filter(Boolean).length, 1)
})

test("multiple workspaces may start from the same deterministic baseline", async (t) => {
  const { repository, manager } = await fixture(t)
  const baseline = await git(repository, ["rev-parse", "HEAD"])
  const first = await manager.prepare({ task_id: "one", base_sha: baseline }, repository)
  const second = await manager.prepare({ task_id: "two", base_sha: baseline }, repository)
  assert.notEqual(first.workspace_id, second.workspace_id)
  assert.notEqual(first.directory, second.directory)
  assert.notEqual(first.branch, second.branch)
  assert.equal(first.base_sha, second.base_sha)
  assert.equal(first.git_common_dir, second.git_common_dir)
})

test("provenance validation rejects a branch mismatch", async (t) => {
  const { repository, manager } = await fixture(t)
  const prepared = await manager.prepare({ task_id: "branch-check" }, repository)
  await git(prepared.directory, ["switch", "-c", "unexpected-branch"])
  await assert.rejects(manager.get(prepared.workspace_id), /branch mismatch/)
})

test("provenance validation rejects a forged directory", async (t) => {
  const { root, repository, manager } = await fixture(t)
  const prepared = await manager.prepare({ task_id: "path-check" }, repository)
  const found = await manager.findManifest(prepared.workspace_id)
  const manifest = JSON.parse(await readFile(found.path, "utf8"))
  manifest.directory = join(root, "not-the-managed-worktree")
  await writeFile(found.path, JSON.stringify(manifest))
  await assert.rejects(manager.get(prepared.workspace_id), /ENOENT|canonical|no such file/i)
})

test("dirty release is refused and preserves the worktree", async (t) => {
  const { repository, manager } = await fixture(t)
  const prepared = await manager.prepare({ task_id: "dirty-release" }, repository)
  await writeFile(join(prepared.directory, "untracked.txt"), "preserve me\n")
  await assert.rejects(manager.release(prepared.workspace_id), /current or externally-owned|dirty; preserving/)
  assert.equal(await readFile(join(prepared.directory, "untracked.txt"), "utf8"), "preserve me\n")
})

test("clean integrated release uses only normal removal and safe branch deletion", async (t) => {
  const { repository, manager } = await fixture(t)
  const primary = await manager.prepare({ change_id: "safe-release", task_id: "safe-primary" }, repository)
  const prepared = await manager.prepare({
    change_id: "safe-release",
    task_id: "safe-release",
    role: "child",
    parent_workspace_id: primary.workspace_id,
    isolation_reason: "exercise safe child release",
  }, repository)
  const released = await manager.release(prepared.workspace_id)
  assert.equal(released.status, "released")
  await assert.rejects(readFile(join(prepared.directory, "tracked.txt")), /ENOENT/)
  await assert.rejects(git(repository, ["show-ref", "--verify", `refs/heads/${prepared.branch}`]))

  const source = await readFile(new URL("../plugins/delegation/workspace-manager.js", import.meta.url), "utf8")
  assert.doesNotMatch(source, /worktree", "remove", "--force|branch", "-D|reset", "--hard|clean", "-/)
})

test("patch-equivalent cherry-picked work releases normally and retains its non-ancestor branch", async (t) => {
  const { repository, manager } = await fixture(t)
  const primary = await manager.prepare({ change_id: "cherry-release", task_id: "cherry-primary" }, repository)
  const prepared = await manager.prepare({
    change_id: "cherry-release",
    task_id: "cherry-release",
    role: "child",
    parent_workspace_id: primary.workspace_id,
    isolation_reason: "exercise patch-equivalent child release",
  }, repository)
  await writeFile(join(prepared.directory, "tracked.txt"), "cherry-picked\n")
  await git(prepared.directory, ["add", "tracked.txt"])
  await git(prepared.directory, ["commit", "-m", "workspace change"])
  const workspaceCommit = await git(prepared.directory, ["rev-parse", "HEAD"])
  await writeFile(join(primary.directory, "canonical.txt"), "canonical divergence\n")
  await git(primary.directory, ["add", "canonical.txt"])
  await git(primary.directory, ["commit", "-m", "canonical divergence"])
  await git(primary.directory, ["cherry-pick", workspaceCommit])

  const released = await manager.release(prepared.workspace_id)
  assert.equal(released.status, "released")
  assert.equal(released.integration, "patch-equivalent")
  assert.equal(released.branch_preserved, true)
  assert.equal(await git(repository, ["branch", "--list", prepared.branch]), `* ${prepared.branch}`.replace("* ", ""))
})

test("successful local integration finalizes an in-place primary without removing the checkout", async (t) => {
  const { repository, manager } = await fixture(t)
  const primary = await manager.prepare({ change_id: "ship-change", task_id: "ship-task" }, repository)
  await writeFile(join(primary.directory, "ship.txt"), "shipped\n")
  await git(primary.directory, ["add", "ship.txt"])
  await git(primary.directory, ["commit", "-m", "ship change"])
  await git(repository, ["switch", "main"])
  await git(repository, ["merge", "--ff-only", primary.branch])

  const finalized = await manager.release(primary.workspace_id, repository, {
    finalize_in_place: true,
    integration_branch: "main",
  })
  assert.equal(finalized.status, "finalized")
  assert.equal(finalized.canonical, false)
  assert.equal(finalized.managed_worktree, false)
  assert.equal(await git(repository, ["branch", "--show-current"]), "main")
  assert.equal(await readFile(join(repository, "ship.txt"), "utf8"), "shipped\n")
  assert.equal((await git(repository, ["worktree", "list", "--porcelain"])).split(/\n\n+/).filter(Boolean).length, 1)
  assert.equal((await manager.get(primary.workspace_id, { validate: false })).status, "finalized")
  const preflight = await manager.preflight({ change_id: "ship-change" }, repository)
  assert.deepEqual(preflight.persisted.managed_workspaces, [])
  assert.deepEqual(preflight.persisted.invalid_workspaces, [])
})

test("failed local integration preserves the in-place primary manifest", async (t) => {
  const { repository, manager } = await fixture(t)
  const primary = await manager.prepare({ change_id: "failed-ship", task_id: "failed-task" }, repository)
  await writeFile(join(primary.directory, "not-yet-shipped.txt"), "pending\n")
  await git(primary.directory, ["add", "not-yet-shipped.txt"])
  await git(primary.directory, ["commit", "-m", "pending ship"])
  await git(repository, ["switch", "main"])

  await assert.rejects(
    manager.release(primary.workspace_id, repository, {
      finalize_in_place: true,
      integration_branch: "main",
    }),
    /not integrated into main.*preserving/,
  )
  const preserved = await manager.get(primary.workspace_id, { validate: false })
  assert.equal(preserved.status, "active")
  assert.equal(preserved.canonical, true)
  assert.equal(await git(repository, ["branch", "--show-current"]), "main")
  assert.equal(await git(repository, ["branch", "--list", primary.branch]), primary.branch)
})

test("in-place primary finalization refuses active child and task ownership", async (t) => {
  const { root, repository } = await fixture(t)
  let activeWorkspaceID = null
  const manager = new WorkspaceManager({
    stateDirectory: join(root, "state"),
    hasActiveTasks: async (workspaceID) => workspaceID === activeWorkspaceID,
  })
  const primary = await manager.prepare({ change_id: "busy-ship", task_id: "busy-primary" }, repository)
  const child = await manager.prepare({
    change_id: "busy-ship",
    task_id: "busy-child",
    role: "child",
    parent_workspace_id: primary.workspace_id,
    isolation_reason: "keep a dependent child active",
  }, repository)
  await writeFile(join(primary.directory, "busy-ship.txt"), "ship\n")
  await git(primary.directory, ["add", "busy-ship.txt"])
  await git(primary.directory, ["commit", "-m", "busy ship"])
  await git(repository, ["switch", "main"])
  await git(repository, ["merge", "--ff-only", primary.branch])

  activeWorkspaceID = primary.workspace_id
  await assert.rejects(
    manager.release(primary.workspace_id, repository, {
      finalize_in_place: true,
      integration_branch: "main",
    }),
    /task still uses it/,
  )
  activeWorkspaceID = null
  await assert.rejects(
    manager.release(primary.workspace_id, repository, {
      finalize_in_place: true,
      integration_branch: "main",
    }),
    /dependent child.*active or unreleased/,
  )
  assert.equal((await manager.get(primary.workspace_id, { validate: false })).status, "active")
  assert.equal((await manager.get(child.workspace_id, { validate: false })).primary_workspace_id, primary.workspace_id)
})
