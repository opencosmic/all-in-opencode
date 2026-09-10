import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

import { DelegationRuntime } from "../plugins/delegation/runtime.js"

const execFileAsync = promisify(execFile)

function fakeClient() {
  const state = {
    creates: [],
    prompts: [],
    statuses: {},
    messages: {},
  }
  return {
    state,
    session: {
      create: async (request) => {
        state.creates.push(request)
        return { data: { id: `consult-child-${state.creates.length}` } }
      },
      promptAsync: async (request) => {
        state.prompts.push(request)
        return { data: undefined }
      },
      abort: async () => ({ data: true }),
      status: async () => ({ data: state.statuses }),
      messages: async (request) => ({ data: state.messages[request.path.id] ?? [] }),
    },
  }
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "delegation-consultation-test-"))
  const directory = join(root, "directory")
  await mkdir(directory)
  const client = fakeClient()
  const runtime = await DelegationRuntime.create({
    client,
    stateDirectory: join(root, "state"),
    directory,
    skillEntries: [],
    categories: { quick: { description: "quick route", model: "example/primary" } },
  })
  const context = {
    sessionID: "implementer-session",
    messageID: "implementer-turn",
    agent: "Implementer",
    directory,
  }
  t.after(() => rm(root, { recursive: true }))
  return { client, context, directory, runtime }
}

function childMessages(sessionID, text) {
  const created = Date.now() + 1
  const user = {
    id: `${sessionID}-user-${text}`,
    sessionID,
    role: "user",
    time: { created },
  }
  const assistant = {
    id: `${sessionID}-assistant-${text}`,
    sessionID,
    role: "assistant",
    parentID: user.id,
    time: { created: created + 1, completed: created + 2 },
    finish: "stop",
  }
  return [
    { info: user, parts: [] },
    {
      info: assistant,
      parts: [{
        id: `${sessionID}-text-${text}`,
        sessionID,
        messageID: assistant.id,
        type: "text",
        text,
      }],
    },
  ]
}

async function complete(runtime, client, sessionID, text) {
  client.state.statuses[sessionID] = { type: "idle" }
  client.state.messages[sessionID] = childMessages(sessionID, text)
  await runtime.handleEvent({ type: "session.idle", properties: { sessionID } })
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error("test fixture did not reach the expected state")
}

test("Implementer can consult both read-only specialists through the shared background lifecycle", async (t) => {
  const { client, context, runtime } = await fixture(t)
  const explorer = await runtime.consult({
    agent: "Explorer",
    description: "Find local registration patterns",
    prompt: "Locate the existing OpenCode tool registration pattern and report the relevant files.",
    run_in_background: true,
  }, context)
  const librarian = await runtime.consult({
    agent: "Librarian",
    prompt: "Check the official documentation for the current session prompt API.",
    run_in_background: true,
  }, context)

  assert.deepEqual(client.state.prompts.map((request) => request.body.agent), ["Explorer", "Librarian"])
  assert.equal(client.state.creates.length, 2)
  assert.equal(client.state.creates[0].body.parentID, context.sessionID)
  assert.equal(client.state.creates[0].body.permission, undefined)
  assert.equal(client.state.prompts[0].body.tools.delegate_task, false)
  assert.equal(client.state.prompts[0].body.tools.consult_agent, false)
  assert.equal(client.state.prompts[0].body.tools.task, false)
  assert.equal(client.state.prompts[0].body.tools.edit, undefined)
  assert.equal(Object.hasOwn(client.state.prompts[0].body, "load_skills"), false)
  assert.equal(explorer.workspace_id, null)
  assert.equal(librarian.workspace_id, null)

  await complete(runtime, client, explorer.child_session_id, "local findings")
  await complete(runtime, client, librarian.child_session_id, "upstream findings")
  assert.equal(runtime.taskOutput(explorer.task_id).result.text, "local findings")
  assert.equal(runtime.taskOutput(librarian.task_id).result.text, "upstream findings")

  client.state.statuses[context.sessionID] = { type: "idle" }
  await runtime.handleEvent({ type: "session.idle", properties: { sessionID: context.sessionID } })
  const resume = client.state.prompts.find((request) => request.path.id === context.sessionID)
  assert.match(resume.body.parts[0].text, /local findings/)
  assert.match(resume.body.parts[0].text, /upstream findings/)
})

test("synchronous consultation returns the bounded child result", async (t) => {
  const { client, context, runtime } = await fixture(t)
  const pending = runtime.consult({
    agent: "Librarian",
    prompt: "Return the relevant official API reference.",
  }, context)
  await waitFor(() => client.state.prompts.length === 1)
  const childSessionID = client.state.prompts[0].path.id
  await complete(runtime, client, childSessionID, "synchronous findings")
  const result = await pending
  assert.equal(result.status, "completed")
  assert.equal(result.result.text, "synchronous findings")
  assert.equal(result.completion_group, null)
})

