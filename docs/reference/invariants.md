# Workflow invariants

These are current hard boundaries extracted from the canonical source and deterministic tests. The source/tests remain executable truth; links below identify the owning implementation.

| Invariant | Current enforcement / source |
|---|---|
| `tasks.md` is the only durable custom execution-progress state. | [Planner](../../opencode/agents/planner.md), [Executor](../../opencode/agents/executor.md), `openspec-hardening-policy.test.js` |
| The custom workflow does not create or consume native OMO planning/notepad/work/Boulder state. | [Executor](../../opencode/agents/executor.md), [`/execute`](../../opencode/commands/execute.md), policy tests |
| Strategist owns product intent; Planner owns engineering how in only `design.md` and `tasks.md`. | [Strategist](../../opencode/agents/strategist.md), [Planner](../../opencode/agents/planner.md) |
| Planner is planning-only: it never writes code, checks execution progress, creates worktrees, or invokes implementation workers. | [Planner](../../opencode/agents/planner.md), [delegation guard](../../opencode/plugins/planner-delegation-guard.js), guard tests |
| Planner consultations are bounded to fresh explicit targets; continuation `task_id` calls and category workers are denied. | [delegation guard](../../opencode/plugins/planner-delegation-guard.js), [tests](../../opencode/tests/planner-delegation-guard.test.js) |
| Executor alone transitions custom task progress, and only after fresh implementation, review, and applicable QA evidence. | [Executor](../../opencode/agents/executor.md), policy tests |
| Plan Reviewer, Reviewer, QA, and Verifier are independent evidence roles; none repairs its own finding. | Role definitions under [`agents/`](../../opencode/agents/), policy tests |
| Prior approval is advisory, not durable authority; `/execute`, `/verify`, and `/ship` re-evaluate current state. | [`/execute`](../../opencode/commands/execute.md), [`/verify`](../../opencode/commands/verify.md), [`/ship`](../../opencode/commands/ship.md) |
| Any relevant code, artifact, base, branch, or worktree change makes prior verification stale. Archive/sync also requires a fresh verifier before merge/push. | [Verifier](../../opencode/agents/verifier.md), [`/ship`](../../opencode/commands/ship.md), policy tests |
| Canonical OpenSpec artifacts must have one active workspace; they are never silently copied, migrated, stashed, or duplicated for isolation. | [`/spec`](../../opencode/commands/spec.md), [Executor](../../opencode/agents/executor.md), workspace tests |
| A prompt `WORKSPACE:` path is not proof of child cwd binding. Lane worktrees and worker sandboxes require actual runtime binding. | [Executor](../../opencode/agents/executor.md), [`/execute`](../../opencode/commands/execute.md), policy tests |
| Workspace cleanup is provenance-aware and conservative; unknown/dirty/external worktrees are not force-deleted. | [Executor](../../opencode/agents/executor.md), [`/ship`](../../opencode/commands/ship.md) |
| CodeGraph is OMO-owned derived structural evidence. The custom workflow neither provisions indexes nor adds a second graph lifecycle. | [Architecture](../architecture.md), [CodeGraph research](../research/codegraph-integration.md) |
| The only custom CodeGraph surface is `codegraph_codegraph_explore`, available to Planner, Plan Reviewer, Executor, Reviewer, and Verifier. | Agent permissions; [`codegraph-integration.test.js`](../../opencode/tests/codegraph-integration.test.js) |
| CodeGraph is explore-only and non-blocking; exact source/LSP/diff/tests/runtime remain the appropriate evidence for their respective claims. | Enabled role CodeGraph sections; [research](../research/codegraph-integration.md) |
| Planning concurrency is based on observable dependencies, write overlap, shared contracts/state, and independently verifiable boundaries—not duration guesses. | [Planner](../../opencode/agents/planner.md), policy tests |
| Git source is canonical for public-safe authored configuration; live paths are narrow symlinks, not a duplicate authored copy. | [`links.tsv`](../../scripts/links.tsv), [`install.sh`](../../scripts/install.sh), [`verify.sh`](../../scripts/verify.sh) |

When changing any row, change the source and tests first, then update this navigation reference and the relevant architecture/research/decision documentation.
