# Research status

Research summaries preserve what was learned without treating raw benchmark material as runtime state. Raw forensic evidence remains local at `${OPENCODE_WORKFLOW_DATA_ROOT:-$HOME/Workspace/data/opencode-workflow}/benchmarks/<experiment-id>`.

| Area | Status | Current conclusion | Primary reference | Raw evidence convention |
|---|---|---|---|---|
| CodeGraph integration | VALIDATED, with limits | The explore-only, OMO-owned structural-evidence rollout is effective overall for Planner, Executor, and Reviewer; Planner has a documented retrieval/coverage trade-off. | [CodeGraph integration](codegraph-integration.md) | `benchmarks/codegraph-ab/20260827T165722Z` |
| Initial CodeGraph A/B | INVALID | Sensitive-directory worktree placement prevented graph evidence; metrics are not effectiveness results. | [CodeGraph integration](codegraph-integration.md#invalid-infrastructure-attempt) | `benchmarks/codegraph-ab/20260827T155125Z` |
| Planner prompt optimization V1–V4 | CLOSED / REJECTED | No candidate safely improved the production Planner. Do not promote or retune these variants. | [Planner benchmark history](planner-benchmarks.md) and [decision](../decisions/planner-optimization.md) | `benchmarks/codegraph-planner-*` |
| Planner → Plan Reviewer cross-repository pipeline | VALIDATED / NOT PROMOTED | V4 does not generalize safely across `ego-lite` and `codegraph`; reviewed-system safety and macro cost gates fail. | [Planner benchmark history](planner-benchmarks.md#cross-repository-reviewed-pipeline) | `benchmarks/planner-reviewer-crossrepo/20260827T195837Z` |
| CodeGraph branch/worktree correctness | VALIDATED for benchmark preflight | Exact-root, complete, independent per-worktree indexes can support valid experiments; placement under sensitive `.config` paths cannot. | [CodeGraph integration](codegraph-integration.md#worktrees-and-indexes) | CodeGraph experiment protocols/reports |
| Worker direct CodeGraph access | UNPROVEN | Worker access was not established and is not required by the current decision. | [CodeGraph integration](codegraph-integration.md#limits-and-open-questions) | No valid direct-worker experiment |
| Context economics / information value | FUTURE RESEARCH | If cost must be revisited, study which evidence changes plans/reviews rather than resuming prompt tightening. | [Planner decision](../decisions/planner-optimization.md) | New approved evidence required |

Do not add raw sessions, telemetry, indexes, or detached benchmark worktrees to Git. See [MAINTAINING.md](../../MAINTAINING.md#research-hygiene).
