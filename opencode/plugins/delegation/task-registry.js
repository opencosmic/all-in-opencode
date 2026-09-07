import { createHash, randomUUID } from "node:crypto"

import { readJson, writeJson } from "./json-store.js"

export const TERMINAL_STATUSES = new Set(["completed", "error", "cancelled"])

function completionGroup(parentSessionID, parentMessageID) {
  const digest = createHash("sha256").update(`${parentSessionID}\0${parentMessageID}`).digest("hex").slice(0, 20)
  return `group_${digest}`
}

export class TaskRegistry {
  constructor({ storePath, now = () => new Date().toISOString() } = {}) {
    this.storePath = storePath
    this.now = now
    this.state = { version: 1, tasks: {}, groups: {} }
    this.writeQueue = Promise.resolve()
  }

  async load() {
    if (this.storePath) this.state = (await readJson(this.storePath, this.state)) ?? this.state
    return this
  }

  async persist() {
    if (this.storePath) await writeJson(this.storePath, this.state)
  }

  async mutate(operation) {
    const run = this.writeQueue.then(async () => {
      const value = operation()
      await this.persist()
      return value
    })
    this.writeQueue = run.catch(() => {})
    return run
  }

  async register(input) {
    return this.mutate(() => {
      const taskID = `task_${randomUUID()}`
      const groupID = input.background ? completionGroup(input.parent_session_id, input.parent_message_id) : null
      const existingGroup = groupID ? this.state.groups[groupID] : null
      if (existingGroup?.parent_agent && input.parent_agent && existingGroup.parent_agent !== input.parent_agent) {
        throw new Error(`completion group parent agent mismatch: ${existingGroup.parent_agent} != ${input.parent_agent}`)
      }
      const task = {
        task_id: taskID,
        parent_session_id: input.parent_session_id,
        parent_message_id: input.parent_message_id,
        parent_agent: input.parent_agent ?? null,
        parent_directory: input.parent_directory,
        execution_directory: input.execution_directory,
        workspace_id: input.workspace_id ?? null,
        category: input.category ?? null,
        agent: input.agent,
        unsupported_profile_fields: input.unsupported_profile_fields ?? [],
        description: input.description,
        status: "pending",
        child_session_id: null,
        model: null,
        started_at: null,
        completed_at: null,
        result: null,
        error: null,
        background: Boolean(input.background),
        completion_group: groupID,
        cancel_requested_at: null,
      }
      this.state.tasks[taskID] = task
      if (groupID && !this.state.groups[groupID]) {
        this.state.groups[groupID] = {
          completion_group: groupID,
          parent_session_id: input.parent_session_id,
          parent_message_id: input.parent_message_id,
          parent_agent: input.parent_agent ?? null,
          parent_directory: input.parent_directory,
          closed: false,
          delivery_state: "pending",
        }
      } else if (groupID && !this.state.groups[groupID].parent_agent && input.parent_agent) {
        this.state.groups[groupID].parent_agent = input.parent_agent
      }
      return structuredClone(task)
    })
  }

  async start(taskID, { child_session_id: childSessionID, model } = {}) {
    return this.mutate(() => {
      const task = this.require(taskID)
      if (task.status !== "pending") throw new Error(`cannot start task from ${task.status}`)
      task.status = "running"
      task.child_session_id = childSessionID
      task.model = model ?? null
      task.started_at = this.now()
      return structuredClone(task)
    })
  }

  async selectModel(taskID, model) {
    return this.mutate(() => {
      const task = this.require(taskID)
      if (task.status !== "running") throw new Error(`cannot select model for task in ${task.status}`)
      task.model = model ?? null
      return structuredClone(task)
    })
  }

  async requestCancel(taskID) {
    return this.mutate(() => {
      const task = this.require(taskID)
      if (!TERMINAL_STATUSES.has(task.status)) task.cancel_requested_at = this.now()
      return structuredClone(task)
    })
  }

  async terminal(taskID, status, payload = {}) {
    if (!TERMINAL_STATUSES.has(status)) throw new Error(`invalid terminal status: ${status}`)
    return this.mutate(() => {
      const task = this.require(taskID)
      if (TERMINAL_STATUSES.has(task.status)) return { task: structuredClone(task), duplicate: true }
      if (!["pending", "running"].includes(task.status)) throw new Error(`cannot finish task from ${task.status}`)
      task.status = status
      task.completed_at = this.now()
      task.result = payload.result ?? null
      task.error = payload.error ?? null
      return { task: structuredClone(task), duplicate: false }
    })
  }

  require(taskID) {
    const task = this.state.tasks[taskID]
    if (!task) throw new Error(`unknown task_id: ${taskID}`)
    return task
  }

  get(taskID) {
    return structuredClone(this.require(taskID))
  }

  list({ parent_session_id: parentSessionID, workspace_id: workspaceID } = {}) {
    return Object.values(this.state.tasks)
      .filter((task) => !parentSessionID || task.parent_session_id === parentSessionID)
      .filter((task) => !workspaceID || task.workspace_id === workspaceID)
      .map((task) => structuredClone(task))
  }

  hasActiveWorkspace(workspaceID) {
    return Object.values(this.state.tasks).some(
      (task) => task.workspace_id === workspaceID && !TERMINAL_STATUSES.has(task.status),
    )
  }

  async closeParentGroups(parentSessionID) {
    return this.mutate(() => {
      const closed = []
      for (const group of Object.values(this.state.groups)) {
        if (group.parent_session_id === parentSessionID && !group.closed) {
          group.closed = true
          closed.push(group.completion_group)
        }
      }
      return closed
    })
  }

  group(groupID) {
    const group = this.state.groups[groupID]
    if (!group) throw new Error(`unknown completion group: ${groupID}`)
    const tasks = Object.values(this.state.tasks).filter((task) => task.completion_group === groupID)
    return { ...structuredClone(group), tasks: structuredClone(tasks) }
  }

  async claimDelivery(groupID) {
    return this.mutate(() => {
      const group = this.state.groups[groupID]
      if (!group || !group.closed || group.delivery_state !== "pending") return null
      const tasks = Object.values(this.state.tasks).filter((task) => task.completion_group === groupID)
      if (!tasks.length || tasks.some((task) => !TERMINAL_STATUSES.has(task.status))) return null
      group.delivery_state = "claimed"
      return { ...structuredClone(group), tasks: structuredClone(tasks) }
    })
  }

  async finishDelivery(groupID, delivered) {
    return this.mutate(() => {
      const group = this.state.groups[groupID]
      if (!group) return
      group.delivery_state = delivered ? "delivered" : "pending"
    })
  }
}

export { completionGroup }
