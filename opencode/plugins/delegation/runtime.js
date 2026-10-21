import { realpath } from "node:fs/promises"
import { join, resolve } from "node:path"

import { normalizeAioConfig, loadAioConfig } from "./aio-config.js"
import { AgentDispatcher } from "./agent-dispatcher.js"
import { CategoryEngine } from "./category-engine.js"
import {
  categoryPermission,
  isFilmProductionReferencePath,
  isGitMutationCommand,
  openDesignResourceDecision,
  permissionValue,
  resolveFilmProductionSkillAccess,
} from "./category-permissions.js"
import { CompletionTracker } from "./completion-tracker.js"
import { readJson } from "./json-store.js"
import { createAtlasMediaRuntime, createMockMediaRuntime, isMediaRuntimeTool } from "./media-runtime.js"
import { ParentResumeCoordinator } from "./parent-resume-coordinator.js"
import {
  productionApproveGeneration,
  productionApproveFinalRender,
  productionCheckpoint,
  productionPreflight,
  productionPrepareArtifacts,
  productionRecordOutput,
  productionSetShots,
  productionTransition,
  editorFfprobeAllows,
  editorAssetCopyAllows,
  editorCompositionMutationAllows,
  hyperFramesCommandPathTargets,
  editorHyperFramesRenderAllows,
  editorHyperFramesPathAllows,
  isApprovedRenderProjectMutationTarget,
  isCanonicalManifestMutationTarget,
} from "./production-control.js"
import { resolveProjectDataRoot } from "../shared/project-data-root.js"
import { SessionRunner } from "./session-runner.js"
import { SkillResolver, discoverSkills } from "./skill-resolver.js"
import { TaskRegistry, TERMINAL_STATUSES } from "./task-registry.js"
import { isProtectedBranch, WorkspaceManager } from "./workspace-manager.js"

const SESSION_PROFILES = Symbol.for("aio.delegation.session-profiles")
const MAX_CONSULTATION_REQUESTS = 4
const RESERVED_DELEGATED_SKILL = "ego-browser"
const CATEGORY_CATALOG_AGENTS = new Set([
  "Assistant",
  "Executor",
  "Planner",
  "Strategist",
  "Producer",
])
const CATEGORY_CATALOG_MARKER = "<AIO_Delegation_Categories>"
const EDITOR_HYPERFRAMES_COMMANDS = new Set([
  "check", "lint", "snapshot", "preview", "info", "compositions", "catalog", "doctor", "add", "init",
])

async function editorBashDecision(command, directory) {
  const hyperframes = hyperFramesCommandPathTargets(command)
  if (!hyperframes) return await editorFfprobeAllows(command, directory)
    || await editorAssetCopyAllows(command, directory) ? "allow" : "deny"
  if (hyperframes.invalid) return "deny"
  if (hyperframes.subcommand === "catalog") {
    const args = hyperframes.words.slice(hyperframes.commandIndex + 1)
    return (args.length === 1 && args[0] === "--json")
      || (args.length === 3 && args[0] === "--query" && args[1] && args[2] === "--json") ? "allow" : "deny"
  }
  if (hyperframes.subcommand === "doctor") {
    const args = hyperframes.words.slice(hyperframes.commandIndex + 1)
    return args.length === 0 || (args.length === 1 && args[0] === "--json") ? "allow" : "deny"
  }
  if (hyperframes.subcommand === "skills") {
    const args = hyperframes.words.slice(hyperframes.commandIndex + 1)
    return args[0] === "update" && args.length <= 2
      && (args[1] === undefined || /^[a-z0-9-]+$/.test(args[1])) ? "ask" : "deny"
  }
  if (hyperframes.subcommand !== "render" && !EDITOR_HYPERFRAMES_COMMANDS.has(hyperframes.subcommand)) return "deny"
  if (hyperframes.subcommand === "init" && hyperframes.words[0] !== "HYPERFRAMES_SKIP_SKILLS=1") return "deny"
  if (hyperframes.subcommand === "render") {
    const projectPath = hyperframes.words[hyperframes.commandIndex + 1]
    if (!await editorHyperFramesPathAllows(projectPath, directory)) return "deny"
    return await editorHyperFramesRenderAllows(command, directory) ? "allow" : "deny"
  }
  for (const target of hyperframes.paths) {
    if (!await editorHyperFramesPathAllows(target, directory)) return "deny"
    if (await isApprovedRenderProjectMutationTarget(target, directory)) return "deny"
  }
  return hyperframes.subcommand === "init" ? "ask" : "allow"
}

