import { tool } from "@opencode-ai/plugin"

function json(value) {
  return JSON.stringify(value, null, 2)
}

export function delegationPluginHooks(runtime) {
  return {
    tool: {
      workspace_prepare: tool({
        description: "Create and register a provenance-bound linked Git worktree for one isolated task.",
        args: {
          task_id: tool.schema.string().min(1),
          change_id: tool.schema.string().min(1).optional(),
          base_sha: tool.schema.string().min(1).optional(),
        },
        execute: async (args, context) => json(await runtime.workspacePrepare(args, context)),
      }),
      delegate_task: tool({
        description: runtime.delegateTaskDescription(),
        args: {
          workspace_id: tool.schema.string().min(1).optional(),
          category: tool.schema.string().min(1).optional(),
          agent: tool.schema.string().min(1).optional(),
          description: tool.schema.string().min(1),
          prompt: tool.schema.string().min(1),
          load_skills: tool.schema.array(tool.schema.string().min(1)).optional(),
          run_in_background: tool.schema.boolean().optional(),
        },
        execute: async (args, context) => json(await runtime.delegate(args, context)),
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
        description: "Safely release a managed, terminal, clean, integrated workspace without force operations.",
        args: { workspace_id: tool.schema.string().min(1) },
        execute: async (args) => json(await runtime.workspaceRelease(args.workspace_id)),
      }),
    },
    event: async ({ event }) => runtime.handleEvent(event),
    "chat.params": async (input, output) => runtime.applyChatParams(input.sessionID, output),
    "permission.ask": async (input, output) => runtime.applyPermission(input, output),
  }
}
