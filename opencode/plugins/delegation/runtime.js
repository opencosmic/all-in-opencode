import { realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import { AgentDispatcher } from "./agent-dispatcher.js"
import { CategoryEngine } from "./category-engine.js"
import { CompletionTracker } from "./completion-tracker.js"
import { ParentResumeCoordinator } from "./parent-resume-coordinator.js"
import { SessionRunner } from "./session-runner.js"
import { TaskRegistry } from "./task-registry.js"
import { WorkspaceManager } from "./workspace-manager.js"

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
    unsupported_profile_fields: task.unsupported_profile_fields,
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
    now,
  } = {}) {
    const resolvedState = resolve(stateDirectory)
    const registry = await new TaskRegistry({
      storePath: registryStorePath ?? join(resolvedState, "tasks.json"),
      now,
    }).load()
    const profiles = new Map()
    let coordinator
    const tracker = new CompletionTracker({
      onTerminal: async (terminal) => {
        const transition = await registry.terminal(terminal.taskID, terminal.status, terminal)
        if (transition.task.child_session_id) profiles.delete(transition.task.child_session_id)
        if (!transition.duplicate) await coordinator.onTaskTerminal(transition.task)
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
    return new DelegationRuntime({
      client,
      registry,
      tracker,
      runner,
      coordinator,
      workspaces,
      dispatcher: new AgentDispatcher(new CategoryEngine(categories)),
      profiles,
    })
  }

  constructor({ client, registry, tracker, runner, coordinator, workspaces, dispatcher, profiles }) {
    Object.assign(this, { client, registry, tracker, runner, coordinator, workspaces, dispatcher, profiles })
  }

  async workspacePrepare(args, context) {
    return this.workspaces.prepare(args, context.directory)
  }

  async delegate(args, context) {
    const route = this.dispatcher.resolve(args)
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
      description: args.description,
      background: args.run_in_background,
      unsupported_profile_fields: route.profile.unsupported_public_fields,
    })
    await this.runner.start({
      task,
      directory: workspace.directory,
      agent: route.agent,
      profile: route.profile,
      description: args.description,
      prompt: args.prompt,
    })
    if (args.run_in_background) {
      return {
        task_id: task.task_id,
        status: "running",
        workspace_id: workspace.workspace_id,
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

  async workspaceRelease(workspaceID) {
    return this.workspaces.release(workspaceID)
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
    const profile = this.profiles.get(sessionID)
    if (!profile) return
    if (profile.temperature !== undefined) output.temperature = profile.temperature
    if (profile.top_p !== undefined) output.topP = profile.top_p
    if (profile.max_tokens !== undefined) output.maxOutputTokens = profile.max_tokens
  }
}

export { defaultStateDirectory, publicTask }
