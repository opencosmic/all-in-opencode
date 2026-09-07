# Workflow invariants

| Invariant | Enforcement |
|---|---|
| `tasks.md` is the only durable workflow-progress state. | Planner, Executor, and policy tests. |
| Git owns isolation; OpenCode owns session execution; Delegation Runtime owns task/session lifecycle; Executor owns integration. | [Architecture](../architecture.md) and delegation tests. |
| Isolated delegation depends only on stock OpenCode public APIs and does not import OMO internals. | Static dependency guard. |
| A managed workspace is identified by runtime-issued ID plus canonical path, branch, base SHA, repository identity, and Git common directory. | WorkspaceManager provenance tests. |
| Unknown, dirty, active, mismatched, unintegrated, or refused workspaces are preserved. No force cleanup is allowed. | WorkspaceManager release tests. |
| Category selection is caller-owned and deterministic; every implementation category routes to Implementer. | CategoryEngine tests. |
| Exactly one of category or allowlisted named agent is required. | AgentDispatcher tests. |
| Implementer handles one scoped change and cannot delegate, manage workspaces, integrate, or edit workflow state. | Implementer permissions and contract. |
| Reviewer and QA use the same workspace-bound SessionRunner and do not repair code. | Runtime routing tests and role permissions. |
| Idle alone is not completion; the current assistant must be terminal and own no pending/running tool call. | CompletionTracker regression tests. |
| Model fallback stops after a child turn is accepted. | SessionRunner tests. |
| Background tasks from one parent turn form one group and cause at most one resume after every member is terminal. | Registry/coordinator tests. |
| Cancellation aborts the child and preserves the workspace. | Cancellation tests. |
| Runtime code never stages, commits, merges, rebases, or changes OpenSpec tasks. | Static/source policy tests and Executor ownership. |
| Plan Reviewer, Reviewer, QA, and Verifier are independent evidence roles and do not repair their own findings. | Agent definitions. |
| Prior approval becomes stale after relevant code, artifact, base, branch/worktree, comparison, or diff changes. | Execute, verify, and ship policies. |
| CodeGraph remains OMO-owned derived evidence; `/ego` remains an independent external browser route. | Role permissions and integration tests. |
