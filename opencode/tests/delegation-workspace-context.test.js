import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { DelegationRuntime } from "../plugins/delegation/runtime.js"
import { WorkspaceManager } from "../plugins/delegation/workspace-manager.js"

const execFileAsync = promisify(execFile)

async function git(directory, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: directory, encoding: "utf8" })
  return stdout.trim()
}

function fakeClient() {
  const state = { creates: [] }
  return {
    state,
    session: {
      create: async (request) => {
        state.creates.push(request)
        return { data: { id: `child-${state.creates.length}` } }
      },
      promptAsync: async () => ({ data: undefined }),
      abort: async () => ({ data: true }),
      status: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
    },
  }
}

async function repositoryFixture(t, prefix = "delegation-context-test-") {
  const root = await mkdtemp(join(tmpdir(), prefix))
  const repository = join(root, "repository")
  await execFileAsync("git", ["init", "-b", "main", repository])
  await git(repository, ["config", "user.name", "Delegation Context Test"])
  await git(repository, ["config", "user.email", "delegation-context@example.invalid"])
  await writeFile(join(repository, "tracked.txt"), "baseline\n")
  await git(repository, ["add", "tracked.txt"])
  await git(repository, ["commit", "-m", "baseline"])

  let tick = 0
  const now = () => `2026-09-16T00:00:${String(++tick).padStart(2, "0")}.000Z`
  const client = fakeClient()
  const stateDirectory = join(root, "state")
  const runtime = await DelegationRuntime.create({
    client,
    stateDirectory,
    now,
    categories: {
      quick: { description: "quick route", model: "example/model" },
    },
  })
  const context = { sessionID: "executor", messageID: "turn", agent: "Executor", directory: repository }
  t.after(async () => rm(root, { recursive: true, force: true }))
  return { root, repository, stateDirectory, client, runtime, context, now }
}

test("workspace descriptions persist, refresh on same-change reuse, and do not change identity", async (t) => {
  const { root, repository, stateDirectory, client, runtime, context, now } = await repositoryFixture(t)
  const first = await runtime.workspacePrepare({
    change_id: "description-change",
    task_id: "description-task",
    description: "Primary workspace for change X",
  }, context)
  const before = await runtime.workspaces.get(first.workspace_id, { validate: false })
  const identity = {
    change_id: before.change_id,
    repository_id: before.repository_id,
    git_common_dir: before.git_common_dir,
    branch: before.branch,
    role: before.role,
    primary_workspace_id: before.primary_workspace_id,
    parent_workspace_id: before.parent_workspace_id,
  }

  const reused = await runtime.workspacePrepare({
    change_id: "description-change",
    task_id: "next-task",
    description: "Refreshed purpose for change X",
  }, context)
  assert.equal(reused.workspace_id, first.workspace_id)
  assert.equal(reused.description, "Refreshed purpose for change X")
  assert.equal(reused.latest_checkpoint, null)

  const after = await runtime.workspaces.get(first.workspace_id, { validate: false })
  assert.equal(after.description, "Refreshed purpose for change X")
  assert.deepEqual({
    change_id: after.change_id,
    repository_id: after.repository_id,
    git_common_dir: after.git_common_dir,
    branch: after.branch,
    role: after.role,
    primary_workspace_id: after.primary_workspace_id,
    parent_workspace_id: after.parent_workspace_id,
  }, identity)

  const restarted = await DelegationRuntime.create({
    client,
    stateDirectory,
    now,
    categories: { quick: { description: "quick route", model: "example/model" } },
  })
  const recovered = await restarted.workspacePrepare({
    change_id: "description-change",
    task_id: "recovered-task",
  }, context)
  assert.equal(recovered.workspace_id, first.workspace_id)
  assert.equal(recovered.description, "Refreshed purpose for change X")
  assert.equal((await restarted.workspaces.get(first.workspace_id, { validate: false })).directory, after.directory)
})

test("description never makes a different logical change eligible for reuse", async (t) => {
  const { repository, runtime } = await repositoryFixture(t)
  const changeA = await runtime.workspaces.prepare({
    change_id: "change-A",
    task_id: "task-A",
    description: "Looks like change-B",
  }, repository)
  const changeB = await runtime.workspaces.prepare({
    change_id: "change-B",
    task_id: "task-B",
    description: "Primary workspace for change B",
  }, repository)

  assert.notEqual(changeB.workspace_id, changeA.workspace_id)
  const preflight = await runtime.workspaces.preflight({ change_id: "change-B" }, repository)
  assert.equal(preflight.persisted.managed_workspaces.some((workspace) => workspace.workspace_id === changeA.workspace_id), false)
  assert.equal(preflight.recommended_primary_workspace.workspace_id, changeB.workspace_id)
})

