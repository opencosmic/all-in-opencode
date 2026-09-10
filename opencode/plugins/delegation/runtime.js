import { realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import { AgentDispatcher } from "./agent-dispatcher.js"
import { CategoryEngine } from "./category-engine.js"
import { categoryPermission } from "./category-permissions.js"
import { CompletionTracker } from "./completion-tracker.js"
import { readJson } from "./json-store.js"
import { ParentResumeCoordinator } from "./parent-resume-coordinator.js"
import { SessionRunner } from "./session-runner.js"
import { SkillResolver, discoverSkills } from "./skill-resolver.js"
import { TaskRegistry, TERMINAL_STATUSES } from "./task-registry.js"
import { WorkspaceManager } from "./workspace-manager.js"

const SESSION_PROFILES = Symbol.for("opencode-workflow.delegation.session-profiles")

function sharedSessionProfiles() {
  globalThis[SESSION_PROFILES] ??= new Map()
  return globalThis[SESSION_PROFILES]
}

function defaultStateDirectory() {
  return process.env.OPENCODE_WORKFLOW_DATA_ROOT
    ? join(process.env.OPENCODE_WORKFLOW_DATA_ROOT, "delegation")
    : join(homedir(), ".local", "share", "opencode-workflow", "delegation")
}

function publicTask(task) {
  return {
    task_id: task.task_id,
    status: task.status,
    workspace_id: task.workspace_id,
    parent_agent: task.parent_agent ?? null,
    child_session_id: task.child_session_id,
    category: task.category,
    agent: task.agent,
    model: task.model,
    variant: task.variant,
    completion_group: task.completion_group,
    started_at: task.started_at,
    completed_at: task.completed_at,
    error: task.error,
  }
}

export class DelegationRuntime {
  static async create({
    client,
    stateDirectory = defaultStateDirectory(),
    registryStorePath,
    categories,
    categoryConfigPath,
    directory,
    skillEntries,
    skillRoots,
    now,
  } = {}) {
    const resolvedState = resolve(stateDirectory)
    const registry = await new TaskRegistry({
      storePath: registryStorePath ?? join(resolvedState, "tasks.json"),
      now,
    }).load()
    // OpenCode creates a plugin instance per project/worktree. Child-session
    // permission hooks therefore run in a sibling instance and need the same
    // process-local profile registry as the parent instance that dispatched
    // the session.
    const profiles = sharedSessionProfiles()
    let coordinator
    const tracker = new CompletionTracker({
      onTerminal: async (terminal) => {
        const transition = await registry.terminal(terminal.taskID, terminal.status, terminal)
        if (transition.task.child_session_id) profiles.delete(transition.task.child_session_id)
        if (!transition.duplicate) {
          try {
            await coordinator.onTaskTerminal(transition.task)
          } catch {
            // Parent notification remains pending, but child completion is already durable.
          }
        }
      },
    })
    for (const task of registry.list()) {
      if (task.status === "running" && task.child_session_id) {
        tracker.track({
          taskID: task.task_id,
          childSessionID: task.child_session_id,
          startedAt: Date.parse(task.started_at) || Date.now(),
        })
      }
    }
    const runner = new SessionRunner({ client, registry, tracker, sessionProfiles: profiles })
    coordinator = new ParentResumeCoordinator({ client, registry })
    const workspaces = new WorkspaceManager({
      stateDirectory: resolvedState,
      hasActiveTasks: async (workspaceID) => registry.hasActiveWorkspace(workspaceID),
    })
    const skills = skillEntries
      ? new SkillResolver({ entries: skillEntries })
      : new SkillResolver({ entries: directory ? await discoverSkills({ directory, roots: skillRoots }) : [] })
    const categoryEngine = new CategoryEngine(categories, { configPath: categoryConfigPath })
    return new DelegationRuntime({
      client,
      registry,
      tracker,
      runner,
      coordinator,
      workspaces,
      dispatcher: new AgentDispatcher(categoryEngine),
      skills,
      profiles,
    })
  }

  constructor({ client, registry, tracker, runner, coordinator, workspaces, dispatcher, profiles, skills }) {
    Object.assign(this, { client, registry, tracker, runner, coordinator, workspaces, dispatcher, profiles, skills })
  }

  async workspacePrepare(args, context) {
    return this.workspaces.prepare(args, context.directory)
  }

  async delegate(args, context) {
    if (context?.agent === "Implementer") {
      throw new Error("Implementer cannot call delegate_task")
    }
    const route = this.dispatcher.resolve(args)
    const skills = this.skills.resolve(args.load_skills ?? [])
    const referencedWorkspaces = `${args.description}\n${args.prompt}`.match(/\bws_[0-9a-f-]+\b/g) ?? []
    if (!args.workspace_id && referencedWorkspaces.length) {
      throw new Error("delegation prompt references a managed workspace but workspace_id was omitted")
    }
    if (args.workspace_id && referencedWorkspaces.some((id) => id !== args.workspace_id)) {
      throw new Error("delegation prompt references a workspace that does not match workspace_id")
    }
    const workspace = args.workspace_id
      ? await this.workspaces.get(args.workspace_id)
      : { workspace_id: null, directory: await realpath(context.directory) }
    const task = await this.registry.register({
      parent_session_id: context.sessionID,
      parent_message_id: context.messageID,
      parent_agent: context.agent ?? null,
      parent_directory: await realpath(context.directory),
      execution_directory: workspace.directory,
      workspace_id: workspace.workspace_id,
      category: route.category,
      agent: route.agent,
      variant: route.profile.variant ?? null,
      description: args.description,
      background: args.run_in_background,
    })
    return this.launchTask(task, {
      directory: workspace.directory,
      route,
      description: args.description,
      prompt: args.prompt,
      skills,
      background: args.run_in_background,
    })
  }

  async consult(args, context) {
    if (context?.agent !== "Implementer") {
      throw new Error("consult_agent may only be called by Implementer")
    }
    for (const field of ["category", "load_skills", "workspace_id"]) {
      if (Object.hasOwn(args, field)) throw new Error(`consult_agent does not accept ${field}`)
    }
    const route = this.dispatcher.resolveConsultation(args.agent)
    const currentDirectory = await realpath(context.directory)
    const previous = args.session_id
      ? this.findConsultationSession(args.session_id, args.agent, context, currentDirectory)
      : null
    const directory = previous?.execution_directory ?? currentDirectory
    const description = args.description ?? `Consult ${args.agent}`
    const task = await this.registry.register({
      parent_session_id: context.sessionID,
      parent_message_id: context.messageID,
      parent_agent: context.agent,
      parent_directory: currentDirectory,
      execution_directory: directory,
      workspace_id: null,
      category: null,
      agent: route.agent,
      variant: route.profile.variant ?? null,
      description,
      background: args.run_in_background,
    })
    return this.launchTask(task, {
      directory,
      route,
      description,
      prompt: args.prompt,
      background: args.run_in_background,
      sessionID: previous?.child_session_id,
    })
  }

  findConsultationSession(sessionID, agent, context, currentDirectory) {
    const task = this.registry.list({ parent_session_id: context.sessionID })
      .find((candidate) => candidate.child_session_id === sessionID)
    if (!task || task.parent_agent !== "Implementer" || task.category !== null || task.workspace_id !== null) {
      throw new Error("session_id must reference a consultation session owned by this Implementer")
    }
    if (task.agent !== agent) {
      throw new Error(`session_id belongs to ${task.agent}; consultation target must remain ${agent}`)
    }
    if (task.status !== "completed") {
      throw new Error("session_id can continue only a completed consultation")
    }
    if (task.execution_directory !== currentDirectory) {
      throw new Error("session_id belongs to a different workspace")
    }
    return task
  }

  async launchTask(task, { directory, route, description, prompt, skills = [], background, sessionID }) {
    try {
      await this.runner.start({
        task,
        directory,
        agent: route.agent,
        category: route.category,
        profile: route.profile,
        description,
        prompt,
        skills,
        sessionID,
      })
    } catch (error) {
      await this.terminalizeStartupFailure(task.task_id, error)
      throw error
    }
    if (background) {
      return {
        task_id: task.task_id,
        status: "running",
        workspace_id: task.workspace_id,
        completion_group: task.completion_group,
        child_session_id: this.registry.get(task.task_id).child_session_id,
      }
    }
    await this.tracker.wait(task.task_id)
    return this.taskOutput(task.task_id)
  }

  async taskStatus(taskID, context, workspaceID) {
    if (taskID) return publicTask(this.registry.get(taskID))
    if (workspaceID) await this.workspaces.get(workspaceID)
    const tasks = this.registry.list({
      parent_session_id: workspaceID ? undefined : context.sessionID,
      workspace_id: workspaceID,
    }).map(publicTask)
    if (workspaceID) return tasks
    return {
      tasks,
      preserved_workspaces: (await this.workspaces.listPreserved(context.directory)).map((workspace) => ({
        ...this.workspaces.publicRecord(workspace),
        status: workspace.status,
        task_id: workspace.task_id,
        change_id: workspace.change_id,
        error: workspace.error ?? null,
      })),
    }
  }

  async terminalizeStartupFailure(taskID, error) {
    const current = this.registry.get(taskID)
    if (TERMINAL_STATUSES.has(current.status)) return current
    const tracked = await this.tracker.fail(taskID, error)
    if (tracked) return this.registry.get(taskID)
    const message = error?.message ?? String(error)
    const transition = await this.registry.terminal(taskID, "error", {
      error: `delegation startup failed: ${message}`,
    })
    if (!transition.duplicate) {
      try {
        await this.coordinator.onTaskTerminal(transition.task)
      } catch {
        // Parent notification remains pending, but startup failure is already durable.
      }
    }
    return transition.task
  }

  taskOutput(taskID, maxChars = 20_000) {
    const task = this.registry.get(taskID)
    const bounded = Math.min(Math.max(Number(maxChars) || 20_000, 1_000), 50_000)
    const result = structuredClone(task.result)
    let truncated = false
    if (result?.text?.length > bounded) {
      result.text = result.text.slice(0, bounded)
      truncated = true
    }
    return {
      ...publicTask(task),
      description: task.description,
      result,
      truncated,
    }
  }

  async taskCancel(taskID) {
    const requested = await this.registry.requestCancel(taskID)
    if (["completed", "error", "cancelled"].includes(requested.status)) return publicTask(requested)
    await this.runner.abort(requested)
    const tracked = await this.tracker.cancel(taskID)
    if (!tracked) {
      const transition = await this.registry.terminal(taskID, "cancelled", { error: "cancelled by parent request" })
      if (!transition.duplicate) await this.coordinator.onTaskTerminal(transition.task)
    }
    return publicTask(this.registry.get(taskID))
  }

  async workspaceRelease(workspaceID, context) {
    return this.workspaces.release(workspaceID, context?.directory)
  }

  delegateTaskDescription() {
    const categories = this.dispatcher.categoryEngine.list()
    const skills = this.skills.list()
    const categoryList = categories.length
      ? categories.map((entry) => `- ${entry.name}: ${entry.description || "No description"}`).join("\n")
      : "- none"
    const skillList = skills.length
      ? skills.map((entry) => `- ${entry.name}: ${entry.description || "No description"}`).join("\n")
      : "- none"
    return `Delegate one scoped assignment through a category or an allowlisted named specialist. Provide exactly one of category or agent.\n\nAvailable categories:\n${categoryList}\n\nAvailable skills (selective; full contents are loaded only when selected):\n${skillList}\n\nUse load_skills: ["skill-name"] only when the assignment needs that skill. Git mechanics require category="git". Browser work through Implementer requires category="browser-automation" and, for the current backend, load_skills=["ego-browser"]. Video-content analysis normally requires category="video-analysis" with load_skills=["watch"]; use it when evidence must come from the video itself rather than the surrounding website. Pass workspace_id for a managed workspace.`
  }

  async handleEvent(event) {
    await this.tracker.handleEvent(event)
    const properties = event?.properties ?? {}
    const sessionID = properties.sessionID
    const idle = event?.type === "session.idle"
      || (event?.type === "session.status" && properties.status?.type === "idle")
    if (!idle || !sessionID) return
    const taskID = this.tracker.taskForSession(sessionID)
    if (taskID) await this.runner.observeTask(taskID)
    await this.coordinator.onParentIdle(sessionID)
  }

  applyChatParams(sessionID, output) {
    // Category V1 uses the public session model selector for model and variant.
    // Keep the hook present for plugin compatibility; there are no legacy
    // category request-parameter overrides to apply.
  }

  async applyPermission(input, output) {
    let profile = this.profiles.get(input.sessionID)
    if (!profile && this.registry.storePath) {
      const persisted = await readJson(this.registry.storePath, { tasks: {} })
      const task = Object.values(persisted?.tasks ?? {}).find(
        (candidate) => candidate.child_session_id === input.sessionID,
      )
      if (task) profile = { category: task.category, agent: task.agent }
    }
    const decision = categoryPermission(profile, input)
    if (decision) output.status = decision
  }
}

export { defaultStateDirectory, publicTask }
