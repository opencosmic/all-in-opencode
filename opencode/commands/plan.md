---
description: Create and independently review OpenSpec engineering design and tasks
agent: Planner
subtask: false
---

Plan this OpenSpec change without implementing it:

`$ARGUMENTS`

Resolve one change, verify proposal/specs are complete and valid, inspect the repository/workspace with `workspace_inspect`, obtain current OpenSpec status/instructions, and create only that change's `design.md` and `tasks.md`. Build dependency edges and waves from write overlap, shared APIs/contracts/schemas/migrations/generated files/config/state, and independently verifiable boundaries. Classify lanes as `SAFE_TO_PARALLELIZE`, `MUST_SERIALIZE`, and only where structurally supported `LANE_ISOLATION_ELIGIBLE`; recommend `IN_PLACE` or `CHANGE_WORKTREE`, while leaving runtime scheduling to Executor.

Never estimate duration or guessed time savings to justify parallelism. Keep every implementation checkbox unchecked; Planner never transitions execution progress. Run the independent `Plan Reviewer` gate and repair only planning findings through Planner, with at most five rounds. Never create a worktree, `.omo` planning/execution state, or another progress ledger.

Finish only with `[APPROVED]` plus `/execute <change>`, or `[REJECTED]` with the blocking planning/product issue. Do not start execution automatically.
