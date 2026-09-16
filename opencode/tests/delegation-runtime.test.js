import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { DelegationRuntime } from "../plugins/delegation/runtime.js"
import { SkillResolver } from "../plugins/delegation/skill-resolver.js"
import { WorkspaceManager } from "../plugins/delegation/workspace-manager.js"

const execFileAsync = promisify(execFile)

async function git(directory, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: directory, encoding: "utf8" })
  return stdout.trim()
}

function fakeClient() {
  const state = {
    creates: [],
    prompts: [],
    aborts: [],
    statuses: {},
    messages: {},
    createThrows: 0,
    promptFailures: 0,
    promptThrows: 0,
    parentPromptThrows: 0,
  }
  return {
    state,
    session: {
      create: async (request) => {
        state.creates.push(request)
        if (state.createThrows-- > 0) throw new Error("session creation failed")
        return { data: { id: `child-${state.creates.length}` } }
      },
      promptAsync: async (request) => {
        state.prompts.push(request)
        if (request.path.id === "parent" && state.parentPromptThrows-- > 0) {
          throw new Error("parent notification failed")
        }
        if (request.path.id.startsWith("child-") && state.promptThrows-- > 0) {
          throw new Error("transport disconnected")
        }
        if (request.path.id.startsWith("child-") && state.promptFailures-- > 0) {
          return { error: { data: { message: "model unavailable" } } }
        }
        return { data: undefined }
      },
      abort: async (request) => {
        state.aborts.push(request)
        return { data: true }
      },
      status: async () => ({ data: state.statuses }),
      messages: async (request) => ({ data: state.messages[request.path.id] ?? [] }),
    },
  }
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "delegation-runtime-test-"))
  const repository = join(root, "repository")
  await execFileAsync("git", ["init", "-b", "main", repository])
  await git(repository, ["config", "user.name", "Delegation Test"])
  await git(repository, ["config", "user.email", "delegation@example.invalid"])
  await writeFile(join(repository, "tracked.txt"), "baseline\n")
  await git(repository, ["add", "tracked.txt"])
  await git(repository, ["commit", "-m", "baseline"])
  const client = fakeClient()
  const runtime = await DelegationRuntime.create({
    client,
    stateDirectory: join(root, "state"),
    categories: {
      test: {
        description: "test route",
        model: "example/primary",
        variant: "focused",
        tools: { delegate_task: false },
        prompt_append: "append",
      },
      bounded: {
        description: "prompt admission fixture",
        model: "example/primary",
      },
    },
  })
  const context = { sessionID: "parent", messageID: "parent-turn", agent: "Assistant", directory: repository }
  t.after(async () => {
    await new Promise((resolve) => setImmediate(resolve))
    await rm(root, { recursive: true })
  })
  return { root, repository, client, runtime, context }
}

async function crossRepositoryFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "delegation-cross-repository-test-"))
  const repositoryA = join(root, "repository-a")
  const repositoryB = join(root, "repository-b")
  await execFileAsync("git", ["init", "-b", "main", repositoryA])
  await git(repositoryA, ["config", "user.name", "Delegation Test"])
  await git(repositoryA, ["config", "user.email", "delegation@example.invalid"])
  await writeFile(join(repositoryA, "tracked.txt"), "baseline\n")
  await git(repositoryA, ["add", "tracked.txt"])
  await git(repositoryA, ["commit", "-m", "baseline"])
  await execFileAsync("git", ["clone", "--no-local", repositoryA, repositoryB])
  await git(repositoryB, ["config", "user.name", "Delegation Test"])
  await git(repositoryB, ["config", "user.email", "delegation@example.invalid"])
  const client = fakeClient()
  const stateDirectory = join(root, "state")
  const runtime = await DelegationRuntime.create({
    client,
    stateDirectory,
    categories: {
      test: {
        description: "test route",
        model: "example/primary",
        variant: "focused",
        tools: { delegate_task: false },
      },
    },
  })
  const context = { sessionID: "parent", messageID: "parent-turn", agent: "Executor", directory: repositoryA }
  t.after(async () => rm(root, { recursive: true, force: true }))
  return {
    root,
    repositoryA,
    repositoryB,
    client,
    runtime,
    context,
    managerB: new WorkspaceManager({ stateDirectory }),
  }
}

