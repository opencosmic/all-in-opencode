import {
  BROWSER_IMPLEMENTER_CONTRACT,
  GIT_IMPLEMENTER_CONTRACT,
  IMPLEMENTER_CONTRACT,
} from "./implementer-contract.js"
import { categorySessionPermission } from "./category-permissions.js"
import { parseModel, sdkData, sessionStatusFor } from "./sdk.js"

function promptText(description, prompt, append) {
  return [`Assignment: ${description}`, prompt, append].filter(Boolean).join("\n\n")
}

function ensurePromptBound(text, maxPromptTokens) {
  if (!maxPromptTokens) return
  const conservativeTokens = Math.ceil(text.length / 4)
  if (conservativeTokens > maxPromptTokens) {
    throw new Error(`delegation prompt exceeds max_prompt_tokens (${conservativeTokens} > ${maxPromptTokens})`)
  }
}

function toolsFor(agent, configured, category) {
  if (agent === "Implementer" && ["git", "browser-automation"].includes(category)) return undefined
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
  }
  return Object.keys(tools).length ? tools : undefined
}

function systemFor(agent, category) {
  if (agent !== "Implementer") return undefined
  if (category === "git") return GIT_IMPLEMENTER_CONTRACT
  if (category === "browser-automation") return BROWSER_IMPLEMENTER_CONTRACT
  return IMPLEMENTER_CONTRACT
}

export class SessionRunner {
  constructor({ client, registry, tracker, sessionProfiles = new Map(), now = () => Date.now() }) {
    this.client = client
    this.registry = registry
    this.tracker = tracker
    this.sessionProfiles = sessionProfiles
    this.now = now
  }

  async start({ task, directory, agent, category, profile, description, prompt }) {
    const text = promptText(description, prompt, profile.prompt_append)
    ensurePromptBound(text, profile.max_prompt_tokens)
    const created = sdkData(await this.client.session.create({
      body: {
        parentID: task.parent_session_id,
        title: description,
        permission: categorySessionPermission(category),
      },
      query: { directory },
    }), "session.create")
    const childSessionID = created.id
    this.tracker.track({ taskID: task.task_id, childSessionID, startedAt: this.now() })
    await this.registry.start(task.task_id, { child_session_id: childSessionID })
    this.sessionProfiles.set(childSessionID, { ...profile, category, agent })

    const models = profile.models?.length ? profile.models : [{ model: null }]
    const failures = []
    for (const candidate of models) {
      const body = {
        agent,
        system: systemFor(agent, category),
        tools: toolsFor(agent, profile.tools, category),
        parts: [{ type: "text", text }],
      }
      try {
        const model = parseModel(candidate.model)
        if (model) body.model = model
      } catch (error) {
        failures.push(`${candidate.model ?? "default"}: ${error.message}`)
        continue
      }
      await this.registry.selectModel(task.task_id, candidate.model)
      let response
      try {
        response = await this.client.session.promptAsync({
          path: { id: childSessionID },
          query: { directory },
          body,
        })
      } catch (error) {
        const uncertain = new Error(`child prompt acceptance is uncertain; model fallback stopped: ${error.message}`)
        await this.tracker.fail(task.task_id, uncertain)
        throw uncertain
      }
      try {
        sdkData(response, "session.promptAsync")
      } catch (error) {
        failures.push(`${candidate.model ?? "default"}: ${error.message}`)
        continue
      }
      return { child_session_id: childSessionID, model: candidate.model }
    }

    const failure = new Error(`all configured models were rejected before turn acceptance: ${failures.join(" | ")}`)
    await this.tracker.fail(task.task_id, failure)
    throw failure
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

export { ensurePromptBound, promptText, systemFor, toolsFor }
