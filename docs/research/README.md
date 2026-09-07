# Research status

Raw evidence remains local at `${OPENCODE_WORKFLOW_DATA_ROOT:-$HOME/Workspace/data/opencode-workflow}/benchmarks/<experiment-id>`. Superseded orchestration experiments are not part of the production architecture.

| Area | Status | Reference |
|---|---|---|
| CodeGraph integration | Validated with limits | [CodeGraph integration](codegraph-integration.md) |
| Initial CodeGraph A/B | Invalid due to sensitive-directory placement | [Invalid infrastructure attempt](codegraph-integration.md#invalid-infrastructure-attempt) |
| Planner optimization V1–V4 | Closed / rejected | [Planner benchmarks](planner-benchmarks.md) and [decision](../decisions/planner-optimization.md) |
| Planner → Plan Reviewer cross-repository pipeline | Validated / not promoted | [Planner benchmark](planner-benchmarks.md#cross-repository-reviewed-pipeline) |

Do not commit raw sessions, telemetry, indexes, or disposable benchmark worktrees. See [MAINTAINING.md](../../MAINTAINING.md#research-hygiene).