test("background consultation startup errors are registered and terminalized", async (t) => {
  const { client, context, runtime } = await fixture(t)
  client.session.promptAsync = async (request) => {
    client.state.prompts.push(request)
    return { error: { data: { message: "consultant unavailable" } } }
  }
  await assert.rejects(runtime.consult({
    agent: "Explorer",
    prompt: "This consultant will fail before accepting the turn.",
    run_in_background: true,
  }, context), /configured model default failed.*consultant unavailable/)
  const [task] = runtime.registry.list({ parent_session_id: context.sessionID })
  assert.equal(task.status, "error")
  assert.equal(task.agent, "Explorer")
  assert.match(task.error, /consultant unavailable/)
})

test("consultation continuation reuses only the completed owned specialist session", async (t) => {
  const { client, context, directory, runtime } = await fixture(t)
  const first = await runtime.consult({
    agent: "Explorer",
    prompt: "Find the closest existing implementation.",
    run_in_background: true,
  }, context)
  await complete(runtime, client, first.child_session_id, "first findings")

  const continued = await runtime.consult({
    agent: "Explorer",
    prompt: "Now compare that pattern with its nearest sibling.",
    session_id: first.child_session_id,
    run_in_background: true,
  }, context)
  assert.equal(client.state.creates.length, 1)
  assert.equal(client.state.prompts.length, 2)
  assert.equal(client.state.prompts[1].path.id, first.child_session_id)
  assert.equal(runtime.registry.get(continued.task_id).execution_directory, await realpath(directory))
  await complete(runtime, client, first.child_session_id, "continued findings")
  assert.equal(runtime.taskOutput(continued.task_id).result.text, "continued findings")

  await assert.rejects(runtime.consult({
    agent: "Librarian",
    prompt: "Use the wrong target for this session.",
    session_id: first.child_session_id,
  }, context), /consultation target must remain Librarian/)
  await assert.rejects(runtime.consult({
    agent: "Explorer",
    prompt: "Use an unknown session.",
    session_id: "not-a-consultation-session",
  }, context), /must reference a consultation session owned by this Implementer/)
})

test("consultation fails closed for invalid callers, targets, and in-flight continuation", async (t) => {
  const { client, context, runtime } = await fixture(t)
  for (const agent of ["QA", "Reviewer", "Implementer", "Technical Advisor", "custom-agent"]) {
    await assert.rejects(runtime.consult({ agent, prompt: "Invalid target" }, context), /target is not allowed/)
  }
  await assert.rejects(runtime.consult({
    agent: "Explorer",
    category: "deep",
    prompt: "No category delegation through consultation.",
  }, context), /does not accept category/)
  await assert.rejects(runtime.consult({
    agent: "Explorer",
    load_skills: ["anything"],
    prompt: "No skill loading through consultation.",
  }, context), /does not accept load_skills/)
  for (const agent of ["Explorer", "Librarian", "Executor", "Assistant", undefined]) {
    await assert.rejects(runtime.consult({ agent: "Explorer", prompt: "Invalid caller" }, {
      ...context,
      agent,
    }), /may only be called by Implementer/)
  }
  assert.equal(client.state.creates.length, 0)

  const active = await runtime.consult({
    agent: "Explorer",
    prompt: "Keep this consultation running.",
    run_in_background: true,
  }, context)
  await assert.rejects(runtime.consult({
    agent: "Explorer",
    prompt: "Do not overlap turns.",
    session_id: active.child_session_id,
  }, context), /can continue only a completed consultation/)
  await assert.rejects(runtime.delegate({
    category: "quick",
    description: "Implementer must not delegate",
    prompt: "This must fail before launching a worker.",
  }, context), /Implementer cannot call delegate_task/)
})

test("consultation child profiles and agent config keep recursion disabled", async () => {
  const repository = fileURLToPath(new URL("../..", import.meta.url))
  const names = ["Implementer", "Explorer", "Librarian"]
  const agents = await Promise.all(names.map(async (name) => {
    const { stdout } = await execFileAsync("opencode", ["debug", "agent", name], {
      cwd: repository,
      encoding: "utf8",
    })
    return [name, JSON.parse(stdout)]
  }))
  const resolved = new Map(agents)
  assert.equal(resolved.get("Implementer").tools.consult_agent, true)
  assert.equal(resolved.get("Implementer").tools.delegate_task, false)
  for (const name of ["Explorer", "Librarian"]) {
    assert.equal(resolved.get(name).tools.consult_agent, false)
    assert.equal(resolved.get(name).tools.delegate_task, false)
  }
})