test("category delegation routes to Implementer with parent and managed workspace binding", async (t) => {
  const { repository, client, runtime, context } = await fixture(t)
  const workspace = await runtime.workspacePrepare({ task_id: "implementation" }, context)
  const result = await runtime.delegate({
    workspace_id: workspace.workspace_id,
    category: "test",
    description: "Implement fixture",
    prompt: "Change tracked.txt",
    run_in_background: true,
  }, { ...context, agent: "Executor" })
  assert.equal(result.status, "running")
  assert.equal((await runtime.taskStatus(result.task_id, context)).parent_agent, "Executor")
  assert.equal(client.state.creates[0].body.parentID, "parent")
  assert.equal(client.state.creates[0].body.permission, undefined)
  assert.equal(client.state.creates[0].query.directory, workspace.directory)
  assert.equal(client.state.prompts[0].query.directory, workspace.directory)
  assert.equal(client.state.prompts[0].body.agent, "Implementer")
  assert.deepEqual(client.state.prompts[0].body.model, { providerID: "example", modelID: "primary" })
  assert.equal(client.state.prompts[0].body.model.variant, undefined)
  assert.equal(client.state.prompts[0].body.variant, "focused")
  assert.equal(client.state.prompts[0].body.tools.delegate_task, false)
  assert.equal(client.state.prompts[0].body.tools.workspace_prepare, false)
  assert.equal(client.state.prompts[0].body.tools.task, false)
  assert.equal(Object.hasOwn(client.state.prompts[0].body.tools, "call_omo_agent"), false)
  assert.match(client.state.prompts[0].body.system, /append/)
  assert.doesNotMatch(client.state.prompts[0].body.parts[0].text, /append/)
  const params = {}
  runtime.applyChatParams(result.child_session_id, params)
  assert.deepEqual(params, {})
  assert.equal(workspace.directory, await realpath(repository))
})

test("category without a variant sends only the model reference", async (t) => {
  const { client, runtime, context } = await fixture(t)
  await runtime.delegate({
    category: "bounded",
    description: "Model-only fixture",
    prompt: "Inspect only",
    run_in_background: true,
  }, context)
  assert.deepEqual(client.state.prompts[0].body.model, { providerID: "example", modelID: "primary" })
  assert.equal(Object.hasOwn(client.state.prompts[0].body, "variant"), false)
})

test("ordinary delegation works outside Git while workspace operations stay Git-only", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "delegation-runtime-non-git-test-"))
  const directory = join(root, "directory")
  const stateDirectory = join(root, "state")
  await mkdir(directory)
  const client = fakeClient()
  const runtime = await DelegationRuntime.create({
    client,
    stateDirectory,
    directory,
    skillEntries: [],
    categories: { quick: { description: "quick route", model: "example/primary" } },
  })
  const context = { sessionID: "parent", messageID: "turn", agent: "Assistant", directory }
  t.after(async () => rm(root, { recursive: true }))

  const result = await runtime.delegate({
    category: "quick",
    description: "Delegate from a plain directory",
    prompt: "Inspect the current directory",
    run_in_background: true,
  }, context)
  assert.equal(result.status, "running")
  assert.equal(client.state.creates[0].query.directory, await realpath(directory))
  assert.equal(client.state.prompts[0].body.agent, "Implementer")
  assert.deepEqual((await runtime.taskStatus(undefined, context)).preserved_workspaces, [])
  await assert.rejects(
    runtime.workspacePrepare({ task_id: "non-git-workspace" }, context),
    /workspace_prepare requires a Git repository.*not inside a Git worktree/,
  )
  await assert.rejects(
    runtime.workspaceRelease("ws_missing", context),
    /workspace_release requires a Git repository.*not inside a Git worktree/,
  )
})

test("category profiles are shared across per-worktree plugin instances", async (t) => {
  const { root, client, runtime, context } = await fixture(t)
  const result = await runtime.delegate({
    category: "test",
    description: "Cross-instance permission fixture",
    prompt: "Inspect only",
    run_in_background: true,
  }, context)
  const sibling = await DelegationRuntime.create({
    client,
    stateDirectory: join(root, "state"),
    categories: {
      test: { description: "test route", model: "example/primary" },
    },
  })
  sibling.profiles.delete(result.child_session_id)
  const output = { status: "ask" }
  await sibling.applyPermission({
    sessionID: result.child_session_id,
    permission: "bash",
    patterns: ["git commit -m forbidden-outside-git-category"],
    metadata: { command: "git commit -m forbidden-outside-git-category" },
  }, output)
  assert.equal(output.status, "deny")
})

