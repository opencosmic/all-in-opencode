import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { DelegationRuntime } from "../plugins/delegation/runtime.js"

const execFileAsync = promisify(execFile)

async function git(directory, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: directory, encoding: "utf8" })
  return stdout.trim()
}

function fakeClient() {
  const state = { creates: [], prompts: [], aborts: [], statuses: {}, messages: {}, promptFailures: 0, promptThrows: 0 }
  return {
    state,
    session: {
      create: async (request) => {
        state.creates.push(request)
        return { data: { id: `child-${state.creates.length}` } }
      },
      promptAsync: async (request) => {
        state.prompts.push(request)
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
        models: [{ model: "example/primary" }, { model: "example/fallback" }],
        temperature: 0.2,
        top_p: 0.8,
        max_tokens: 1200,
        tools: { delegate_task: false },
        prompt_append: "append",
      },
    },
  })
  const context = { sessionID: "parent", messageID: "parent-turn", agent: "Executor", directory: repository }
  t.after(async () => {
    await new Promise((resolve) => setImmediate(resolve))
    await rm(root, { recursive: true })
  })
  return { root, repository, client, runtime, context }
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
  }, context)
  assert.equal(result.status, "running")
  assert.equal((await runtime.taskStatus(result.task_id, context)).parent_agent, "Executor")
  assert.equal(client.state.creates[0].body.parentID, "parent")
  assert.equal(client.state.creates[0].query.directory, workspace.directory)
  assert.equal(client.state.prompts[0].query.directory, workspace.directory)
  assert.equal(client.state.prompts[0].body.agent, "Implementer")
  assert.deepEqual(client.state.prompts[0].body.model, { providerID: "example", modelID: "primary" })
  assert.equal(client.state.prompts[0].body.tools.delegate_task, false)
  assert.equal(client.state.prompts[0].body.tools.workspace_prepare, false)
  assert.equal(client.state.prompts[0].body.tools.task, false)
  assert.equal(client.state.prompts[0].body.tools.call_omo_agent, false)
  assert.match(client.state.prompts[0].body.parts[0].text, /append/)
  const params = {}
  runtime.applyChatParams(result.child_session_id, params)
  assert.deepEqual(params, { temperature: 0.2, topP: 0.8, maxOutputTokens: 1200 })
  assert.notEqual(workspace.directory, repository)
})

test("named Reviewer and QA use the same child session runner and current workspace", async (t) => {
  const { client, runtime, context } = await fixture(t)
  const workspace = await runtime.workspacePrepare({ task_id: "review-target" }, context)
  for (const agent of ["Reviewer", "QA"]) {
    await runtime.delegate({
      workspace_id: workspace.workspace_id,
      agent,
      description: `${agent} fixture`,
      prompt: "Inspect only",
      run_in_background: true,
    }, context)
  }
  assert.deepEqual(client.state.prompts.map((call) => call.body.agent), ["Reviewer", "QA"])
  assert.deepEqual(client.state.creates.map((call) => call.query.directory), [workspace.directory, workspace.directory])
  assert.deepEqual(client.state.creates.map((call) => call.body.parentID), ["parent", "parent"])
})

test("model fallback occurs only for pre-acceptance rejection", async (t) => {
  const { client, runtime, context } = await fixture(t)
  client.state.promptFailures = 1
  const result = await runtime.delegate({
    category: "test",
    description: "Fallback fixture",
    prompt: "No mutation",
    run_in_background: true,
  }, context)
  assert.equal(client.state.prompts.length, 2)
  assert.deepEqual(client.state.prompts.map((call) => call.body.model.modelID), ["primary", "fallback"])
  assert.equal((await runtime.taskStatus(result.task_id, context)).model, "example/fallback")

  await runtime.handleEvent({
    type: "session.error",
    properties: { sessionID: result.child_session_id, error: { data: { message: "failed after acceptance" } } },
  })
  client.state.statuses[result.child_session_id] = { type: "idle" }
  await runtime.handleEvent({
    type: "session.status",
    properties: { sessionID: result.child_session_id, status: { type: "idle" } },
  })
  assert.equal(client.state.prompts.length, 2)
  assert.equal((await runtime.taskStatus(result.task_id, context)).status, "error")
})

test("uncertain prompt transport failure stops fallback", async (t) => {
  const { client, runtime, context } = await fixture(t)
  client.state.promptThrows = 1
  await assert.rejects(runtime.delegate({
    category: "test",
    description: "Uncertain acceptance",
    prompt: "Do not retry",
    run_in_background: true,
  }, context), /acceptance is uncertain; model fallback stopped/)
  assert.equal(client.state.prompts.length, 1)
  const tasks = (await runtime.taskStatus(undefined, context)).tasks
  assert.equal(tasks[0].status, "error")
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
      test: { description: "test route", models: [{ model: "example/primary" }] },
    },
  })
  assert.equal((await restarted.taskStatus(delegated.task_id, context)).status, "running")
  const recovery = await restarted.taskStatus(undefined, context)
  assert.equal(recovery.preserved_workspaces[0].workspace_id, workspace.workspace_id)
  assert.equal(recovery.preserved_workspaces[0].status, "active")
  assert.equal((await restarted.taskCancel(delegated.task_id)).status, "cancelled")
})
