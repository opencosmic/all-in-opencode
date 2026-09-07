import test from "node:test"
import assert from "node:assert/strict"

import { CompletionTracker } from "../plugins/delegation/completion-tracker.js"

function message({ id, role, created, parentID, completed, finish, error }) {
  return {
    id,
    sessionID: "child",
    role,
    time: { created, ...(completed === undefined ? {} : { completed }) },
    ...(parentID ? { parentID } : {}),
    ...(finish ? { finish } : {}),
    ...(error ? { error } : {}),
  }
}

function tool(status) {
  return {
    id: "part-tool",
    sessionID: "child",
    messageID: "assistant-current",
    type: "tool",
    tool: "bash",
    state: { status },
  }
}

async function tracked() {
  const terminals = []
  const tracker = new CompletionTracker({ onTerminal: async (value) => terminals.push(value) })
  tracker.track({ taskID: "task", childSessionID: "child", startedAt: 1000 })
  return { tracker, terminals }
}

test("idle alone and stale prior assistant output do not complete the current turn", async () => {
  const { tracker, terminals } = await tracked()
  await tracker.observe("task", {
    status: { type: "idle" },
    messages: [
      { info: message({ id: "old-user", role: "user", created: 900 }), parts: [] },
      { info: message({ id: "old-assistant", role: "assistant", created: 901, completed: 902, parentID: "old-user", finish: "stop" }), parts: [] },
    ],
  })
  assert.deepEqual(terminals, [])
})

test("assistant tool-call finish and pending or running tool parts block completion", async () => {
  for (const partStatus of ["pending", "running"]) {
    const { tracker, terminals } = await tracked()
    await tracker.observe("task", {
      status: { type: "idle" },
      messages: [
        { info: message({ id: "user", role: "user", created: 1001 }), parts: [] },
        {
          info: message({ id: "assistant-current", role: "assistant", created: 1002, completed: 1003, parentID: "user", finish: "tool-calls" }),
          parts: [tool(partStatus)],
        },
      ],
    })
    assert.deepEqual(terminals, [])
  }
})

test("unknown and unrecognized finish reasons do not complete", async () => {
  for (const finish of ["unknown", "tool_calls", "future-provider-state"]) {
    const { tracker, terminals } = await tracked()
    await tracker.observe("task", {
      status: { type: "idle" },
      messages: [
        { info: message({ id: "user", role: "user", created: 1001 }), parts: [] },
        {
          info: message({ id: "assistant-current", role: "assistant", created: 1002, completed: 1003, parentID: "user", finish }),
          parts: [],
        },
      ],
    })
    assert.deepEqual(terminals, [], finish)
  }
})

test("a later post-tool terminal assistant completes", async () => {
  const { tracker, terminals } = await tracked()
  const user = message({ id: "user", role: "user", created: 1001 })
  await tracker.observe("task", {
    status: { type: "idle" },
    messages: [{ info: user, parts: [] }, {
      info: message({ id: "assistant-tool", role: "assistant", created: 1002, completed: 1003, parentID: "user", finish: "tool-calls" }),
      parts: [{ ...tool("completed"), id: "tool-complete", messageID: "assistant-tool" }],
    }],
  })
  assert.deepEqual(terminals, [])
  await tracker.observe("task", {
    status: { type: "idle" },
    messages: [{ info: user, parts: [] }, {
      info: message({ id: "assistant-final", role: "assistant", created: 1004, completed: 1005, parentID: "user", finish: "stop" }),
      parts: [{ id: "text-final", sessionID: "child", messageID: "assistant-final", type: "text", text: "done" }],
    }],
  })
  assert.equal(terminals.length, 1)
  assert.equal(terminals[0].result.text, "done")
})

test("completed assistant still waits while its own tool part is active", async () => {
  const { tracker, terminals } = await tracked()
  await tracker.observe("task", {
    status: { type: "idle" },
    messages: [
      { info: message({ id: "user", role: "user", created: 1001 }), parts: [] },
      {
        info: message({ id: "assistant-current", role: "assistant", created: 1002, completed: 1003, parentID: "user", finish: "stop" }),
        parts: [tool("running")],
      },
    ],
  })
  assert.deepEqual(terminals, [])
})