function assertDelegatedSkillsAllowed(names) {
  if (Array.isArray(names) && names.includes(RESERVED_DELEGATED_SKILL)) {
    throw new Error(
      "ego-browser is reserved for the dedicated Browser route and cannot be loaded by delegated workers",
    )
  }
}

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
    aioConfig,
    aioConfigPath,
    categories,
    agents,
    delegation,
    availableAgents,
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
    coordinator = new ParentResumeCoordinator({ client, registry })
    const workspaces = new WorkspaceManager({
      stateDirectory: resolvedState,
      hasActiveTasks: async (workspaceID) => registry.hasActiveWorkspace(workspaceID),
      hasActiveDirectoryTasks: async (directory) => {
        const currentDirectory = await realpath(directory)
        return registry.list().some((task) =>
          !TERMINAL_STATUSES.has(task.status) && task.execution_directory === currentDirectory)
      },
      now,
    })
    const skills = skillEntries
      ? new SkillResolver({ entries: skillEntries })
      : new SkillResolver({ entries: directory ? await discoverSkills({ directory, roots: skillRoots }) : [] })
    const filmProductionSkillAccess = await resolveFilmProductionSkillAccess(skills)
    const runner = new SessionRunner({
      client, registry, tracker, sessionProfiles: profiles, filmProductionSkillAccess,
    })
    const config = aioConfig !== undefined
      ? normalizeAioConfig(aioConfig, { configPath: aioConfigPath })
      : categories !== undefined || agents !== undefined || delegation !== undefined
        ? normalizeAioConfig({ version: 1, categories: categories ?? {}, agents: agents ?? {}, delegation: delegation ?? {} }, { configPath: "<injected>" })
        : loadAioConfig({ configPath: aioConfigPath })
    const categoryEngine = new CategoryEngine(config.categories)
    const agentDiscovery = availableAgents === undefined && typeof client?.app?.agents === "function"
      ? ({ directory: targetDirectory }) => AgentDispatcher.discoverAgents({ client, directory: targetDirectory })
      : null
    return new DelegationRuntime({
      client,
      registry,
      tracker,
      runner,
      coordinator,
      workspaces,
      dispatcher: new AgentDispatcher(categoryEngine, { aioConfig: config, availableAgents }),
      skills,
      filmProductionSkillAccess,
      profiles,
      agentDiscovery,
      directory,
      mediaRuntime: createAtlasMediaRuntime({ directory }),
    })
  }

  constructor({ client, registry, tracker, runner, coordinator, workspaces, dispatcher, profiles, skills, filmProductionSkillAccess, agentDiscovery, directory, mediaRuntime }) {
    Object.assign(this, {
      client,
      registry,
      tracker,
      runner,
      coordinator,
      workspaces,
      dispatcher,
      profiles,
      skills,
      filmProductionSkillAccess,
      agentDiscovery,
      directory,
      mediaRuntime: mediaRuntime ?? createMockMediaRuntime(),
    })
    this.sessionAgents = new Map()
    this.activeConsultationSessions = new Set()
    this.preflights = new Map()
    this.agentDiscoveryPromise = null
  }

  async ensureAgentPolicy(directory) {
    if (!this.agentDiscovery && !this.agentDiscoveryPromise) return
    this.agentDiscoveryPromise ??= this.agentDiscovery({ directory })
    try {
      const agents = await this.agentDiscoveryPromise
      this.dispatcher.setAvailableAgents(agents)
      this.agentDiscovery = null
    } catch (error) {
      this.agentDiscoveryPromise = null
      throw error
    }
    this.agentDiscoveryPromise = null
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

  assertProducerProductionTool(context, name) {
    if (context?.agent !== "Producer"
      || typeof context?.sessionID !== "string"
      || !context.sessionID.trim()
      || (context?.sessionID && this.profiles?.has(context.sessionID))
      || (context?.sessionID && this.registry?.list().some((task) => task.child_session_id === context.sessionID))) {
      throw new Error(`${name} may only be called by the primary Producer`)
    }
  }

  async productionPreflight(args, context) {
    this.assertProducerProductionTool(context, "production_preflight")
    return productionPreflight(args, context.directory)
  }

  async productionPrepareArtifacts(args, context) {
    this.assertProducerProductionTool(context, "production_prepare_artifacts")
    return productionPrepareArtifacts(args, context.directory)
  }

  async productionCheckpoint(args, context) {
    this.assertProducerProductionTool(context, "production_checkpoint")
    return productionCheckpoint(args, context.directory)
  }

  async productionApproveGeneration(args, context) {
    this.assertProducerProductionTool(context, "production_approve_generation")
    return productionApproveGeneration(args, context.directory)
  }

  async productionRecordOutput(args, context) {
    this.assertProducerProductionTool(context, "production_record_output")
    return productionRecordOutput(args, context.directory)
  }

  async productionApproveFinalRender(args, context) {
    this.assertProducerProductionTool(context, "production_approve_final_render")
    return productionApproveFinalRender(args, context.directory)
  }

  async productionSetShots(args, context) {
    this.assertProducerProductionTool(context, "production_set_shots")
    return productionSetShots(args, context.directory)
  }

  async productionTransition(args, context) {
    this.assertProducerProductionTool(context, "production_transition")
    return productionTransition(args, context.directory)
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

  async workspaceCheckpointUpdate(args = {}, context) {
    const agent = context?.agent
    if (![
      "Executor",
      "Implementer",
    ].includes(agent)) {
      throw new Error("workspace_checkpoint_update may only be called by Executor or Implementer")
    }

    const requestedWorkspaceID = String(args.workspace_id ?? "").trim() || null
    let task = null
    let workspaceID = requestedWorkspaceID
    if (agent === "Implementer") {
      task = this.registry.list().find((candidate) => candidate.child_session_id === context.sessionID) ?? null
      if (!task || task.agent !== "Implementer") {
        throw new Error("Implementer checkpoint updates require an active task owned by the current session")
      }
      if (task.status !== "running") {
        throw new Error("Implementer checkpoint updates require the current task to be running")
      }
      if (!task.workspace_id) {
        throw new Error("Implementer checkpoint updates require a managed workspace")
      }
      if (workspaceID && workspaceID !== task.workspace_id) {
        throw new Error("Implementer checkpoint update workspace_id must match the current task workspace")
      }
      workspaceID = task.workspace_id
    }
    if (!workspaceID) throw new Error("workspace_checkpoint_update requires workspace_id")

    const repository = await this.workspaces.requireRepositoryFacts(
      context.directory,
      "workspace_checkpoint_update",
    )
    const workspace = await this.workspaces.get(workspaceID)
    await this.workspaces.assertWorkspaceBelongsToRepository(
      workspace,
      repository,
      "workspace_checkpoint_update",
    )

    const selectedChangeID = workspaceChangeID(workspace)
    const requestedChangeID = String(args.change_id ?? "").trim() || null
    const preflightChangeID = agent === "Executor"
      ? String(this.preflights.get(context.sessionID)?.change_id ?? "").trim() || null
      : null
    if (requestedChangeID && preflightChangeID && requestedChangeID !== preflightChangeID) {
      throw new Error(`workspace checkpoint change ${requestedChangeID} does not match the current execution preflight change ${preflightChangeID}`)
    }
    const effectiveChangeID = requestedChangeID ?? preflightChangeID
    if (effectiveChangeID && selectedChangeID && effectiveChangeID !== selectedChangeID) {
      throw new Error(`workspace ${workspaceID} belongs to logical change ${selectedChangeID}; cannot update checkpoint for change ${effectiveChangeID}`)
    }

    let checkpointTaskID = args.task_id
    if (task) {
      const taskChangeID = String(task.change_id ?? "").trim() || null
      if (taskChangeID && selectedChangeID && taskChangeID !== selectedChangeID) {
        throw new Error("Implementer checkpoint update task does not belong to the workspace logical change")
      }
      const currentDirectory = await realpath(context.directory)
      const taskDirectory = await realpath(task.execution_directory)
      if (currentDirectory !== workspace.directory || taskDirectory !== workspace.directory) {
        throw new Error("Implementer checkpoint update requires the current task and session workspace")
      }
      if (checkpointTaskID !== undefined && String(checkpointTaskID).trim() !== task.task_id) {
        throw new Error("Implementer checkpoint update task_id must match the current task")
      }
      checkpointTaskID = task.task_id
    } else {
      checkpointTaskID = String(checkpointTaskID ?? "").trim()
      if (!checkpointTaskID) {
        throw new Error("Executor checkpoint update requires explicit task_id; workspace creation task_id is not current execution identity")
      }
      const targetTask = this.registry.list().find((candidate) => candidate.task_id === checkpointTaskID)
      if (!targetTask) {
        throw new Error(`unknown checkpoint execution task_id: ${checkpointTaskID}`)
      }
      if (targetTask.workspace_id !== workspaceID) {
        throw new Error(`checkpoint task ${checkpointTaskID} belongs to workspace ${targetTask.workspace_id ?? "none"}; cannot update workspace ${workspaceID}`)
      }
      const targetChangeID = String(targetTask.change_id ?? "").trim() || null
      if (targetChangeID !== selectedChangeID) {
        throw new Error(`checkpoint task ${checkpointTaskID} belongs to logical change ${targetChangeID ?? "none"}; cannot update change ${selectedChangeID ?? "none"}`)
      }
      const targetDirectory = targetTask.execution_directory
        ? await realpath(targetTask.execution_directory).catch(() => null)
        : null
      if (targetDirectory !== workspace.directory) {
        throw new Error(`checkpoint task ${checkpointTaskID} does not belong to workspace ${workspaceID}`)
      }
      const targetRepository = await this.workspaces.repositoryFacts(targetDirectory)
      if (targetRepository.projectKey !== repository.projectKey || targetRepository.commonDir !== repository.commonDir) {
        throw new Error(`checkpoint task ${checkpointTaskID} does not belong to the current repository`)
      }
    }

    return this.workspaces.updateCheckpoint(workspaceID, {
      ...args,
      task_id: checkpointTaskID,
    })
  }

  async delegate(args, context) {
    if (context?.agent === "Implementer") {
      throw new Error("Implementer cannot call delegate_task")
    }
    const requestedSkills = args.load_skills ?? []
    assertDelegatedSkillsAllowed(requestedSkills)
    await this.ensureAgentPolicy(context.directory)
    const route = this.dispatcher.resolve({ ...args, parentAgent: context?.agent })
    const skills = this.skills.resolve(requestedSkills)
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
    await this.ensureAgentPolicy(context.directory)
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
          return this.consultationOutcome(request.agent, this.taskOutputForTask(this.registry.get(task.task_id)), error)
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
    return this.taskOutputForTask(this.registry.get(task.task_id))
  }

  async taskStatus(taskID, context, workspaceID) {
    const parentSessionID = this.requireParentSession(context)
    if (taskID) return publicTask(this.assertTaskOwned(taskID, parentSessionID))
    if (workspaceID) await this.workspaces.get(workspaceID)
    const tasks = this.registry.list({
      parent_session_id: parentSessionID,
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

  taskOutput(taskID, maxChars = 20_000, context) {
    const task = this.assertTaskOwned(taskID, this.requireParentSession(context))
    return this.taskOutputForTask(task, maxChars)
  }

  taskOutputForTask(task, maxChars = 20_000) {
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

  async taskCancel(taskID, context) {
    const parentSessionID = this.requireParentSession(context)
    this.assertTaskOwned(taskID, parentSessionID)
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

  requireParentSession(context) {
    const sessionID = typeof context?.sessionID === "string" ? context.sessionID.trim() : ""
    if (!sessionID) throw new Error("task access requires the current parent session")
    return sessionID
  }

  assertTaskOwned(taskID, parentSessionID) {
    let task
    try {
      task = this.registry.get(taskID)
    } catch {
      throw new Error("task is not owned by the current parent session")
    }
    if (task.parent_session_id !== parentSessionID) {
      throw new Error("task is not owned by the current parent session")
    }
    return task
  }

  async workspaceRelease(workspaceID, context, options = {}) {
    return this.workspaces.release(workspaceID, context?.directory, options)
  }

  delegateTaskDescription() {
    const skills = this.skills.list().filter((entry) => entry.name !== RESERVED_DELEGATED_SKILL)
    const skillList = skills.length
      ? skills.map((entry) => `- ${entry.name}: ${entry.description || "No description"}`).join("\n")
      : "- none"
    return `Delegate one scoped assignment through a category or a configured named specialist. Provide exactly one of category or agent. Category routes execute through the shared Implementer contract; named specialists use their configured route. The caller-specific AIO delegation context supplied to this agent is the authorization source, so use only a category or named agent that it permits. A foreground assignment waits for its bounded result. A background assignment returns a task_id and running status for later task_status, task_output, or task_cancel calls; those task controls are limited to children created by this parent session. Pass workspace_id for a managed workspace.\n\nAvailable skills (selective; full contents are loaded only when selected):\n${skillList}\n\nUse load_skills: ["skill-name"] only when the assignment needs that skill. If a selected skill is required by the assignment but unavailable, surface the capability or setup failure instead of retrying the same assignment without it; omit a skill only when it is explicitly optional and the fallback remains semantically valid. For frontend/UI/design work that benefits from optional OpenDesign context, use category="visual-engineering" with load_skills=["open-design"] only when that caller's catalog authorizes it.`
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

  async applyChatParams(sessionID, output, agent) {
    this.observeSessionAgent({ sessionID, agent })
    if (!agent) return
    try {
      await this.ensureAgentPolicy()
    } catch {
      // Prompt decoration is advisory; an unavailable discovery endpoint must
      // not prevent an otherwise valid chat from starting.
    }
  }

  observeSessionAgent({ sessionID, agent } = {}) {
    if (typeof sessionID !== "string" || !sessionID.trim()) return
    if (typeof agent !== "string" || !agent.trim()) return
    this.sessionAgents.set(sessionID, agent.trim())
  }

  async assertMediaToolAccess(sessionID, toolName) {
    let profile = this.profiles?.get(sessionID)
    if (!profile && this.registry?.storePath) {
      const persisted = await readJson(this.registry.storePath, { tasks: {} })
      const task = Object.values(persisted?.tasks ?? {}).find(
        (candidate) => candidate.child_session_id === sessionID,
      )
      if (task) profile = { category: task.category, agent: task.agent, directory: task.execution_directory ?? this.directory }
    }
    const decision = categoryPermission(profile, { type: toolName, pattern: "*" })
    if (decision !== "allow") {
      throw new Error("media runtime tools require an Implementer child in category=media-generation")
    }
  }

  applyChatSystem(sessionID, output) {
    const agent = this.sessionAgents.get(sessionID) ?? this.profiles?.get(sessionID)?.agent
    if (!agent || agent === "Blender") return
    const categories = agent ? this.dispatcher.authorizedCategories(agent) : []
    if (agent !== "Searcher" && agent !== "Browser" && !CATEGORY_CATALOG_AGENTS.has(agent) && !categories.length) return
    if (agent === "Searcher" || agent === "Browser") return

    const categoryList = categories.length
      ? categories.map((entry) => `- ${entry.name}: ${entry.description || "No description"}`).join("\n")
      : "- none"
    const context = `${CATEGORY_CATALOG_MARKER}\nCaller-authorized AIO categories for ${agent} (disabled categories omitted):\n${categoryList}\n</AIO_Delegation_Categories>`
    const system = Array.isArray(output?.system)
      ? output.system
      : typeof output?.system === "string"
        ? [output.system]
        : []
    if (system.some((entry) => typeof entry === "string" && entry.includes(CATEGORY_CATALOG_MARKER))) return
    output.system = [...system, context]
  }

  async applyPermission(input, output) {
    let profile = this.profiles?.get(input.sessionID)
    let task
    if (!profile && this.registry?.storePath) {
      const persisted = await readJson(this.registry.storePath, { tasks: {} })
      task = Object.values(persisted?.tasks ?? {}).find(
        (candidate) => candidate.child_session_id === input.sessionID,
      )
      if (task) profile = { category: task.category, agent: task.agent, directory: task.execution_directory ?? this.directory }
    }
    task ??= this.registry?.list?.().find((candidate) => candidate.child_session_id === input.sessionID)
    let decision = categoryPermission(profile, input)
    const type = input.type ?? input.permission
    const agent = profile?.agent ?? this.sessionAgents.get(input.sessionID)
    const directory = profile?.directory ?? input.directory ?? this.directory
    if (agent === "Editor" && ["edit", "write"].includes(type)) {
      const target = permissionValue(input)
      decision = target && !await isApprovedRenderProjectMutationTarget(target, directory)
        && await editorCompositionMutationAllows(target, directory) ? "allow" : "deny"
    }
    if (agent === "Editor" && type === "bash") {
      decision = await editorBashDecision(permissionValue(input), directory)
    }
    if (type === "external_directory" && !profile?.category) {
      if (agent === "Producer") {
        if (await isFilmProductionReferencePath(permissionValue(input), this.filmProductionSkillAccess)) {
          decision = "allow"
        }
      } else if (agent === "Director" || agent === "Creator") {
        decision = await isFilmProductionReferencePath(permissionValue(input), this.filmProductionSkillAccess)
          ? "allow"
          : "deny"
      }
    }
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
    const profile = this.profiles?.get(input.sessionID)
    const agent = profile?.agent ?? this.sessionAgents.get(input.sessionID)
    if (agent === "Editor") {
      const directory = profile?.directory ?? input.directory ?? this.directory
      const args = output?.args ?? input.args ?? {}
      if (["edit", "write", "apply_patch"].includes(input.tool)) {
        const targets = input.tool === "apply_patch"
          ? [...String(args.patchText ?? args.patch_text ?? "").matchAll(/^\*\*\* (?:Add File:|Update File:|Delete File:|Move to:) (.+)$/gm)].map((match) => match[1])
          : [args.filePath ?? args.file_path ?? args.path ?? args.file ?? args.filename]
        if (!targets.length || targets.some((target) => typeof target !== "string" || !target.trim()) || typeof directory !== "string") {
          throw new Error("Editor file mutation requires a bound project path")
        }
        for (const target of targets) {
          if (await isCanonicalManifestMutationTarget(target, directory)) {
            throw new Error("Editor cannot mutate the canonical production/production-manifest.json")
          }
          if (await isApprovedRenderProjectMutationTarget(target, directory)) {
            throw new Error("Editor cannot change the approved HyperFrames project before its final render")
          }
          if (!await editorCompositionMutationAllows(target, directory)) {
            throw new Error("Editor file mutations are limited to safe files under production/composition/")
          }
        }
      }
      if (input.tool === "bash") {
        const command = input.metadata?.command ?? input.command ?? args.command ?? args.cmd
        const requestedDirectory = args.workdir ?? args.cwd
        if (requestedDirectory !== undefined && await realpath(requestedDirectory) !== await realpath(directory)) {
          throw new Error("Editor HyperFrames commands must run from the bound production workspace")
        }
        if (await editorBashDecision(command, directory) === "deny") {
          throw new Error("Editor Bash requires a safe local HyperFrames command; final rendering requires current Producer approval")
        }
      }
    }
    if (isMediaRuntimeTool(input.tool)) {
      await this.assertMediaToolAccess(input.sessionID, input.tool)
    }
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