test("Executor checkpoints require the current execution task after primary reuse", async (t) => {
  const { repository, runtime, context } = await repositoryFixture(t)
  const first = await runtime.workspacePrepare({
    change_id: "sequential-change",
    task_id: "task-1",
  }, context)
  const beforeWorktrees = await git(repository, ["worktree", "list", "--porcelain"])
  const reused = await runtime.workspacePrepare({
    change_id: "sequential-change",
    task_id: "task-2",
  }, context)
  assert.equal(reused.workspace_id, first.workspace_id)
  assert.equal(reused.change_id, first.change_id)
  assert.equal((await runtime.workspaces.get(first.workspace_id, { validate: false })).task_id, "task-1")
  assert.equal(await git(repository, ["worktree", "list", "--porcelain"]), beforeWorktrees)

  await assert.rejects(
    runtime.workspaceCheckpointUpdate({
      workspace_id: first.workspace_id,
      change_id: "sequential-change",
      status: "in_progress",
      current_focus: "Working on task-2",
    }, context),
    /requires explicit task_id.*creation task_id is not current execution identity/,
  )
  assert.equal((await runtime.workspaces.get(first.workspace_id, { validate: false })).latest_checkpoint, undefined)

  const task2 = await runtime.registry.register({
    parent_session_id: context.sessionID,
    parent_message_id: context.messageID,
    parent_agent: context.agent,
    parent_directory: await realpath(repository),
    execution_directory: first.directory,
    workspace_id: first.workspace_id,
    change_id: "sequential-change",
    category: "quick",
    agent: "Implementer",
    description: "Current task-2 execution identity",
    background: false,
  })
  await runtime.registry.start(task2.task_id, { child_session_id: "task-2-child" })
  const checkpoint = await runtime.workspaceCheckpointUpdate({
    workspace_id: first.workspace_id,
    change_id: "sequential-change",
    task_id: task2.task_id,
    status: "in_progress",
    current_focus: "Working on task-2",
  }, context)
  assert.equal(checkpoint.latest_checkpoint.task_id, task2.task_id)
  assert.notEqual(checkpoint.latest_checkpoint.task_id, "task-1")
  assert.equal(await git(repository, ["worktree", "list", "--porcelain"]), beforeWorktrees)
})