test("delegation injects only explicitly selected skill contents", async (t) => {
  const { client, runtime, context } = await fixture(t)
  runtime.skills = new SkillResolver({ entries: [
    { name: "foo", description: "Foo", content: "FOO SKILL CONTENT" },
    { name: "bar", description: "Bar", content: "BAR SKILL CONTENT" },
  ] })
  await runtime.delegate({
    category: "test",
    load_skills: ["foo"],
    description: "Skill fixture",
    prompt: "Inspect only",
    run_in_background: true,
  }, context)
  assert.match(client.state.prompts[0].body.system, /FOO SKILL CONTENT/)
  assert.doesNotMatch(client.state.prompts[0].body.system, /BAR SKILL CONTENT/)
  await assert.rejects(runtime.delegate({
    category: "test",
    load_skills: ["missing"],
    description: "Unknown skill",
    prompt: "Fail closed",
    run_in_background: true,
  }, context), /unknown skill.*missing/)
})

test("video analysis composes the shared Implementer, category context, and watch location", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const skillPath = "/Users/example/.agents/skills/watch/SKILL.md"
  runtime.skills = new SkillResolver({ entries: [{
    name: "watch",
    description: "Watch videos",
    path: skillPath,
    content: "WATCH SKILL CONTENT",
  }] })
  await runtime.delegate({
    category: "video-analysis",
    load_skills: ["watch"],
    description: "Analyze video",
    prompt: "Explain the opening hook",
    run_in_background: true,
  }, context)
  const created = client.state.creates[0]
  const prompt = client.state.prompts[0]
  assert.equal(prompt.body.agent, "Implementer")
  assert.match(prompt.body.system, /project-owned Implementer/)
  assert.match(prompt.body.system, /<Category_Context name="video-analysis">/)
  assert.match(prompt.body.system, /WATCH SKILL CONTENT/)
  assert.match(prompt.body.system, new RegExp(skillPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.ok(created.body.permission.some((rule) =>
    rule.permission === "skill" && rule.pattern === "watch" && rule.action === "allow"))
  assert.ok(created.body.permission.some((rule) =>
    rule.permission === "bash" && rule.pattern.includes("scripts/watch.py") && rule.action === "allow"))
})

test("workspace references in prompts must be bound by the workspace_id argument", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const workspace = await runtime.workspacePrepare({ task_id: "bound-workspace" }, context)
  await assert.rejects(runtime.delegate({
    category: "test",
    description: "Implement in isolated workspace",
    prompt: `Use ${workspace.workspace_id}`,
    run_in_background: true,
  }, context), /workspace_id was omitted/)
  assert.equal(client.state.creates.length, 0)

  await assert.rejects(runtime.delegate({
    workspace_id: workspace.workspace_id,
    category: "test",
    description: "Implement in isolated workspace",
    prompt: "Use ws_00000000-0000-0000-0000-000000000000",
    run_in_background: true,
  }, context), /does not match workspace_id/)
  assert.equal(client.state.creates.length, 0)
})

test("delegate_task rejects mixed workspace and change ownership before registry writes", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const workspace = await runtime.workspacePrepare({ change_id: "change-a", task_id: "primary" }, context)

  await assert.rejects(
    runtime.delegate({
      workspace_id: workspace.workspace_id,
      change_id: "change-b",
      category: "test",
      description: "Mixed ownership",
      prompt: "Do not run",
      run_in_background: true,
    }, context),
    /workspace .*belongs to logical change change-a.*cannot delegate change change-b/,
  )
  assert.equal(client.state.creates.length, 0)
  assert.deepEqual(runtime.registry.list(), [])
  assert.equal((await runtime.workspaces.get(workspace.workspace_id, { validate: false })).change_id, "change-a")

  const matched = await runtime.delegate({
    workspace_id: workspace.workspace_id,
    change_id: "change-a",
    category: "test",
    description: "Matching ownership",
    prompt: "Proceed",
    run_in_background: true,
  }, context)
  assert.equal(matched.status, "running")
  assert.equal(runtime.registry.get(matched.task_id).change_id, "change-a")
  assert.equal(runtime.registry.get(matched.task_id).workspace_id, workspace.workspace_id)
})

