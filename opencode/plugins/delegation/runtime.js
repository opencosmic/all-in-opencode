import { realpath } from "node:fs/promises"
import { join, resolve } from "node:path"

import { AgentDispatcher } from "./agent-dispatcher.js"
import { CategoryEngine } from "./category-engine.js"
import {
  categoryPermission,
  isGitMutationCommand,
  openDesignResourceDecision,
  permissionValue,
} from "./category-permissions.js"
import { CompletionTracker } from "./completion-tracker.js"
import { readJson } from "./json-store.js"
import { ParentResumeCoordinator } from "./parent-resume-coordinator.js"
import { resolveProjectDataRoot } from "../project-data-root.js"
import { SessionRunner } from "./session-runner.js"
import { SkillResolver, discoverSkills } from "./skill-resolver.js"
import { TaskRegistry, TERMINAL_STATUSES } from "./task-registry.js"
import { isProtectedBranch, WorkspaceManager } from "./workspace-manager.js"

const SESSION_PROFILES = Symbol.for("aio.delegation.session-profiles")
const MAX_CONSULTATION_REQUESTS = 4

function sharedSessionProfiles() {
  globalThis[SESSION_PROFILES] ??= new Map()
  return globalThis[SESSION_PROFILES]
}

function defaultStateDirectory() {
  return join(resolveProjectDataRoot(), "delegation")
}

function workspaceChangeID(workspace) {
  const changeID = String(workspace?.change_id ?? "").trim()
  if (changeID) return changeID
  const legacyTaskID = String(workspace?.task_id ?? "").trim()
  return legacyTaskID || null
}

