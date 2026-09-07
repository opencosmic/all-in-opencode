import test from "node:test"
import assert from "node:assert/strict"

import { ParentResumeCoordinator } from "../plugins/delegation/parent-resume-coordinator.js"
import { TaskRegistry } from "../plugins/delegation/task-registry.js"

function fakeClient() {
  const state = { parentStatus: "idle", prompts: [] }
  return {
    state,
    session: {
      status: async () => ({ data: { parent: { type: state.parentStatus } } }),
      promptAsync: async (request) => {
        state.prompts.push(request)
        return { data: undefined }
      },
    },
  }
}

async function backgroundTask(registry, description) {
  const task = await registry.register({
    parent_session_id: "parent",
    parent_message_id: "parent-turn",
    parent_agent: "Executor",
    parent_directory: "/repo",
    execution_directory: "/repo/workspace",
    workspace_id: "workspace",
    category: "quick",
    agent: "Implementer",
    description,
    background: true,
  })
  return registry.start(task.task_id, { child_session_id: `child-${description}` })
}

test("same parent turn shares a group and resumes once only after all tasks are terminal", async () => {
  const registry = await new TaskRegistry().load()
  const client = fakeClient()
  const coordinator = new ParentResumeCoordinator({ client, registry })
  const first = await backgroundTask(registry, "first")
  const second = await backgroundTask(registry, "second")
  assert.equal(first.completion_group, second.completion_group)

  await coordinator.onParentIdle("parent")
  const firstDone = await registry.terminal(first.task_id, "completed", { result: { text: "one" } })
  await coordinator.onTaskTerminal(firstDone.task)
  assert.equal(client.state.prompts.length, 0)

  const secondDone = await registry.terminal(second.task_id, "completed", { result: { text: "two" } })
  await coordinator.onTaskTerminal(secondDone.task)
  assert.equal(client.state.prompts.length, 1)
  assert.match(client.state.prompts[0].body.parts[0].text, /delegation_completion/)
  assert.equal(client.state.prompts[0].body.agent, "Executor")

  const duplicate = await registry.terminal(second.task_id, "completed", { result: { text: "duplicate" } })
  assert.equal(duplicate.duplicate, true)
  await coordinator.onTaskTerminal(duplicate.task)
  assert.equal(client.state.prompts.length, 1)
})

test("mixed success and error still produces one compact group resume", async () => {
  const registry = await new TaskRegistry().load()
  const client = fakeClient()
  const coordinator = new ParentResumeCoordinator({ client, registry })
  const first = await backgroundTask(registry, "success")
  const second = await backgroundTask(registry, "error")
  await coordinator.onParentIdle("parent")
  await coordinator.onTaskTerminal((await registry.terminal(first.task_id, "completed", { result: { text: "ok" } })).task)
  await coordinator.onTaskTerminal((await registry.terminal(second.task_id, "error", { error: "failed" })).task)
  assert.equal(client.state.prompts.length, 1)
  const notice = client.state.prompts[0].body.parts[0].text
  assert.match(notice, /"status":"completed"/)
  assert.match(notice, /"status":"error"/)
  assert.ok(notice.length < 2000)
})

test("busy parent buffers a ready group and idle flushes it once", async () => {
  const registry = await new TaskRegistry().load()
  const client = fakeClient()
  const coordinator = new ParentResumeCoordinator({ client, registry })
  const task = await backgroundTask(registry, "buffer")
  client.state.parentStatus = "busy"
  await coordinator.onParentIdle("parent")
  await coordinator.onTaskTerminal((await registry.terminal(task.task_id, "completed", { result: { text: "ready" } })).task)
  assert.equal(client.state.prompts.length, 0)
  client.state.parentStatus = "idle"
  await coordinator.onParentIdle("parent")
  await coordinator.onParentIdle("parent")
  assert.equal(client.state.prompts.length, 1)
})