test("delegate_task infers change ownership from an explicit managed workspace", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const workspace = await runtime.workspacePrepare({ change_id: "inferred-change", task_id: "primary" }, context)

  const delegated = await runtime.delegate({
    workspace_id: workspace.workspace_id,
    category: "test",
    description: "Inferred ownership",
    prompt: "Proceed",
    run_in_background: true,
  }, context)
  assert.equal(delegated.status, "running")
  assert.equal(runtime.registry.get(delegated.task_id).change_id, "inferred-change")
  assert.equal(runtime.registry.get(delegated.task_id).workspace_id, workspace.workspace_id)
  assert.equal(client.state.creates.length, 1)
})

test("delegate_task rejects a workspace from another repository before registry writes", async (t) => {
  const { client, runtime, context, repositoryB, managerB } = await crossRepositoryFixture(t)
  const workspace = await managerB.prepare({ change_id: "cross-repository", task_id: "repo-b-primary" }, repositoryB)
  const before = await managerB.get(workspace.workspace_id, { validate: false })

  await assert.rejects(
    runtime.delegate({
      workspace_id: workspace.workspace_id,
      change_id: workspace.change_id,
      category: "test",
      description: "Foreign repository delegation",
      prompt: "Do not run",
      run_in_background: true,
    }, context),
    /delegate_task workspace .*belongs to repository .*current execution context belongs to repository/,
  )
  assert.equal(runtime.preflights.size, 0)
  assert.deepEqual(runtime.registry.list(), [])
  assert.equal(client.state.creates.length, 0)
  assert.deepEqual(await managerB.get(workspace.workspace_id, { validate: false }), before)
})

test("workspace_release rejects a workspace from another repository before removal", async (t) => {
  const { runtime, context, repositoryB, managerB } = await crossRepositoryFixture(t)
  const primary = await managerB.prepare({ change_id: "cross-release", task_id: "repo-b-primary" }, repositoryB)
  const child = await managerB.prepare({
    change_id: "cross-release",
    task_id: "repo-b-child",
    role: "child",
    parent_workspace_id: primary.workspace_id,
    isolation_reason: "foreign release",
  }, repositoryB)
  const before = await managerB.get(child.workspace_id, { validate: false })
  const beforeWorktrees = await git(repositoryB, ["worktree", "list", "--porcelain"])

  await assert.rejects(
    runtime.workspaceRelease(child.workspace_id, context),
    /workspace_release workspace .*belongs to repository .*current execution context belongs to repository/,
  )
  assert.equal(await realpath(child.directory), child.directory)
  assert.deepEqual(await managerB.get(child.workspace_id, { validate: false }), before)
  assert.equal(await git(repositoryB, ["worktree", "list", "--porcelain"]), beforeWorktrees)
})

test("workspace_prepare rejects a child parent from another repository before creation", async (t) => {
  const { runtime, context, repositoryA, repositoryB, managerB } = await crossRepositoryFixture(t)
  const primary = await managerB.prepare({ change_id: "cross-child", task_id: "repo-b-primary" }, repositoryB)
  const beforeWorktrees = await git(repositoryA, ["worktree", "list", "--porcelain"])

  await assert.rejects(
    runtime.workspacePrepare({
      change_id: "cross-child",
      task_id: "repo-a-child",
      role: "child",
      parent_workspace_id: primary.workspace_id,
      isolation_reason: "foreign parent",
    }, context),
    /workspace_prepare workspace .*belongs to repository .*current execution context belongs to repository/,
  )
  assert.deepEqual(await runtime.workspaces.listManifests(repositoryA), [])
  assert.equal(await git(repositoryA, ["worktree", "list", "--porcelain"]), beforeWorktrees)
  assert.equal((await managerB.get(primary.workspace_id, { validate: false })).status, "active")
})

test("allowlisted specialists use the same child session runner and current workspace", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const workspace = await runtime.workspacePrepare({ task_id: "review-target" }, context)
  for (const agent of ["Explorer", "Librarian", "Technical Advisor", "Plan Reviewer", "Reviewer", "QA"]) {
    await runtime.delegate({
      workspace_id: workspace.workspace_id,
      agent,
      description: `${agent} fixture`,
      prompt: "Inspect only",
      run_in_background: true,
    }, context)
  }
  assert.deepEqual(client.state.prompts.map((call) => call.body.agent), [
    "Explorer", "Librarian", "Technical Advisor", "Plan Reviewer", "Reviewer", "QA",
  ])
  assert.ok(client.state.creates.every((call) => call.query.directory === workspace.directory))
  assert.ok(client.state.creates.every((call) => call.body.parentID === "parent"))
})

