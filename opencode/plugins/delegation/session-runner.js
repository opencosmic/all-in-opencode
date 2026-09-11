import { IMPLEMENTER_CONTRACT } from "./implementer-contract.js"
import { categorySessionPermission, requiresPreservedSessionPermissions } from "./category-permissions.js"
import { parseModel, sdkData, sessionStatusFor } from "./sdk.js"

function promptText(description, prompt) {
  return [`Assignment: ${description}`, prompt].filter(Boolean).join("\n\n")
}

function toolsFor(agent, configured, category, skills = []) {
  if (requiresPreservedSessionPermissions(agent, category, skills)) return undefined
  const tools = { ...(configured ?? {}) }
  if (agent === "Implementer") {
    Object.assign(tools, {
      workspace_prepare: false,
      delegate_task: false,
      task_status: false,
      task_output: false,
      task_cancel: false,
      workspace_release: false,
      task: false,
    })
  } else {
    tools.consult_agents = false
  }
  return Object.keys(tools).length ? tools : undefined
}

function systemFor(agent, category, profile = {}, skills = []) {
  const base = agent === "Implementer" ? IMPLEMENTER_CONTRACT : ""
  const skillContent = skills
    .map((skill) => {
      const location = skill.path ?? skill.location
      return [
        `Selected skill: ${skill.name}`,
        location ? `Skill location: ${location}` : "",
        skill.content,
      ].filter(Boolean).join("\n\n")
    })
    .join("\n\n")
  return [base, profile.prompt_append, skillContent].filter(Boolean).join("\n\n") || undefined
}

export class SessionRunner {
  constructor({ client, registry, tracker, sessionProfiles = new Map(), now = () => Date.now() }) {
    this.client = client
    this.registry = registry
    this.tracker = tracker
    this.sessionProfiles = sessionProfiles
    this.now = now
  }

  async start({ task, directory, agent, category, profile, description, prompt, skills = [], sessionID }) {
    const text = promptText(description, prompt)
    const childSessionID = sessionID ?? sdkData(await this.client.session.create({
      body: {
        parentID: task.parent_session_id,
        title: description,
        permission: categorySessionPermission(category, profile.tools, skills),
      },
      query: { directory },
    }), "session.create").id
    this.tracker.track({ taskID: task.task_id, childSessionID, startedAt: this.now() })
    await this.registry.start(task.task_id, { child_session_id: childSessionID })
    this.sessionProfiles.set(childSessionID, {
      ...profile,
      category,
      agent,
      skill_names: skills.map((skill) => skill.name),
      skill_paths: skills.map((skill) => skill.path ?? skill.location).filter(Boolean),
      selected_skills: skills.map((skill) => ({
        name: skill.name,
        path: skill.path ?? skill.location,
      })),
    })

    const body = {
      agent,
      system: systemFor(agent, category, profile, skills),
      tools: toolsFor(agent, profile.tools, category, skills),
      parts: [{ type: "text", text }],
    }
    const model = parseModel(profile.model)
    if (model) body.model = model
    if (profile.variant !== undefined) body.variant = profile.variant
    await this.registry.selectModel(task.task_id, profile.model)
    try {
      const response = await this.client.session.promptAsync({
        path: { id: childSessionID },
        query: { directory },
        body,
      })
      sdkData(response, "session.promptAsync")
    } catch (error) {
      const failure = new Error(`configured model ${profile.model ?? "default"} failed before child turn acceptance: ${error.message}`)
      await this.tracker.fail(task.task_id, failure)
      throw failure
    }
    return { child_session_id: childSessionID, model: profile.model, variant: profile.variant }
  }

  async observeTask(taskID) {
    const task = this.registry.get(taskID)
    if (!task.child_session_id) return null
    const [messagesResult, statusResult] = await Promise.all([
      this.client.session.messages({
        path: { id: task.child_session_id },
        query: { directory: task.execution_directory },
      }),
      this.client.session.status({ query: { directory: task.execution_directory } }),
    ])
    return this.tracker.observe(taskID, {
      messages: sdkData(messagesResult, "session.messages") ?? [],
      status: sessionStatusFor(statusResult, task.child_session_id),
    })
  }

  async abort(task) {
    if (!task.child_session_id) return false
    return sdkData(await this.client.session.abort({
      path: { id: task.child_session_id },
      query: { directory: task.execution_directory },
    }), "session.abort")
  }
}

export { promptText, systemFor, toolsFor }
