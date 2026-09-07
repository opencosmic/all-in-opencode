import { tool } from "@opencode-ai/plugin"

import { inspectWorkspace, workspaceDirectoryFromToolContext } from "./workspace-inspector/core.js"

// Keep the public plugin entry default-only; testable helpers live in the
// adjacent core module and are not exposed as plugin factories.
export default async function WorkspaceInspector() {
  return {
    tool: {
      workspace_inspect: tool({
        description:
          "Read-only Git workspace preflight for the current session: repository root, HEAD, status, linked-worktree versus submodule detection, registered Git worktrees, and optional strategy-source availability from an intended base. It does not create, copy, move, reset, stash, commit, or remove anything and does not claim security isolation.",
        args: {
          strategyPath: tool.schema.string().optional().describe("Selected strategy file to check before a change-worktree handoff"),
          baseRef: tool.schema.string().optional().describe("Intended worktree base ref; defaults to HEAD"),
        },
        async execute(args, context) {
          return JSON.stringify(await inspectWorkspace(workspaceDirectoryFromToolContext(context), args), null, 2)
        },
      }),
    },
  }
}
