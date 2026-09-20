import { tool } from "@opencode-ai/plugin"

import { createMockMediaRuntime } from "./media-runtime.js"
import { CHECKPOINT_STATUSES } from "./workspace-manager.js"

function json(value) {
  return JSON.stringify(value, null, 2)
}

function mediaRuntimeTools(runtime) {
  const z = tool.schema
  const generationRequestArgs = {
    shot_id: z.string().min(1),
    prompt: z.string().min(1),
    manifest_path: z.string().min(1).optional(),
    reference_image_asset_ids: z.array(z.string().min(1)).max(9).optional(),
    reference_video_asset_ids: z.array(z.string().min(1)).max(3).optional(),
    duration_seconds: z.number().int().min(4).max(15).optional(),
    size: z.enum([
      "2048*2048",
      "2304*1728",
      "1728*2304",
      "2720*1530",
      "1530*2720",
      "2496*1664",
      "1664*2496",
      "1024*1024",
      "1536*1536",
      "1776*1328",
      "1328*1776",
      "2048*1152",
      "1152*2048",
    ]).optional(),
    output_format: z.enum(["jpeg", "png"]).optional(),
    thinking: z.enum(["enabled", "disabled"]).optional(),
    prompt_optimization_mode: z.enum(["standard", "fast"]).optional(),
    resolution: z.enum(["480p", "720p", "720p-SR", "1080p-SR", "1440p-SR"]).optional(),
    ratio: z.enum(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"]).optional(),
  }
  const media = runtime.mediaRuntime ?? createMockMediaRuntime()
  const guarded = (name, args, execute) => tool({
    description: `Bounded Atlas Cloud media operation ${name}; available only to the media-generation Implementer category.`,
    args,
    execute: async (args, context) => {
      await runtime.assertMediaToolAccess(context?.sessionID, name)
      return json(await execute(args, context))
    },
  })

  return {
    media_calculate: guarded("media_calculate", {
      media_type: z.enum(["image", "video"]),
      ...generationRequestArgs,
    }, media.media_calculate),
    media_upload: guarded("media_upload", {
      asset_id: z.string().min(1),
      path: z.string().min(1).optional(),
      manifest_path: z.string().min(1).optional(),
      media_type: z.enum(["image", "video"]).optional(),
    }, media.media_upload),
    media_generate_image: guarded("media_generate_image", {
      ...generationRequestArgs,
      job_id: z.string().min(1),
      approved_request_digest: z.string().length(64),
      approved_max_usd: z.number().nonnegative(),
      approved_price_usd: z.number().nonnegative().optional(),
    }, media.media_generate_image),
    media_generate_video: guarded("media_generate_video", {
      ...generationRequestArgs,
      job_id: z.string().min(1),
      approved_request_digest: z.string().length(64),
      approved_max_usd: z.number().nonnegative(),
      approved_price_usd: z.number().nonnegative().optional(),
    }, media.media_generate_video),
    media_prediction: guarded("media_prediction", {
      job_id: z.string().min(1),
      manifest_path: z.string().min(1).optional(),
    }, media.media_prediction),
    media_wait_prediction: guarded("media_wait_prediction", {
      job_id: z.string().min(1),
      manifest_path: z.string().min(1).optional(),
      interval_ms: z.number().int().min(250).max(30_000).optional(),
      timeout_ms: z.number().int().min(1_000).max(900_000).optional(),
    }, media.media_wait_prediction),
  }
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
          description: tool.schema.string().min(1).max(240).optional(),
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
      workspace_checkpoint_update: tool({
        description: "Replace the latest bounded local execution checkpoint for a provenance-validated workspace; Executor must provide an existing TaskRegistry execution task_id, Implementer identity is derived from its active session, and runtime derives the workspace HEAD and timestamp.",
        args: {
          workspace_id: tool.schema.string().min(1).optional(),
          change_id: tool.schema.string().min(1).optional(),
          task_id: tool.schema.string().min(1).max(160).optional(),
          status: tool.schema.enum(CHECKPOINT_STATUSES),
          current_focus: tool.schema.string().min(1).max(240).optional(),
          completed: tool.schema.array(tool.schema.string().min(1).max(240)).max(20).optional(),
          next_steps: tool.schema.array(tool.schema.string().min(1).max(240)).max(20).optional(),
          blockers: tool.schema.array(tool.schema.string().min(1).max(240)).max(20).optional(),
          decisions: tool.schema.array(tool.schema.string().min(1).max(240)).max(20).optional(),
          verification: tool.schema.record(
            tool.schema.string().min(1).max(80),
            tool.schema.union([
              tool.schema.string().min(1).max(240),
              tool.schema.boolean(),
              tool.schema.number(),
            ]),
          ).optional(),
          important_files: tool.schema.array(tool.schema.string().min(1).max(240)).max(40).optional(),
        },
        execute: async (args, context) => json(await runtime.workspaceCheckpointUpdate(args, context)),
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
        execute: async (args, context) => json(runtime.taskOutput(args.task_id, args.max_chars, context)),
      }),
      task_cancel: tool({
        description: "Abort a child session and mark its task cancelled while preserving its workspace.",
        args: { task_id: tool.schema.string().min(1) },
        execute: async (args, context) => json(await runtime.taskCancel(args.task_id, context)),
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
      ...mediaRuntimeTools(runtime),
    },
    event: async ({ event }) => runtime.handleEvent(event),
    "chat.message": async (input) => runtime.observeSessionAgent(input),
    "chat.params": async (input, output) => runtime.applyChatParams(input.sessionID, output, input.agent),
    "experimental.chat.system.transform": async (input, output) => runtime.applyChatSystem(input.sessionID, output),
    "tool.execute.before": async (input, output) => runtime.applyToolExecutionBefore(input, output),
    "permission.ask": async (input, output) => runtime.applyPermission(input, output),
  }
}