test("latest checkpoints persist, overwrite in place, and expose runtime HEAD freshness", async (t) => {
  const { repository, stateDirectory, client, runtime, context, now } = await repositoryFixture(t)
  const workspace = await runtime.workspacePrepare({
    change_id: "checkpoint-change",
    task_id: "workers-runtime",
    description: "Primary workspace for execution checkpoint recovery",
  }, context)
  const headA = await git(workspace.directory, ["rev-parse", "HEAD"])
  const first = await runtime.workspaceCheckpointUpdate({
    workspace_id: workspace.workspace_id,
    change_id: "checkpoint-change",
    task_id: "workers-runtime",
    status: "in_progress",
    current_focus: "Integrating WorkerPool with Executor runtime",
    completed: ["Implemented WorkerPool"],
    next_steps: ["Inspect Executor compatibility", "Continue integration if compatible"],
    blockers: [],
    decisions: [],
    verification: { unit_tests: "passed", integration_tests: "not_run" },
    important_files: [join(workspace.directory, "tracked.txt")],
    head_sha: "spoofed-head",
    updated_at: "spoofed-time",
  }, context)

  assert.equal(first.latest_checkpoint.task_id, "workers-runtime")
  assert.equal(first.latest_checkpoint.head_sha, headA)
  assert.notEqual(first.latest_checkpoint.updated_at, "spoofed-time")
  assert.equal(first.checkpoint_freshness, "current")
  assert.deepEqual(first.latest_checkpoint.important_files, ["tracked.txt"])

  const initialPreflight = await runtime.executionPreflight({ change_id: "checkpoint-change" }, context)
  const initialCandidate = initialPreflight.persisted.managed_workspaces.find((item) => item.workspace_id === workspace.workspace_id)
  assert.equal(initialCandidate.description, "Primary workspace for execution checkpoint recovery")
  assert.deepEqual(initialCandidate.latest_checkpoint, first.latest_checkpoint)
  assert.equal(initialCandidate.checkpoint_freshness, "current")

  await writeFile(join(workspace.directory, "unfinished.txt"), "uncommitted progress\n")
  const dirtyPreflight = await runtime.executionPreflight({ change_id: "checkpoint-change" }, context)
  const dirtyCandidate = dirtyPreflight.persisted.managed_workspaces.find((item) => item.workspace_id === workspace.workspace_id)
  assert.equal(dirtyCandidate.checkpoint_freshness, "current")
  assert.ok(dirtyCandidate.dirty_changes.some((line) => line.includes("unfinished.txt")))
  assert.ok(dirtyPreflight.repository.dirty_changes.some((line) => line.includes("unfinished.txt")))

  await git(workspace.directory, ["add", "unfinished.txt"])
  await git(workspace.directory, ["commit", "-m", "checkpoint progress"])
  const headB = await git(workspace.directory, ["rev-parse", "HEAD"])
  assert.notEqual(headA, headB)
  const stalePreflight = await runtime.executionPreflight({ change_id: "checkpoint-change" }, context)
  const staleCandidate = stalePreflight.persisted.managed_workspaces.find((item) => item.workspace_id === workspace.workspace_id)
  assert.equal(staleCandidate.checkpoint_freshness, "stale_head")

  const second = await runtime.workspaceCheckpointUpdate({
    workspace_id: workspace.workspace_id,
    change_id: "checkpoint-change",
    task_id: "workers-runtime",
    status: "blocked",
    current_focus: "Resolve WorkerPool / CompletionTracker contract",
    completed: ["Implemented WorkerPool"],
    next_steps: ["Inspect CompletionTracker assumptions", "Adjust integration approach", "Resume Executor integration"],
    blockers: ["Existing CompletionTracker assumes one group per parent session"],
    decisions: ["Keep next steps provisional until the contract is reconciled"],
    verification: { unit_tests: "passed", integration_tests: "not_run" },
    important_files: ["tracked.txt"],
  }, context)
  assert.equal(second.latest_checkpoint.status, "blocked")
  assert.equal(second.latest_checkpoint.head_sha, headB)
  assert.deepEqual(second.latest_checkpoint.next_steps, [
    "Inspect CompletionTracker assumptions",
    "Adjust integration approach",
    "Resume Executor integration",
  ])
  assert.equal(second.checkpoint_freshness, "current")

  const raw = await runtime.workspaces.get(workspace.workspace_id, { validate: false })
  assert.deepEqual(raw.latest_checkpoint, second.latest_checkpoint)
  assert.equal(Object.hasOwn(raw, "checkpoints"), false)
  assert.equal(Object.hasOwn(raw, "checkpoint_history"), false)

  const interruptedTask = await runtime.registry.register({
    parent_session_id: context.sessionID,
    parent_message_id: context.messageID,
    parent_agent: context.agent,
    parent_directory: await realpath(repository),
    execution_directory: workspace.directory,
    workspace_id: workspace.workspace_id,
    change_id: "checkpoint-change",
    category: "quick",
    agent: "Implementer",
    description: "Interrupted checkpoint recovery task",
    background: false,
  })
  await runtime.registry.start(interruptedTask.task_id, { child_session_id: "interrupted-child" })

  const restarted = await DelegationRuntime.create({
    client,
    stateDirectory,
    now,
    categories: { quick: { description: "quick route", model: "example/model" } },
  })
  const recovered = await restarted.executionPreflight({ change_id: "checkpoint-change" }, context)
  const recoveredCandidate = recovered.persisted.managed_workspaces.find((item) => item.workspace_id === workspace.workspace_id)
  assert.deepEqual(recoveredCandidate.latest_checkpoint, second.latest_checkpoint)
  assert.equal(recoveredCandidate.checkpoint_freshness, "current")
  assert.equal(recovered.persisted.tasks.some((task) => task.task_id === interruptedTask.task_id && task.status === "running"), true)
  const resumed = await restarted.workspacePrepare({
    change_id: "checkpoint-change",
    task_id: "workers-runtime",
  }, context)
  assert.equal(resumed.workspace_id, workspace.workspace_id)
})

