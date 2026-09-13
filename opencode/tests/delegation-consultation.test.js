import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

import { DelegationRuntime } from "../plugins/delegation/runtime.js"
import { isolatedOpenCodeEnv } from "./support/isolated-opencode.js"

const execFileAsync = promisify(execFile)

function fakeClient() {
  const state = {
    creates: [],
    prompts: [],
    statuses: {},
    messages: {},
    failAgents: new Set(),
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
        if (state.failAgents.has(request.body.agent)) {
          return { error: { data: { message: "401 Unauthorized" } } }
        }
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
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error("test fixture did not reach the expected state")
}

test("consult_agents launches the batch concurrently, waits synchronously, and preserves order", async (t) => {
  const { client, context, runtime } = await fixture(t)
  let settled = false
  const pending = runtime.consultAgents({
    requests: [
      {
        agent: "Explorer",
        description: "Find local registration patterns",
        prompt: "Locate the existing OpenCode tool registration pattern and report the relevant files.",
      },
      {
        agent: "Librarian",
        prompt: "Check the official documentation for the current session prompt API.",
      },
    ],
  }, context).then((result) => {
    settled = true
    return result
  })

  await waitFor(() => client.state.prompts.length === 2)
  assert.equal(settled, false)
  assert.deepEqual(client.state.prompts.map((request) => request.body.agent), ["Explorer", "Librarian"])
  assert.equal(client.state.creates.length, 2)
  assert.equal(client.state.creates[0].body.parentID, context.sessionID)
  assert.equal(client.state.creates[0].body.permission, undefined)
  assert.equal(client.state.prompts.some((request) => request.path.id === context.sessionID), false)

  for (const task of runtime.registry.list({ parent_session_id: context.sessionID })) {
    assert.equal(task.status, "running")
    assert.equal(task.background, false)
    assert.equal(task.completion_group, null)
    assert.equal(task.category, null)
    assert.equal(task.workspace_id, null)
  }
  assert.equal(runtime.registry.list({ parent_session_id: context.sessionID }).length, 2)

  const explorerSessionID = client.state.prompts.find((request) => request.body.agent === "Explorer").path.id
  const librarianSessionID = client.state.prompts.find((request) => request.body.agent === "Librarian").path.id
  assert.equal(client.state.prompts[0].body.tools.delegate_task, false)
  assert.equal(client.state.prompts[0].body.tools.consult_agents, false)
  assert.equal(client.state.prompts[0].body.tools.task, false)
  assert.equal(client.state.prompts[0].body.tools.edit, undefined)
  assert.equal(Object.hasOwn(client.state.prompts[0].body, "load_skills"), false)

  await complete(runtime, client, explorerSessionID, "local findings")
  assert.equal(settled, false)
  await complete(runtime, client, librarianSessionID, "upstream findings")
  const result = await pending

  assert.deepEqual(result.results.map((outcome) => ({
    agent: outcome.agent,
    status: outcome.status,
    text: outcome.result.text,
  })), [
    { agent: "Explorer", status: "completed", text: "local findings" },
    { agent: "Librarian", status: "completed", text: "upstream findings" },
  ])
  assert.ok(result.results.every((outcome) => outcome.task_id && outcome.session_id))
  assert.equal(client.state.prompts.some((request) => request.path.id === context.sessionID), false)
})

test("consult_agents isolates a child failure and does not retry or resume the parent", async (t) => {
  const { client, context, runtime } = await fixture(t)
  client.state.failAgents.add("Explorer")
  const pending = runtime.consultAgents({
    requests: [
      { agent: "Explorer", prompt: "This consultant should fail before accepting the turn." },
      { agent: "Librarian", prompt: "Return the relevant official API reference." },
    ],
  }, context)

  await waitFor(() => client.state.prompts.length === 2)
  const librarianSessionID = client.state.prompts.find((request) => request.body.agent === "Librarian").path.id
  await complete(runtime, client, librarianSessionID, "synchronous findings")
  const result = await pending

  assert.equal(client.state.prompts.length, 2)
  assert.deepEqual(result.results.map((outcome) => outcome.agent), ["Explorer", "Librarian"])
  assert.equal(result.results[0].status, "error")
  assert.match(result.results[0].error, /401 Unauthorized/)
  assert.equal(result.results[1].status, "completed")
  assert.equal(result.results[1].result.text, "synchronous findings")
  assert.deepEqual(runtime.registry.list({ parent_session_id: context.sessionID }).map((task) => task.status), ["error", "completed"])
  assert.equal(client.state.prompts.some((request) => request.path.id === context.sessionID), false)
})

test("consult_agents continuation uses the latest completed owned session and rejects overlap or duplicate IDs", async (t) => {
  const { client, context, directory, runtime } = await fixture(t)
  const firstPending = runtime.consultAgents({
    requests: [{ agent: "Explorer", prompt: "Find the closest existing implementation." }],
  }, context)
  await waitFor(() => client.state.prompts.length === 1)
  const childSessionID = client.state.prompts[0].path.id
  await complete(runtime, client, childSessionID, "first findings")
  const first = await firstPending

  const secondPending = runtime.consultAgents({
    requests: [{
      agent: "Explorer",
      prompt: "Now compare that pattern with its nearest sibling.",
      session_id: first.results[0].session_id,
    }],
  }, context)
  await waitFor(() => client.state.prompts.length === 2)
  assert.equal(client.state.creates.length, 1)
  assert.equal(client.state.prompts[1].path.id, childSessionID)
  const [firstTask, secondTask] = runtime.registry.list({ parent_session_id: context.sessionID })
  assert.equal(firstTask.status, "completed")
  assert.equal(secondTask.status, "running")
  assert.equal(secondTask.background, false)
  assert.equal(secondTask.completion_group, null)
  assert.equal(secondTask.execution_directory, await realpath(directory))

  await assert.rejects(runtime.consultAgents({
    requests: [{ agent: "Explorer", prompt: "Do not overlap turns.", session_id: childSessionID }],
  }, context), /in-flight consultation|already being continued/)

  await complete(runtime, client, childSessionID, "continued findings")
  const second = await secondPending
  assert.equal(second.results[0].result.text, "continued findings")
  const latest = runtime.findConsultationSession(childSessionID, "Explorer", context, await realpath(directory))
  assert.equal(latest.task_id, second.results[0].task_id)

  await assert.rejects(runtime.consultAgents({
    requests: [{ agent: "Librarian", prompt: "Use the wrong target for this session.", session_id: childSessionID }],
  }, context), /session_id belongs to Explorer; cannot continue it as Librarian/)
  await assert.rejects(runtime.consultAgents({
    requests: [{ agent: "Explorer", prompt: "Use an unknown session.", session_id: "not-a-consultation-session" }],
  }, context), /must reference a consultation session owned by this Implementer/)
  await assert.rejects(runtime.consultAgents({
    requests: [
      { agent: "Explorer", prompt: "Duplicate one.", session_id: childSessionID },
      { agent: "Explorer", prompt: "Duplicate two.", session_id: childSessionID },
    ],
  }, context), /cannot repeat session_id/)

  await assert.rejects(runtime.consultAgents({
    requests: [{ agent: "Explorer", prompt: "Cross-parent lookup.", session_id: childSessionID }],
  }, { ...context, sessionID: "another-parent-session" }), /owned by this Implementer/)
  const otherDirectory = join(directory, "other")
  await mkdir(otherDirectory)
  await assert.rejects(runtime.consultAgents({
    requests: [{ agent: "Explorer", prompt: "Cross-directory lookup.", session_id: childSessionID }],
  }, { ...context, directory: otherDirectory }), /different workspace/)
})

test("consult_agents rejects unsupported fields, callers, targets, and limits before launching", async (t) => {
  const { client, context, runtime } = await fixture(t)
  for (const field of ["category", "load_skills", "workspace_id", "run_in_background"]) {
    await assert.rejects(runtime.consultAgents({
      requests: [{ agent: "Explorer", prompt: "No delegated configuration." }],
      [field]: field === "load_skills" ? [] : false,
    }, context), /does not accept/)
  }
  for (const field of ["category", "load_skills", "workspace_id", "run_in_background"]) {
    await assert.rejects(runtime.consultAgents({
      requests: [{ agent: "Explorer", prompt: "No delegated configuration.", [field]: false }],
    }, context), /does not accept/)
  }
  for (const agent of ["QA", "Reviewer", "Implementer", "Technical Advisor", "custom-agent"]) {
    await assert.rejects(runtime.consultAgents({
      requests: [{ agent, prompt: "Invalid target" }],
    }, context), /target is not allowed/)
  }
  for (const agent of ["Explorer", "Librarian", "Executor", "Assistant", undefined]) {
    await assert.rejects(runtime.consultAgents({
      requests: [{ agent: "Explorer", prompt: "Invalid caller" }],
    }, { ...context, agent }), /may only be called by Implementer/)
  }
  await assert.rejects(runtime.consultAgents({ requests: [] }, context), /accepts 1-4 requests/)
  await assert.rejects(runtime.consultAgents({
    requests: Array.from({ length: 5 }, () => ({ agent: "Explorer", prompt: "Too many" })),
  }, context), /accepts 1-4 requests/)
  await assert.rejects(runtime.consultAgents({
    requests: [{ agent: "Explorer", prompt: "   " }],
  }, context), /non-empty prompt/)
  assert.equal(client.state.creates.length, 0)

  await assert.rejects(runtime.delegate({
    category: "quick",
    description: "Implementer must not delegate",
    prompt: "This must fail before launching a worker.",
  }, context), /Implementer cannot call delegate_task/)
})

test("consultation child profiles and agent config keep recursion disabled", async (t) => {
  const repository = fileURLToPath(new URL("../..", import.meta.url))
  const names = ["Implementer", "Explorer", "Librarian"]
  const agents = await Promise.all(names.map(async (name) => {
    const env = await isolatedOpenCodeEnv(t, repository)
    const { stdout } = await execFileAsync("opencode", ["debug", "agent", name], {
      cwd: repository,
      env,
      encoding: "utf8",
    })
    return [name, JSON.parse(stdout)]
  }))
  const resolved = new Map(agents)
  assert.equal(resolved.get("Implementer").tools.consult_agents, true)
  assert.equal(resolved.get("Implementer").tools.delegate_task, false)
  for (const name of ["Explorer", "Librarian"]) {
    assert.equal(resolved.get(name).tools.consult_agents, false)
    assert.equal(resolved.get(name).tools.delegate_task, false)
  }
})
