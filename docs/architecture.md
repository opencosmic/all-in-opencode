# Architecture

## Runtime boundary

```text
Workflow Orchestrator
        |
        v
Delegation Runtime
  +-- Category Engine ---> Implementer
  +-- Task Registry
  +-- Session Runner ----> stock OpenCode public SDK
  +-- Completion Tracker
  +-- Parent Resume Coordinator
  +-- Agent Dispatcher --> Reviewer / QA
  +-- Workspace Manager -> Git linked worktrees
```

Git owns filesystem isolation. OpenCode owns model, tool, and session execution. The workflow-owned Delegation Runtime owns task/session lifecycle and workspace provenance. The Category Engine owns deterministic execution-profile resolution. Implementer owns one scoped code change. Executor owns orchestration, review sequencing, integration, and OpenSpec task transitions. Reviewer and QA are read-only quality gates.

The isolated execution path does not call OMO task/delegation internals. Stock Oh My OpenAgent 4.19.4 remains installed for unrelated existing workflow behavior and may be removed later without rewriting workspace execution. OpenCode and OMO source are never patched.

## Delegation components

- `WorkspaceManager` creates a linked worktree from a resolved base commit, records path/branch/repository/common-directory provenance outside the repository, validates that provenance on every later mutation, and refuses unsafe cleanup.
- `CategoryEngine` resolves a caller-selected category to an ordered model chain and one reusable `Implementer`.
- `AgentDispatcher` enforces category XOR named-agent routing. The named-agent allowlist is `Reviewer` and `QA`.
- `SessionRunner` creates a stock OpenCode child session with `parentID` and the validated workspace `directory`, then starts one asynchronous prompt.
- `CompletionTracker` binds the current user/assistant turn and refuses terminal completion while the assistant is incomplete, in a tool-call finish state, owns a pending/running tool part, or the session is busy/retrying.
- `TaskRegistry` validates state transitions, stores bounded result evidence, persists lightweight runtime state, and deduplicates group delivery.
- `ParentResumeCoordinator` closes a background launch group when its parent turn becomes idle, waits for every sibling to become terminal, and sends exactly one compact ordinary prompt to resume the parent.

V1 deliberately excludes recursive implementation delegation, arbitrary agent routing, a DAG scheduler, separate OpenCode processes, automatic mutation retry, automatic commit/merge, streaming injection, and force cleanup.

## Public tool surface

The plugin exposes exactly:

- `workspace_prepare({ task_id, change_id?, base_sha? })`
- `delegate_task({ workspace_id?, category?, agent?, description, prompt, run_in_background? })`
- `task_status({ task_id?, workspace_id? })`
- `task_output({ task_id, max_chars? })`
- `task_cancel({ task_id })`
- `workspace_release({ workspace_id })`

`delegate_task` requires exactly one of `category` and `agent`. Omitting `workspace_id` intentionally binds the child to the current session directory; an isolated task uses only a runtime-issued `workspace_id`, never an arbitrary mutation path.

## Category profiles

The current configuration is [`categories.js`](../opencode/plugins/delegation/categories.js). Profiles support `description`, ordered `models[]`, `reasoning`, `variant`, `temperature`, `top_p`, `max_tokens`, `tools`, `prompt_append`, `max_prompt_tokens`, and `disable`.

OpenCode 1.18.29's public prompt API applies model, agent, system text, and tool availability. Its public `chat.params` hook applies temperature, top-p, and maximum output tokens. `max_prompt_tokens` uses a conservative local `ceil(characters / 4)` admission bound. The public prompt API does not expose per-prompt reasoning or variant selection, so those fields are retained in the clean profile abstraction and reported as `unsupported_profile_fields`; they are not patched, faked, or silently treated as applied.

An ordered model fallback is attempted only when `promptAsync` rejects before accepting the child turn. After acceptance, any failure becomes task evidence and the workspace is preserved.

## Completion and background lifecycle

One child session handles one tracked assignment. Current-turn freshness requires a user message created after tracking began and an assistant whose `parentID` matches it. Successful completion additionally requires assistant completion time, a non-tool-call finish, no pending/running tool parts, and idle session status.

Background grouping is derived from `parent session ID + parent message ID`. The parent becoming idle seals the group, preventing an early child from resuming the parent before sibling delegation calls in the same turn are registered. A terminal group is claimed transactionally; duplicate events cannot send a second resume. A busy parent leaves delivery pending until its next idle event.

The resume prompt contains task IDs, statuses, workspace IDs, short summaries, and `task_output` retrieval hints—not raw transcripts.

## Worktree lifecycle and recovery

```text
resolve base SHA
  -> write preparing manifest
  -> git worktree add -b
  -> validate directory + branch + common dir + registration
  -> run child sessions
  -> Executor reviews/integrates
  -> prove tasks terminal + clean tree + branch ancestor of repository HEAD
  -> normal worktree remove
  -> safe branch -d
```

Manifests and the runtime task registry live under `$OPENCODE_WORKFLOW_DATA_ROOT/delegation`, or `~/.local/share/opencode-workflow/delegation` when the variable is unset. They are infrastructure provenance and recovery evidence, never a replacement for `tasks.md`.

Dirty, active, mismatched, unintegrated, unknown, or Git-refused workspaces are preserved with explicit diagnostics. The runtime never uses force removal, force branch deletion, reset, clean, automatic staging, commit, merge, or rebase. After restart, `task_status` surfaces persisted tasks and surviving managed workspace manifests for reconciliation; it does not guess completion.

## Existing workflow ownership

The custom lifecycle remains `/spec -> /plan -> /execute -> /verify -> /ship`. Every execution and shipping gate re-evaluates current artifacts and evidence. `tasks.md` is the only durable workflow-progress state.

The independent `/ego` browser route and OMO's native planning route remain separate. CodeGraph remains OMO-owned derived structural evidence.