test("stage-specific parents use only their contract collaborators", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const strategist = { ...context, sessionID: "strategist", messageID: "strategist-turn", agent: "Strategist" }
  const planner = { ...context, sessionID: "planner", messageID: "planner-turn", agent: "Planner" }

  await assert.rejects(runtime.delegate({
    category: "test",
    description: "Strategist must not implement",
    prompt: "Do not run",
    run_in_background: true,
  }, strategist), /Strategist.*category routes are not allowed/)
  await assert.rejects(runtime.delegate({
    category: "test",
    description: "Planner must not implement",
    prompt: "Do not run",
    run_in_background: true,
  }, planner), /Planner.*category routes are not allowed/)

  const research = await runtime.delegate({
    agent: "Researcher",
    description: "Strategist consultation",
    prompt: "Inspect the product evidence.",
    run_in_background: true,
  }, strategist)
  const advice = await runtime.delegate({
    agent: "Technical Advisor",
    description: "Planner consultation",
    prompt: "Inspect the technical tradeoff.",
    run_in_background: true,
  }, planner)

  assert.equal(runtime.registry.get(research.task_id).agent, "Researcher")
  assert.equal(runtime.registry.get(advice.task_id).agent, "Technical Advisor")
  assert.deepEqual(client.state.prompts.map((call) => call.body.agent), ["Researcher", "Technical Advisor"])
})

test("Executor can route every declared review and verification handoff", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const executor = { ...context, agent: "Executor" }
  const workspace = await runtime.workspacePrepare({
    change_id: "handoff-contract",
    task_id: "handoff-primary",
  }, executor)
  const shipCommand = await readFile(new URL("../commands/ship.md", import.meta.url), "utf8")
  assert.match(shipCommand, /ALWAYS dispatch a new `Verifier`/)

  const agents = ["Plan Reviewer", "Reviewer", "QA", "Verifier"]
  const results = []
  for (const agent of agents) {
    results.push(await runtime.delegate({
      workspace_id: workspace.workspace_id,
      change_id: "handoff-contract",
      agent,
      description: `${agent} handoff contract`,
      prompt: "Inspect the current change.",
      run_in_background: true,
    }, executor))
  }

  assert.deepEqual(results.map((result) => runtime.registry.get(result.task_id).agent), agents)
  assert.deepEqual(client.state.prompts.map((call) => call.body.agent), agents)
})

test("configured model failure is surfaced without fallback", async (t) => {
  const { client, runtime, context } = await fixture(t)
  client.state.promptFailures = 1
  await assert.rejects(runtime.delegate({
    category: "test",
    description: "No fallback fixture",
    prompt: "No mutation",
    run_in_background: true,
  }, context), /configured model example\/primary failed.*model unavailable/)
  assert.equal(client.state.prompts.length, 1)
  const [task] = (await runtime.taskStatus(undefined, context)).tasks
  assert.equal(task.model, "example/primary")
  assert.equal(task.status, "error")
})

test("prompt transport failure surfaces without fallback", async (t) => {
  const { client, runtime, context } = await fixture(t)
  client.state.promptThrows = 1
  await assert.rejects(runtime.delegate({
    category: "test",
    description: "Uncertain acceptance",
    prompt: "Do not retry",
    run_in_background: true,
  }, context), /configured model example\/primary failed before child turn acceptance/)
  assert.equal(client.state.prompts.length, 1)
  const tasks = (await runtime.taskStatus(undefined, context)).tasks
  assert.equal(tasks[0].status, "error")
})

