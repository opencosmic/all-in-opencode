import { sdkData, sessionStatusFor } from "./sdk.js"

function shortSummary(task) {
  const text = task.result?.text ?? task.error ?? ""
  return text.replace(/\s+/g, " ").trim().slice(0, 240)
}

function isConsultationTask(task) {
  return task.parent_agent === "Implementer"
    && task.category === null
    && task.workspace_id === null
    && ["Explorer", "Librarian"].includes(task.agent)
}

function consultationResult(task) {
  const text = task.result?.text ?? task.error ?? null
  return typeof text === "string" ? text.slice(0, 20_000) : text
}

export class ParentResumeCoordinator {
  constructor({ client, registry }) {
    this.client = client
    this.registry = registry
    this.idleParents = new Set()
  }

  async onTaskTerminal(task) {
    if (!task.background || !task.completion_group) return false
    return this.tryResume(task.completion_group)
  }

  async onParentIdle(parentSessionID) {
    this.idleParents.add(parentSessionID)
    const groups = await this.registry.closeParentGroups(parentSessionID)
    let resumed = false
    for (const groupID of groups) resumed = (await this.tryResume(groupID)) || resumed
    for (const group of Object.values(this.registry.state.groups)) {
      if (group.parent_session_id === parentSessionID && group.closed && group.delivery_state === "pending") {
        resumed = (await this.tryResume(group.completion_group)) || resumed
      }
    }
    return resumed
  }

  async tryResume(groupID) {
    const snapshot = this.registry.group(groupID)
    if (!snapshot.closed || snapshot.delivery_state !== "pending") return false
    if (snapshot.tasks.some((task) => !["completed", "error", "cancelled"].includes(task.status))) return false
    const status = sessionStatusFor(
      await this.client.session.status({ query: { directory: snapshot.parent_directory } }),
      snapshot.parent_session_id,
    )
    if (!["idle", "unknown"].includes(status.type)) {
      this.idleParents.delete(snapshot.parent_session_id)
      return false
    }
    if (status.type === "unknown" && !this.idleParents.has(snapshot.parent_session_id)) return false
    const claimed = await this.registry.claimDelivery(groupID)
    if (!claimed) return false
    const notice = {
      type: "delegation_completion",
      completion_group: claimed.completion_group,
      tasks: claimed.tasks.map((task) => ({
        task_id: task.task_id,
        status: task.status,
        workspace_id: task.workspace_id,
        summary: shortSummary(task),
        ...(isConsultationTask(task)
          ? { result: consultationResult(task) }
          : { detail: `task_output(task_id="${task.task_id}")` }),
      })),
    }
    try {
      sdkData(await this.client.session.promptAsync({
        path: { id: claimed.parent_session_id },
        query: { directory: claimed.parent_directory },
        body: {
          agent: claimed.parent_agent ?? undefined,
          parts: [{
            type: "text",
            text: `Delegation completion group is terminal. Continue orchestration from this compact notice:\n${JSON.stringify(notice)}`,
          }],
        },
      }), "parent session.promptAsync")
      this.idleParents.delete(claimed.parent_session_id)
      await this.registry.finishDelivery(groupID, true)
      return true
    } catch (error) {
      await this.registry.finishDelivery(groupID, false)
      throw error
    }
  }
}

export { shortSummary }
