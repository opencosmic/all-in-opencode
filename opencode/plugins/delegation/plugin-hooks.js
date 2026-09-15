import { tool } from "@opencode-ai/plugin"

function json(value) {
  return JSON.stringify(value, null, 2)
}

export function delegationPluginHooks(runtime) {
  return {
    tool: {
      execution_preflight: tool({
        description: "Reconcile one logical change with current Git, managed workspace, persisted task, dependency, source-overlap, contention, and verification state before execution topology is chosen.",
        args: {
          change_id: tool.schema.string().min(1),
          tasks: tool.schema.array(tool.schema.object({
            task_id: tool.schema.string().min(1).optional(),
            id: tool.schema.string().min(1).optional(),
            description: tool.schema.string().min(1).optional(),
            title: tool.schema.string().min(1).optional(),
            dependencies: tool.schema.array(tool.schema.string().min(1)).optional(),
            depends_on: tool.schema.array(tool.schema.string().min(1)).optional(),
            write_scope: tool.schema.array(tool.schema.string().min(1)).optional(),
            paths: tool.schema.array(tool.schema.string().min(1)).optional(),
            files: tool.schema.array(tool.schema.string().min(1)).optional(),
            acceptance_criteria: tool.schema.array(tool.schema.string().min(1)).optional(),
            requires_uncommitted: tool.schema.boolean().optional(),
            depends_on_uncommitted: tool.schema.boolean().optional(),
            independent_from_uncommitted: tool.schema.boolean().optional(),
          }).strict()).optional(),
          acceptance_criteria: tool.schema.array(tool.schema.string().min(1)).optional(),
          verification: tool.schema.array(tool.schema.string().min(1)).optional(),
          dirty_ownership: tool.schema.enum(["same-change", "unrelated", "unknown"]).optional(),
          dirty_changes_belong_to_change: tool.schema.boolean().optional(),
        },
        execute: async (args, context) => json(await runtime.executionPreflight(args, context)),
      }),
      workspace_prepare: tool({
        description: "Resolve or create a provenance-bound primary workspace for a logical change; use a child worktree only with an explicit isolation reason and parent workspace.",
        args: {
          task_id: tool.schema.string().min(1).optional(),
          change_id: tool.schema.string().min(1).optional(),
          base_sha: tool.schema.string().min(1).optional(),
          branch: tool.schema.string().min(1).optional(),
          role: tool.schema.enum(["primary", "child"]).optional(),
          parent_workspace_id: tool.schema.string().min(1).optional(),
          primary_workspace_id: tool.schema.string().min(1).optional(),
          isolation_reason: tool.schema.string().min(1).optional(),
          reason: tool.schema.string().min(1).optional(),
          reuse_current: tool.schema.boolean().optional(),
          dirty_ownership: tool.schema.enum(["same-change", "unrelated", "unknown"]).optional(),
          dirty_changes_belong_to_change: tool.schema.boolean().optional(),
          independent_from_uncommitted: tool.schema.boolean().optional(),
          depends_on_uncommitted: tool.schema.boolean().optional(),
          requires_uncommitted: tool.schema.boolean().optional(),
        },
        execute: async (args, context) => json(await runtime.workspacePrepare(args, context)),
      }),
      delegate_task: tool({
        description: runtime.delegateTaskDescription(),
        args: {
          workspace_id: tool.schema.string().min(1).optional(),
          change_id: tool.schema.string().min(1).optional(),
          category: tool.schema.string().min(1).optional(),
          agent: tool.schema.string().min(1).optional(),
          description: tool.schema.string().min(1),
          prompt: tool.schema.string().min(1),
          load_skills: tool.schema.array(tool.schema.string().min(1)).optional(),
          run_in_background: tool.schema.boolean().optional(),
        },
        execute: async (args, context) => json(await runtime.delegate(args, context)),
      }),
      consult_agents: tool({
        description: "Synchronously ask up to four Explorer or Librarian consultants for bounded information in parallel. This is consultation only; Implementer remains responsible for implementation, decisions, edits, and validation.",
        args: {
          requests: tool.schema.array(tool.schema.object({
            agent: tool.schema.enum(["Explorer", "Librarian"]),
            prompt: tool.schema.string().min(1),
            description: tool.schema.string().min(1).optional(),
            session_id: tool.schema.string().min(1).optional(),
          }).strict()).min(1).max(4),
        },
        execute: async (args, context) => json(await runtime.consultAgents(args, context)),
      }),
      task_status: tool({
        description: "Read deterministic delegation task status without invoking a model.",
        args: {
          task_id: tool.schema.string().min(1).optional(),
          workspace_id: tool.schema.string().min(1).optional(),
        },
        execute: async (args, context) => json(await runtime.taskStatus(args.task_id, context, args.workspace_id)),
      }),
      task_output: tool({
        description: "Retrieve bounded stored output and evidence for a delegation task.",
        args: {
          task_id: tool.schema.string().min(1),
          max_chars: tool.schema.number().int().min(1000).max(50000).optional(),
        },
        execute: async (args) => json(runtime.taskOutput(args.task_id, args.max_chars)),
      }),
      task_cancel: tool({
        description: "Abort a child session and mark its task cancelled while preserving its workspace.",
        args: { task_id: tool.schema.string().min(1) },
        execute: async (args) => json(await runtime.taskCancel(args.task_id)),
      }),
      workspace_release: tool({
        description: "Safely release a managed, terminal, clean, integrated workspace, or finalize an in-place primary only after successful local integration; never use force operations.",
        args: {
          workspace_id: tool.schema.string().min(1),
          finalize_in_place: tool.schema.boolean().optional(),
          integration_branch: tool.schema.string().min(1).optional(),
        },
        execute: async (args, context) => json(await runtime.workspaceRelease(args.workspace_id, context, args)),
      }),
    },
    event: async ({ event }) => runtime.handleEvent(event),
    "chat.params": async (input, output) => runtime.applyChatParams(input.sessionID, output),
    "tool.execute.before": async (input, output) => runtime.applyToolExecutionBefore(input, output),
    "permission.ask": async (input, output) => runtime.applyPermission(input, output),
  }
}