test("Implementer checkpoint writes are restricted to its active task workspace", async (t) => {
  const { repository, runtime, context } = await repositoryFixture(t)
  const workspace = await runtime.workspacePrepare({
    change_id: "owned-change",
    task_id: "owned-primary",
  }, context)
  const delegated = await runtime.delegate({
    workspace_id: workspace.workspace_id,
    change_id: "owned-change",
    category: "quick",
    description: "Owned implementation",
    prompt: "Remain active for checkpoint ownership tests",
    run_in_background: true,
  }, context)
  const implementerContext = {
    sessionID: delegated.child_session_id,
    messageID: "child-turn",
    agent: "Implementer",
    directory: workspace.directory,
  }

  const own = await runtime.workspaceCheckpointUpdate({
    change_id: "owned-change",
    status: "in_progress",
    current_focus: "Implement the assigned change",
    next_steps: ["Run focused validation"],
  }, implementerContext)
  assert.equal(own.workspace_id, workspace.workspace_id)
  assert.equal(own.latest_checkpoint.task_id, delegated.task_id)

  const otherWorkspace = await runtime.workspacePrepare({
    change_id: "other-change",
    task_id: "other-primary",
  }, context)
  await assert.rejects(
    runtime.workspaceCheckpointUpdate({
      workspace_id: otherWorkspace.workspace_id,
      change_id: "other-change",
      status: "blocked",
      blockers: ["must not write sibling workspace"],
    }, implementerContext),
    /workspace_id must match the current task workspace/,
  )
  await assert.rejects(
    runtime.workspaceCheckpointUpdate({
      workspace_id: workspace.workspace_id,
      change_id: "other-change",
      status: "blocked",
    }, implementerContext),
    /belongs to logical change owned-change.*cannot update checkpoint for change other-change/,
  )
  await assert.rejects(
    runtime.workspaceCheckpointUpdate({
      workspace_id: workspace.workspace_id,
      task_id: "another-active-task",
      status: "blocked",
    }, implementerContext),
    /task_id must match the current task/,
  )
})

test("child checkpoints are independent and release never reactivates their manifest", async (t) => {
  const { repository, runtime, context } = await repositoryFixture(t)
  const primary = await runtime.workspacePrepare({ change_id: "child-context", task_id: "primary" }, context)
  const child = await runtime.workspacePrepare({
    change_id: "child-context",
    task_id: "child",
    role: "child",
    parent_workspace_id: primary.workspace_id,
    isolation_reason: "independent checkpoint fixture",
  }, context)

  await runtime.workspaceCheckpointUpdate({
    workspace_id: child.workspace_id,
    change_id: "child-context",
    task_id: "child",
    status: "completed",
    current_focus: "Child validation complete",
  }, context)
  assert.equal((await runtime.workspaces.get(primary.workspace_id, { validate: false })).latest_checkpoint, undefined)
  assert.equal((await runtime.workspaces.get(child.workspace_id, { validate: false })).latest_checkpoint.status, "completed")

  const released = await runtime.workspaceRelease(child.workspace_id, context)
  assert.equal(released.status, "released")
  const preserved = await runtime.workspaces.get(child.workspace_id, { validate: false })
  assert.equal(preserved.status, "released")
  assert.equal(preserved.latest_checkpoint.status, "completed")
  await assert.rejects(
    runtime.workspaceCheckpointUpdate({
      workspace_id: child.workspace_id,
      change_id: "child-context",
      status: "in_progress",
    }, context),
    /workspace is not active/,
  )
  const preflight = await runtime.executionPreflight({ change_id: "child-context" }, context)
  assert.equal(preflight.persisted.managed_workspaces.some((item) => item.workspace_id === child.workspace_id), false)
})

test("completed checkpoints do not complete task state or workflow gates", async (t) => {
  const { repository, runtime, context } = await repositoryFixture(t)
  const workspace = await runtime.workspacePrepare({
    change_id: "completed-context",
    task_id: "completed-primary",
  }, context)
  const task = await runtime.registry.register({
    parent_session_id: context.sessionID,
    parent_message_id: context.messageID,
    parent_agent: context.agent,
    parent_directory: await realpath(repository),
    execution_directory: workspace.directory,
    workspace_id: workspace.workspace_id,
    change_id: "completed-context",
    category: "quick",
    agent: "Implementer",
    description: "Task remains incomplete despite checkpoint status",
    background: false,
  })
  await runtime.registry.start(task.task_id, { child_session_id: "completed-child" })

  const checkpoint = await runtime.workspaceCheckpointUpdate({
    workspace_id: workspace.workspace_id,
    change_id: "completed-context",
    task_id: task.task_id,
    status: "completed",
    current_focus: "Implementation reached a checkpoint boundary",
  }, context)
  assert.equal(checkpoint.latest_checkpoint.status, "completed")
  assert.equal(runtime.registry.get(task.task_id).status, "running")
  assert.equal((await runtime.workspaces.get(workspace.workspace_id, { validate: false })).status, "active")
  await assert.rejects(
    runtime.workspaceRelease(workspace.workspace_id, context, {
      finalize_in_place: true,
      integration_branch: "main",
    }),
    /task still uses it/,
  )
})

