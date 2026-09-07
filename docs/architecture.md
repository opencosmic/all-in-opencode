# Architecture

## Runtime boundary

```text
Workflow Orchestrator
        |
        v
Shared Delegation Control Plane (server + Git common dir + data root)
  +-- Task Registry (one live owner / serialized persistence)
  +-- Completion Tracker <---- canonical plugin instance events
  |                        <---- worktree T1 plugin instance events
  |                        <---- worktree T2 plugin instance events
  +-- Session Runner ----------> stock OpenCode public SDK
  +-- Parent Resume Coordinator
  +-- Category Engine ----------> Implementer
  +-- Agent Dispatcher --------> Reviewer / QA
  +-- Workspace Manager -------> Git linked worktrees T1 / T2
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

### Directory-scoped plugin ownership

OpenCode 1.18.29 source tag `v1.18.29` (commit `16747470f976aca3d362ad730bcd3fe82ecc2c9a`) establishes the relevant boundary. `packages/opencode/src/effect/instance-state.ts` caches plugin hook state by instance directory. `packages/opencode/src/plugin/index.ts` initializes external plugins for that directory and discards bus events whose `event.location.directory` differs from it. `packages/opencode/src/session/session.ts` creates a session in the directory selected by the request's workspace routing, and `packages/opencode/src/session/llm/request.ts` invokes `chat.params` through that directory's plugin service.

Consequently, the canonical plugin instance cannot observe a child session running in a sibling linked worktree. Every directory instance now acquires a process-local control-plane promise from a `globalThis` symbol map. The key combines the OpenCode server URL, the canonical Git common directory shared by linked worktrees, and the resolved data root. A different server, repository, process, or data root cannot share live state. The first initializer owns the sole `TaskRegistry`, `CompletionTracker`, child-session mapping, execution-profile map, background delivery state, and `ParentResumeCoordinator`; later directory instances forward their local events and `chat.params` hooks to that same owner.

The registry store is additionally namespaced by repository identity, and every mutation is serialized by its single owner. JSON persistence remains recovery evidence, not an event bus. The SDK client held by the owner is safe across sibling adapters because every session create, prompt, message, status, abort, and parent-resume request supplies an explicit public `directory` query.

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

| Field | Classification | Application point |
|---|---|---|
| `description` | `SUPPORTED` | Child title and assignment prefix |
| ordered `models` | `SUPPORTED` | Public prompt `model`; pre-acceptance fallback only |
| `temperature` | `SUPPORTED` | Shared child `chat.params` profile |
| `top_p` | `SUPPORTED` | Shared child `chat.params` profile as `topP` |
| `max_tokens` | `SUPPORTED` | Shared child `chat.params` profile as `maxOutputTokens` |
| `tools` | `SUPPORTED` | Public prompt tool map, with recursive/orchestration tools forced off for Implementer |
| `prompt_append` | `SUPPORTED` | Appended to the public prompt text |
| `max_prompt_tokens` | `SUPPORTED` | Conservative local `ceil(characters / 4)` admission bound |
| `disable` | `SUPPORTED` | Local category admission gate |
| `reasoning` | `UNSUPPORTED_PUBLIC_API` | Recorded in `unsupported_profile_fields`; not applied |
| `variant` | `UNSUPPORTED_PUBLIC_API` | Recorded in `unsupported_profile_fields`; not applied |

No configured profile field is silently claimed as applied. More elaborate availability preflight or post-acceptance model retry remains `DEFERRED`; an ordered model fallback is attempted only when `promptAsync` returns a definite rejection before accepting the child turn. After uncertain transport acceptance or confirmed acceptance, any failure becomes task evidence and the workspace is preserved.

## Completion and background lifecycle

One child session handles one tracked assignment. Current-turn freshness requires a user message created after tracking began and an assistant whose `parentID` matches it. Successful completion additionally requires assistant completion time, a finish in the positive allowlist `stop`, `length`, or `content-filter`, no pending/running tool parts, and idle session status. Missing, `unknown`, `tool-calls`, `tool_calls`, unrecognized, busy, retrying, and unknown session states are non-terminal. An explicit assistant/session error becomes terminal `error` only after active tools have settled.

Background grouping is derived from `parent session ID + parent message ID`. The parent becoming idle seals the group, preventing an early child from resuming the parent before sibling delegation calls in the same turn are registered. A terminal group is claimed transactionally; duplicate events cannot send a second resume. A busy parent leaves delivery pending until its next idle event.

The resume prompt contains task IDs, statuses, workspace IDs, short summaries, and `task_output` retrieval hints—not raw transcripts. Task/group records capture the public tool context's parent agent, and the resume prompt explicitly selects that original agent. Older recovery records without an agent remain explicit `null` rather than guessing.

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

Manifests and repository-namespaced runtime task registries live under `$OPENCODE_WORKFLOW_DATA_ROOT/delegation`, or `~/.local/share/opencode-workflow/delegation` when the variable is unset. They are infrastructure provenance and recovery evidence, never a replacement for `tasks.md`.

Dirty, active, mismatched, unintegrated, unknown, or Git-refused workspaces are preserved with explicit diagnostics. The runtime never uses force removal, force branch deletion, reset, clean, automatic staging, commit, merge, or rebase. After restart, `task_status` surfaces persisted tasks and surviving managed workspace manifests for reconciliation; it does not guess completion.

## Existing workflow ownership

The custom lifecycle remains `/spec -> /plan -> /execute -> /verify -> /ship`. Every execution and shipping gate re-evaluates current artifacts and evidence. `tasks.md` is the only durable workflow-progress state.

The independent `/ego` browser route and OMO's native planning route remain separate. CodeGraph remains OMO-owned derived structural evidence.