test("model startup failure terminalizes its task and releases the workspace activity guard", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const primary = await runtime.workspacePrepare({
    change_id: "prompt-admission",
    task_id: "prompt-admission-primary",
  }, context)
  const workspace = await runtime.workspacePrepare({
    change_id: "prompt-admission",
    task_id: "prompt-admission",
    role: "child",
    parent_workspace_id: primary.workspace_id,
    isolation_reason: "exercise child startup failure cleanup",
  }, context)
  client.state.promptFailures = 1
  await assert.rejects(runtime.delegate({
    workspace_id: workspace.workspace_id,
    category: "bounded",
    description: "Model unavailable",
    prompt: "The configured model is unavailable.",
    run_in_background: true,
  }, context), /configured model example\/primary failed/)

  const [task] = (await runtime.taskStatus(undefined, context)).tasks
  assert.equal(task.status, "error")
  assert.equal(task.workspace_id, workspace.workspace_id)
  assert.equal(task.child_session_id, "child-1")
  assert.match(task.error, /configured model example\/primary failed/)
  assert.equal(runtime.registry.hasActiveWorkspace(workspace.workspace_id), false)
  client.state.statuses.parent = { type: "idle" }
  await runtime.handleEvent({ type: "session.idle", properties: { sessionID: "parent" } })
  assert.equal(client.state.prompts.filter((request) => request.path.id === "parent").length, 1)
  assert.equal((await runtime.workspaceRelease(workspace.workspace_id)).status, "released")
  assert.equal(client.state.creates.length, 1)
})

test("session creation failure terminalizes the registered task with startup evidence", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const workspace = await runtime.workspacePrepare({ task_id: "session-create" }, context)
  client.state.createThrows = 1
  await assert.rejects(runtime.delegate({
    workspace_id: workspace.workspace_id,
    category: "test",
    description: "Create failure",
    prompt: "Never accepted",
    run_in_background: true,
  }, context), /session creation failed/)

  const [task] = (await runtime.taskStatus(undefined, context)).tasks
  assert.equal(task.status, "error")
  assert.equal(task.child_session_id, null)
  assert.equal(task.workspace_id, workspace.workspace_id)
  assert.equal(task.category, "test")
  assert.equal(task.agent, "Implementer")
  assert.match(task.error, /delegation startup failed: session creation failed/)
  assert.equal(runtime.registry.hasActiveWorkspace(workspace.workspace_id), false)
})

test("parent notification failure cannot undo child completion or block its waiter", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const delegated = await runtime.delegate({
    category: "test",
    description: "Notification failure",
    prompt: "Complete locally",
    run_in_background: true,
  }, context)
  const child = delegated.child_session_id
  const user = { id: "notification-user", sessionID: child, role: "user", time: { created: Date.now() + 1 } }
  const assistant = {
    id: "notification-assistant",
    sessionID: child,
    role: "assistant",
    parentID: user.id,
    time: { created: Date.now() + 2, completed: Date.now() + 3 },
    finish: "stop",
  }
  const part = {
    id: "notification-text",
    sessionID: child,
    messageID: assistant.id,
    type: "text",
    text: "child completed",
  }
  client.state.statuses.parent = { type: "idle" }
  await runtime.handleEvent({ type: "session.idle", properties: { sessionID: "parent" } })
  client.state.parentPromptThrows = 1
  client.state.statuses[child] = { type: "idle" }
  client.state.messages[child] = [{ info: user, parts: [] }, { info: assistant, parts: [part] }]
  const waiting = runtime.tracker.wait(delegated.task_id)

  await runtime.handleEvent({
    type: "session.status",
    properties: { sessionID: child, status: { type: "idle" } },
  })

  assert.equal((await waiting).status, "completed")
  assert.equal((await runtime.taskStatus(delegated.task_id, context)).status, "completed")
  assert.equal(runtime.registry.group(delegated.completion_group).delivery_state, "pending")
  assert.equal(client.state.prompts.filter((request) => request.path.id === "parent").length, 1)
})

test("session.idle remains authoritative when the status list omits the child", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const delegated = await runtime.delegate({
    category: "test",
    description: "Omitted idle status",
    prompt: "Complete locally",
    run_in_background: true,
  }, context)
  const child = delegated.child_session_id
  const user = { id: "idle-user", sessionID: child, role: "user", time: { created: Date.now() + 1 } }
  const assistant = {
    id: "idle-assistant",
    sessionID: child,
    role: "assistant",
    parentID: user.id,
    time: { created: Date.now() + 2, completed: Date.now() + 3 },
    finish: "stop",
  }
  client.state.messages[child] = [{ info: user, parts: [] }, { info: assistant, parts: [] }]

  await runtime.handleEvent({ type: "session.idle", properties: { sessionID: child } })

  const task = await runtime.taskStatus(delegated.task_id, context)
  assert.equal(Object.hasOwn(client.state.statuses, child), false)
  assert.equal(task.status, "completed")
  assert.ok(task.completed_at)
})