test("fresh terminal assistant with no active tools completes exactly once", async () => {
  const { tracker, terminals } = await tracked()
  const snapshot = {
    status: { type: "idle" },
    messages: [
      { info: message({ id: "user", role: "user", created: 1001 }), parts: [] },
      {
        info: message({ id: "assistant-current", role: "assistant", created: 1002, completed: 1003, parentID: "user", finish: "stop" }),
        parts: [{ id: "text", sessionID: "child", messageID: "assistant-current", type: "text", text: "done" }],
      },
    ],
  }
  await tracker.observe("task", snapshot)
  await tracker.observe("task", snapshot)
  assert.equal(terminals.length, 1)
  assert.equal(terminals[0].status, "completed")
  assert.equal(terminals[0].result.text, "done")
})

test("fresh terminal assistant error completes as error", async () => {
  const { tracker, terminals } = await tracked()
  await tracker.observe("task", {
    status: { type: "idle" },
    messages: [
      { info: message({ id: "user", role: "user", created: 1001 }), parts: [] },
      {
        info: message({
          id: "assistant-current",
          role: "assistant",
          created: 1002,
          completed: 1003,
          parentID: "user",
          error: { data: { message: "provider failed" } },
        }),
        parts: [],
      },
    ],
  })
  assert.equal(terminals[0].status, "error")
  assert.equal(terminals[0].error, "provider failed")
})

test("idle session error terminalizes a current user turn without an assistant", async () => {
  const { tracker, terminals } = await tracked()
  await tracker.handleEvent({
    type: "message.updated",
    properties: { info: message({ id: "user", role: "user", created: 1001 }) },
  })
  await tracker.handleEvent({
    type: "session.error",
    properties: { sessionID: "child", error: { data: { message: "provider stopped before response" } } },
  })
  await tracker.handleEvent({ type: "session.idle", properties: { sessionID: "child" } })
  await tracker.observe("task", { status: { type: "idle" }, messages: [] })
  assert.equal(terminals.length, 1)
  assert.equal(terminals[0].status, "error")
  assert.equal(terminals[0].error, "provider stopped before response")
})

test("a completed successful assistant remains more specific than a session error", async () => {
  const { tracker, terminals } = await tracked()
  await tracker.handleEvent({
    type: "session.error",
    properties: { sessionID: "child", error: { data: { message: "late session error" } } },
  })
  await tracker.observe("task", {
    status: { type: "idle" },
    messages: [
      { info: message({ id: "user", role: "user", created: 1001 }), parts: [] },
      {
        info: message({ id: "assistant-current", role: "assistant", created: 1002, completed: 1003, parentID: "user", finish: "stop" }),
        parts: [],
      },
    ],
  })
  assert.equal(terminals.length, 1)
  assert.equal(terminals[0].status, "completed")
})

test("session error waits for an active tool to settle before becoming terminal", async () => {
  const { tracker, terminals } = await tracked()
  await tracker.handleEvent({
    type: "message.updated",
    properties: { info: message({ id: "user", role: "user", created: 1001 }) },
  })
  await tracker.handleEvent({ type: "message.part.updated", properties: { part: tool("running") } })
  await tracker.handleEvent({ type: "session.error", properties: { sessionID: "child", error: { data: { message: "tool failed" } } } })
  await tracker.handleEvent({ type: "session.idle", properties: { sessionID: "child" } })
  assert.deepEqual(terminals, [])
  await tracker.handleEvent({ type: "message.part.updated", properties: { part: tool("error") } })
  await tracker.observe("task", { status: { type: "idle" }, messages: [] })
  assert.equal(terminals.length, 1)
  assert.equal(terminals[0].status, "error")
})

test("cancellation is terminal and duplicate terminal events do not transition twice", async () => {
  const { tracker, terminals } = await tracked()
  await tracker.cancel("task")
  await tracker.cancel("task")
  await tracker.handleEvent({ type: "session.idle", properties: { sessionID: "child" } })
  assert.equal(terminals.length, 1)
  assert.equal(terminals[0].status, "cancelled")
})
