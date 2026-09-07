function isActiveTool(part) {
  return part?.type === "tool" && ["pending", "running"].includes(part.state?.status)
}

function isIntermediateFinish(finish) {
  return finish === "tool-calls" || finish === "tool_calls" || finish === "unknown"
}

const SUCCESS_FINISHES = new Set(["stop", "length", "content-filter"])
const ERROR_FINISHES = new Set(["error"])

function errorText(error) {
  return error?.data?.message ?? error?.message ?? (error ? JSON.stringify(error) : null)
}

export class CompletionTracker {
  constructor({ onTerminal = async () => {} } = {}) {
    this.onTerminal = onTerminal
    this.records = new Map()
    this.bySession = new Map()
  }

  track({ taskID, childSessionID, startedAt = Date.now() }) {
    let resolve
    const promise = new Promise((done) => { resolve = done })
    const record = {
      taskID,
      childSessionID,
      startedAt,
      userMessageID: null,
      messages: new Map(),
      parts: new Map(),
      status: { type: "busy" },
      requiresSnapshot: false,
      sessionError: null,
      terminal: null,
      resolve,
      promise,
    }
    this.records.set(taskID, record)
    this.bySession.set(childSessionID, taskID)
    return promise
  }

  taskForSession(sessionID) {
    return this.bySession.get(sessionID)
  }

  wait(taskID) {
    const record = this.records.get(taskID)
    if (!record) throw new Error(`task is not tracked: ${taskID}`)
    return record.promise
  }

  async handleEvent(event) {
    const properties = event?.properties ?? {}
    const sessionID = properties.sessionID ?? properties.info?.sessionID ?? properties.part?.sessionID
    const taskID = this.bySession.get(sessionID)
    if (!taskID) return null
    const record = this.records.get(taskID)

    if (event.type === "message.updated") this.acceptMessage(record, properties.info)
    if (event.type === "message.part.updated") record.parts.set(properties.part.id, properties.part)
    if (event.type === "message.part.removed") record.parts.delete(properties.partID)
    if (event.type === "session.status") {
      record.status = properties.status
      if (properties.status?.type === "idle") record.requiresSnapshot = true
    }
    if (event.type === "session.idle") {
      record.status = { type: "idle" }
      record.requiresSnapshot = true
    }
    if (event.type === "session.error") record.sessionError = errorText(properties.error) ?? "child session error"
    if (record.requiresSnapshot) return null
    return this.evaluate(record)
  }

  acceptMessage(record, message) {
    if (!message || message.sessionID !== record.childSessionID) return
    record.messages.set(message.id, message)
    if (message.role === "user" && message.time?.created >= record.startedAt) {
      const current = record.messages.get(record.userMessageID)
      if (!current || current.time.created <= message.time.created) record.userMessageID = message.id
    }
  }

  async observe(taskID, { messages = [], status }) {
    const record = this.records.get(taskID)
    if (!record || record.terminal) return record?.terminal ?? null
    for (const item of messages) {
      this.acceptMessage(record, item.info)
      for (const part of item.parts ?? []) record.parts.set(part.id, part)
    }
    if (status) record.status = status
    record.requiresSnapshot = false
    return this.evaluate(record)
  }

  async evaluate(record) {
    if (record.terminal || record.status?.type !== "idle") return record.terminal
    if ([...record.parts.values()].some(isActiveTool)) return null
    if (record.sessionError && !record.userMessageID) {
      return this.finish(record, "error", { error: record.sessionError })
    }
    if (!record.userMessageID) return null
    const assistants = [...record.messages.values()]
      .filter((message) => message.role === "assistant" && message.parentID === record.userMessageID)
      .sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))
    const assistant = assistants[0]
    const parts = assistant
      ? [...record.parts.values()].filter((part) => part.messageID === assistant.id)
      : []
    if (assistant?.time?.completed !== undefined) {
      if (assistant.error) {
        return this.finish(record, "error", {
          error: errorText(assistant.error) ?? "child assistant failed",
          result: this.result(assistant, parts),
        })
      }
      if (ERROR_FINISHES.has(assistant.finish)) {
        return this.finish(record, "error", {
          error: "child assistant finished with an error",
          result: this.result(assistant, parts),
        })
      }
      if (SUCCESS_FINISHES.has(assistant.finish)) {
        return this.finish(record, "completed", { result: this.result(assistant, parts) })
      }
    }
    if (record.sessionError) {
      return this.finish(record, "error", {
        error: record.sessionError,
        ...(assistant ? { result: this.result(assistant, parts) } : {}),
      })
    }
    return null
  }

  result(assistant, parts) {
    return {
      assistant_message_id: assistant.id,
      finish: assistant.finish ?? null,
      text: parts.filter((part) => part.type === "text" && !part.ignored).map((part) => part.text).join("\n"),
      tool_calls: parts.filter((part) => part.type === "tool").map((part) => ({
        tool: part.tool,
        status: part.state?.status,
        title: part.state?.title ?? null,
      })),
    }
  }

  async cancel(taskID) {
    const record = this.records.get(taskID)
    if (!record) return null
    return this.finish(record, "cancelled", { error: "cancelled by parent request" })
  }

  async fail(taskID, error) {
    const record = this.records.get(taskID)
    if (!record) return null
    return this.finish(record, "error", { error: errorText(error) ?? String(error) })
  }

  async finish(record, status, payload) {
    if (record.terminal) return record.terminal
    record.terminal = { taskID: record.taskID, status, ...payload }
    await this.onTerminal(record.terminal)
    record.resolve(record.terminal)
    return record.terminal
  }
}

export { ERROR_FINISHES, SUCCESS_FINISHES, isActiveTool, isIntermediateFinish }