test("an omitted status without session.idle evidence stays running", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const delegated = await runtime.delegate({
    category: "test",
    description: "Unknown omitted status",
    prompt: "Do not infer idle",
    run_in_background: true,
  }, context)
  const child = delegated.child_session_id
  const user = { id: "unknown-user", sessionID: child, role: "user", time: { created: Date.now() + 1 } }
  const assistant = {
    id: "unknown-assistant",
    sessionID: child,
    role: "assistant",
    parentID: user.id,
    time: { created: Date.now() + 2, completed: Date.now() + 3 },
    finish: "stop",
  }
  client.state.messages[child] = [{ info: user, parts: [] }, { info: assistant, parts: [] }]

  await runtime.runner.observeTask(delegated.task_id)

  assert.equal(Object.hasOwn(client.state.statuses, child), false)
  assert.equal((await runtime.taskStatus(delegated.task_id, context)).status, "running")
})

test("foreground delegation waits for a fresh terminal child turn", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const originalPrompt = client.session.promptAsync
  client.session.promptAsync = async (request) => {
    const response = await originalPrompt(request)
    if (request.path.id.startsWith("child-")) {
      setTimeout(async () => {
        const child = request.path.id
        const user = { id: "user-current", sessionID: child, role: "user", time: { created: Date.now() + 1 } }
        const assistant = {
          id: "assistant-current", sessionID: child, role: "assistant", parentID: user.id,
          time: { created: Date.now() + 2, completed: Date.now() + 3 }, finish: "stop",
        }
        const part = { id: "text-current", sessionID: child, messageID: assistant.id, type: "text", text: "implemented" }
        await runtime.handleEvent({ type: "message.updated", properties: { info: user } })
        await runtime.handleEvent({ type: "message.updated", properties: { info: assistant } })
        await runtime.handleEvent({ type: "message.part.updated", properties: { part } })
        client.state.statuses[child] = { type: "idle" }
        client.state.messages[child] = [{ info: user, parts: [] }, { info: assistant, parts: [part] }]
        await runtime.handleEvent({ type: "session.status", properties: { sessionID: child, status: { type: "idle" } } })
      }, 0)
    }
    return response
  }
  const result = await runtime.delegate({
    category: "test",
    description: "Foreground fixture",
    prompt: "Complete",
  }, context)
  assert.equal(result.status, "completed")
  assert.equal(result.result.text, "implemented")
})

test("task_cancel aborts the correct child and preserves its workspace", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const workspace = await runtime.workspacePrepare({ task_id: "cancel" }, context)
  await writeFile(join(workspace.directory, "evidence.txt"), "keep\n")
  const delegated = await runtime.delegate({
    workspace_id: workspace.workspace_id,
    category: "test",
    description: "Cancelable",
    prompt: "Wait",
    run_in_background: true,
  }, context)
  const cancelled = await runtime.taskCancel(delegated.task_id)
  assert.equal(cancelled.status, "cancelled")
  assert.equal(client.state.aborts[0].path.id, delegated.child_session_id)
  assert.equal(await readFile(join(workspace.directory, "evidence.txt"), "utf8"), "keep\n")
  const duplicate = await runtime.taskCancel(delegated.task_id)
  assert.equal(duplicate.status, "cancelled")
  assert.equal(client.state.aborts.length, 1)
})

test("restart surfaces persisted tasks and surviving managed workspaces without guessing completion", async (t) => {
  const { root, client, runtime, context } = await fixture(t)
  const workspace = await runtime.workspacePrepare({ task_id: "recovery" }, context)
  const delegated = await runtime.delegate({
    workspace_id: workspace.workspace_id,
    category: "test",
    description: "Recovery fixture",
    prompt: "Remain running",
    run_in_background: true,
  }, context)

  const restarted = await DelegationRuntime.create({
    client,
    stateDirectory: join(root, "state"),
    categories: {
      test: { description: "test route", model: "example/primary" },
    },
  })
  assert.equal((await restarted.taskStatus(delegated.task_id, context)).status, "running")
  const recovery = await restarted.taskStatus(undefined, context)
  assert.equal(recovery.preserved_workspaces[0].workspace_id, workspace.workspace_id)
  assert.equal(recovery.preserved_workspaces[0].status, "active")
  assert.equal((await restarted.taskCancel(delegated.task_id)).status, "cancelled")
})