function publicTask(task) {
  return {
    task_id: task.task_id,
    status: task.status,
    workspace_id: task.workspace_id,
    change_id: task.change_id ?? null,
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
      hasActiveDirectoryTasks: async (directory) => {
        const currentDirectory = await realpath(directory)
        return registry.list().some((task) =>
          !TERMINAL_STATUSES.has(task.status) && task.execution_directory === currentDirectory)
      },
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
    this.activeConsultationSessions = new Set()
    this.preflights = new Map()
  }

  async executionPreflight(args, context) {
    if (context?.agent !== "Executor") {
      throw new Error("execution_preflight may only be called by Executor")
    }
    const changeID = String(args?.change_id ?? "").trim()
    if (!changeID) throw new Error("execution_preflight requires change_id")
    const result = await this.workspaces.preflight({
      ...args,
      change_id: changeID,
      persisted_tasks: this.registry.list(),
    }, context.directory)
    this.preflights.set(context.sessionID, {
      change_id: changeID,
      preflight_id: result.preflight_id,
      directory: result.repository.root,
      input: structuredClone(args ?? {}),
    })
    return result
  }

  async ensureExecutionPreflight(args = {}, context, workspace) {
    if (context?.agent !== "Executor") return null
    const previous = this.preflights.get(context.sessionID)
    let changeID = args.change_id ?? workspaceChangeID(workspace)
    if (!changeID) changeID = previous?.change_id
    if (!changeID) changeID = args.task_id ?? "execution"
    const currentDirectory = await realpath(context.directory)
    const priorInput = previous?.change_id === String(changeID) && previous.directory === currentDirectory
      ? previous.input ?? {}
      : {}
    return this.executionPreflight({
      ...priorInput,
      change_id: String(changeID),
      ...Object.fromEntries([
        "tasks",
        "acceptance_criteria",
        "verification",
        "dirty_ownership",
        "dirty_changes_belong_to_change",
      ].filter((key) => Object.hasOwn(args, key)).map((key) => [key, args[key]])),
    }, context)
  }

  async workspacePrepare(args, context) {
    await this.ensureExecutionPreflight(args, context)
    return this.workspaces.prepare({
      ...args,
      persisted_tasks: this.registry.list(),
    }, context.directory)
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
    const repository = args.workspace_id
      ? await this.workspaces.requireRepositoryFacts(context.directory, "delegate_task")
      : null
    if (repository) await this.workspaces.assertWorkspaceBelongsToRepository(workspace, repository, "delegate_task")
    const requestedChangeID = String(args.change_id ?? "").trim() || null
    const selectedWorkspaceChangeID = workspaceChangeID(workspace)
    if (args.workspace_id && requestedChangeID && selectedWorkspaceChangeID
      && requestedChangeID !== selectedWorkspaceChangeID) {
      throw new Error(`workspace ${args.workspace_id} belongs to logical change ${selectedWorkspaceChangeID}; cannot delegate change ${requestedChangeID}`)
    }
    const implementationRoute = route.agent === "Implementer" || route.category === "git"
    const preflight = await this.ensureExecutionPreflight(args, context, workspace)
    if (context?.agent === "Executor" && implementationRoute) {
      const branchFacts = await this.workspaces.branchFor(workspace.directory)
      if (isProtectedBranch(branchFacts.branch)) {
        throw new Error(`normal execution cannot delegate implementation or Git mutation on protected base branch ${branchFacts.branch}`)
      }
      if (!args.workspace_id && (
        !preflight?.recommended_primary_workspace
        || preflight.recommended_primary_workspace.directory !== workspace.directory
      )) {
        throw new Error("Executor must resolve the primary change workspace before delegating implementation")
      }
      const workspaceInUse = workspace.workspace_id
        ? this.registry.hasActiveWorkspace(workspace.workspace_id)
          || await this.workspaces.hasActiveDirectoryTasks(workspace.directory)
        : await this.workspaces.hasActiveDirectoryTasks(workspace.directory)
      if (workspaceInUse) {
        throw new Error("execution workspace already has an active task; serialize this work or use an explicitly isolated child workspace")
      }
    }
    const task = await this.registry.register({
      parent_session_id: context.sessionID,
      parent_message_id: context.messageID,
      parent_agent: context.agent ?? null,
      parent_directory: await realpath(context.directory),
      execution_directory: workspace.directory,
      workspace_id: workspace.workspace_id,
      change_id: requestedChangeID
        ?? selectedWorkspaceChangeID
        ?? this.preflights.get(context.sessionID)?.change_id
        ?? null,
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

  async consultAgents(args, context) {
    if (context?.agent !== "Implementer") {
      throw new Error("consult_agents may only be called by Implementer")
    }
    if (!args || typeof args !== "object" || !Array.isArray(args.requests)) {
      throw new Error("consult_agents requires a requests array")
    }
    if (args.requests.length < 1 || args.requests.length > MAX_CONSULTATION_REQUESTS) {
      throw new Error(`consult_agents accepts 1-${MAX_CONSULTATION_REQUESTS} requests`)
    }
    for (const field of ["category", "load_skills", "workspace_id", "run_in_background"]) {
      if (Object.hasOwn(args, field)) throw new Error(`consult_agents does not accept ${field}`)
    }
    const currentDirectory = await realpath(context.directory)
    const seenSessions = new Set()
    const plans = args.requests.map((request, index) => {
      if (!request || typeof request !== "object") {
        throw new Error(`consult_agents request ${index + 1} must be an object`)
      }
      for (const field of ["category", "load_skills", "workspace_id", "run_in_background"]) {
        if (Object.hasOwn(request, field)) throw new Error(`consult_agents does not accept ${field} in request ${index + 1}`)
      }
      if (typeof request.prompt !== "string" || !request.prompt.trim()) {
        throw new Error(`consult_agents request ${index + 1} requires a non-empty prompt`)
      }
      if (request.description !== undefined && (typeof request.description !== "string" || !request.description.trim())) {
        throw new Error(`consult_agents request ${index + 1} description must be non-empty when provided`)
      }
      if (request.session_id !== undefined) {
        if (typeof request.session_id !== "string" || !request.session_id.trim()) {
          throw new Error(`consult_agents request ${index + 1} session_id must be non-empty when provided`)
        }
        if (seenSessions.has(request.session_id)) {
          throw new Error(`consult_agents batch cannot repeat session_id: ${request.session_id}`)
        }
        seenSessions.add(request.session_id)
      }
      const route = this.dispatcher.resolveConsultation(request.agent)
      const previous = request.session_id
        ? this.findConsultationSession(request.session_id, request.agent, context, currentDirectory)
        : null
      if (previous && this.activeConsultationSessions.has(previous.child_session_id)) {
        throw new Error("session_id is already being continued")
      }
      return { request, route, previous }
    })

    const results = await Promise.all(plans.map((plan) => this.consultOne(plan, context, currentDirectory)))
    return { results }
  }

  findConsultationSession(sessionID, agent, context, currentDirectory) {
    const tasks = this.registry.list({ parent_session_id: context.sessionID })
      .filter((candidate) => candidate.child_session_id === sessionID)
    if (tasks.some((candidate) => !TERMINAL_STATUSES.has(candidate.status))) {
      throw new Error("session_id cannot continue an in-flight consultation")
    }
    const consultations = tasks.filter((candidate) =>
      candidate.parent_agent === "Implementer"
      && candidate.category === null
      && candidate.workspace_id === null
      && ["Explorer", "Librarian"].includes(candidate.agent))
    if (!consultations.length) {
      throw new Error("session_id must reference a consultation session owned by this Implementer")
    }
    const task = [...consultations].reverse().find((candidate) => candidate.status === "completed")
    if (!task) {
      throw new Error("session_id can continue only a completed consultation")
    }
    if (task.agent !== agent) {
      throw new Error(`session_id belongs to ${task.agent}; cannot continue it as ${agent}`)
    }
    if (task.execution_directory !== currentDirectory) {
      throw new Error("session_id belongs to a different workspace")
    }
    return task
  }

  async consultOne({ request, route, previous }, context, currentDirectory) {
    const sessionID = previous?.child_session_id
    if (sessionID) {
      if (this.activeConsultationSessions.has(sessionID)) {
        return this.consultationError(request.agent, new Error("session_id is already being continued"))
      }
      this.activeConsultationSessions.add(sessionID)
    }
    let task
    try {
      const directory = previous?.execution_directory ?? currentDirectory
      const description = request.description ?? `Consult ${request.agent}`
      task = await this.registry.register({
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
        background: false,
      })
      const output = await this.launchTask(task, {
        directory,
        route,
        description,
        prompt: request.prompt,
        background: false,
        sessionID,
      })
      return this.consultationOutcome(request.agent, output)
    } catch (error) {
      if (task) {
        try {
          return this.consultationOutcome(request.agent, this.taskOutput(task.task_id), error)
        } catch {
          // Fall through to the bounded error outcome below.
        }
      }
      return this.consultationError(request.agent, error, task)
    } finally {
      if (sessionID) this.activeConsultationSessions.delete(sessionID)
    }
  }

  consultationOutcome(agent, output, fallbackError) {
    return {
      agent,
      status: output.status,
      task_id: output.task_id,
      session_id: output.child_session_id ?? null,
      ...(output.result ? { result: output.result } : {}),
      ...(output.error || fallbackError ? { error: output.error ?? fallbackError?.message ?? String(fallbackError) } : {}),
    }
  }

  consultationError(agent, error, task) {
    return {
      agent,
      status: "error",
      task_id: task?.task_id ?? null,
      session_id: task?.child_session_id ?? null,
      error: error?.message ?? String(error),
    }
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

  async workspaceRelease(workspaceID, context, options = {}) {
    return this.workspaces.release(workspaceID, context?.directory, options)
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
    return `Delegate one scoped assignment through a category or an allowlisted named specialist. Provide exactly one of category or agent.\n\nAvailable categories:\n${categoryList}\n\nAvailable skills (selective; full contents are loaded only when selected):\n${skillList}\n\nUse load_skills: ["skill-name"] only when the assignment needs that skill. If a selected skill is required by the assignment but unavailable, surface the capability or setup failure instead of retrying the same assignment without it; omit a skill only when it is explicitly optional and the fallback remains semantically valid. Git mechanics require category="git". Browser work through Implementer requires category="browser-automation" and, for the current backend, load_skills=["ego-browser"]. Video-content analysis normally requires category="video-analysis" with load_skills=["watch"]; use it when evidence must come from the video itself rather than the surrounding website. For frontend/UI/design work that benefits from OpenDesign design-system or design-skill references, use category="visual-engineering" with load_skills=["open-design"]. This optional skill provides read-only design context; OpenCode remains responsible for implementation. Pass workspace_id for a managed workspace.`
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
    let profile = this.profiles?.get(input.sessionID)
    let task
    if (!profile && this.registry?.storePath) {
      const persisted = await readJson(this.registry.storePath, { tasks: {} })
      task = Object.values(persisted?.tasks ?? {}).find(
        (candidate) => candidate.child_session_id === input.sessionID,
      )
      if (task) profile = { category: task.category, agent: task.agent }
    }
    task ??= this.registry?.list?.().find((candidate) => candidate.child_session_id === input.sessionID)
    let decision = categoryPermission(profile, input)
    const type = input.type ?? input.permission
    if (decision && profile?.category === "git" && type === "bash" && isGitMutationCommand(permissionValue(input))) {
      try {
        const branchFacts = task?.execution_directory
          ? await this.workspaces?.branchFor(task.execution_directory)
          : null
        if (!branchFacts || isProtectedBranch(branchFacts.branch)) decision = "deny"
      } catch {
        // A Git mutation with an uninspectable target is unsafe; fail closed.
        decision = "deny"
      }
    }
    if (decision) output.status = decision
  }

  async applyToolExecutionBefore(input, output) {
    const decision = openDesignResourceDecision(
      this.profiles.get(input.sessionID),
      input.tool,
      output?.args,
    )
    if (decision === "deny") {
      throw new Error(
        "OpenDesign MCP resources require an Implementer child in category=visual-engineering with load_skills=[open-design]",
      )
    }
  }
}

export { defaultStateDirectory, publicTask }