test("Executor checkpoint updates keep repository provenance and change ownership hard", async (t) => {
  const { root, repository, runtime, context } = await repositoryFixture(t, "delegation-cross-repository-context-test-")
  const repositoryB = join(root, "repository-b")
  await execFileAsync("git", ["clone", "--no-local", repository, repositoryB])
  await git(repositoryB, ["config", "user.name", "Delegation Context Test"])
  await git(repositoryB, ["config", "user.email", "delegation-context@example.invalid"])
  const managerB = new WorkspaceManager({ stateDirectory: join(root, "state") })
  const foreign = await managerB.prepare({
    change_id: "foreign-change",
    task_id: "foreign-task",
  }, repositoryB)
  const foreignTask = await runtime.registry.register({
    parent_session_id: context.sessionID,
    parent_message_id: context.messageID,
    parent_agent: context.agent,
    parent_directory: await realpath(repositoryB),
    execution_directory: foreign.directory,
    workspace_id: foreign.workspace_id,
    change_id: "foreign-change",
    category: "quick",
    agent: "Implementer",
    description: "Foreign repository execution task",
    background: false,
  })
  await assert.rejects(
    runtime.workspaceCheckpointUpdate({
      workspace_id: foreign.workspace_id,
      change_id: "foreign-change",
      task_id: foreignTask.task_id,
      status: "in_progress",
    }, context),
    /workspace .*belongs to repository .*current execution context belongs to repository/,
  )

  const local = await runtime.workspacePrepare({ change_id: "local-change", task_id: "local-task" }, context)
  const otherWorkspace = await runtime.workspacePrepare({
    change_id: "other-change",
    task_id: "other-task",
  }, context)
  const otherWorkspaceTask = await runtime.registry.register({
    parent_session_id: context.sessionID,
    parent_message_id: context.messageID,
    parent_agent: context.agent,
    parent_directory: await realpath(repository),
    execution_directory: otherWorkspace.directory,
    workspace_id: otherWorkspace.workspace_id,
    change_id: "other-change",
    category: "quick",
    agent: "Implementer",
    description: "Other workspace execution task",
    background: false,
  })
  await runtime.registry.start(otherWorkspaceTask.task_id, { child_session_id: "other-workspace-child" })
  await runtime.executionPreflight({ change_id: "local-change" }, context)
  await assert.rejects(
    runtime.workspaceCheckpointUpdate({
      workspace_id: local.workspace_id,
      change_id: "local-change",
      task_id: otherWorkspaceTask.task_id,
      status: "in_progress",
    }, context),
    /belongs to workspace .*cannot update workspace/,
  )

  const otherChangeTask = await runtime.registry.register({
    parent_session_id: context.sessionID,
    parent_message_id: context.messageID,
    parent_agent: context.agent,
    parent_directory: await realpath(repository),
    execution_directory: local.directory,
    workspace_id: local.workspace_id,
    change_id: "other-change",
    category: "quick",
    agent: "Implementer",
    description: "Wrong logical change execution task",
    background: false,
  })
  await runtime.registry.start(otherChangeTask.task_id, { child_session_id: "other-change-child" })
  await assert.rejects(
    runtime.workspaceCheckpointUpdate({
      workspace_id: local.workspace_id,
      change_id: "local-change",
      task_id: otherChangeTask.task_id,
      status: "in_progress",
    }, context),
    /belongs to logical change other-change.*cannot update change local-change/,
  )
  await assert.rejects(
    runtime.workspaceCheckpointUpdate({
      workspace_id: local.workspace_id,
      change_id: "different-change",
      task_id: "unresolved-explicit-task",
      status: "in_progress",
    }, context),
    /does not match the current execution preflight change local-change/,
  )
  assert.equal((await managerB.get(foreign.workspace_id, { validate: false })).latest_checkpoint, undefined)
  assert.equal((await runtime.workspaces.get(local.workspace_id, { validate: false })).latest_checkpoint, undefined)
})

test("checkpoint metadata stays bounded", async (t) => {
  const { runtime, context } = await repositoryFixture(t)
  const workspace = await runtime.workspacePrepare({ change_id: "bounded-context", task_id: "bounded-task" }, context)
  await assert.rejects(
    runtime.workspaceCheckpointUpdate({
      workspace_id: workspace.workspace_id,
      task_id: "bounded-task",
      status: "in_progress",
      current_focus: "x".repeat(241),
    }, context),
    /at most 240 characters/,
  )
  await assert.rejects(
    runtime.workspaceCheckpointUpdate({
      workspace_id: workspace.workspace_id,
      task_id: "bounded-task",
      status: "in_progress",
      important_files: ["../outside"],
    }, context),
    /must stay within the repository/,
  )
})
