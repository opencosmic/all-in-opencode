---
description: Execute an approved OpenSpec task list through OMO category workers
agent: Executor
subtask: false
---

Execute this approved OpenSpec change:

`$ARGUMENTS`

Use `tasks.md` as the only durable task-progress state. Every invocation must independently reread and validate the current proposal, specs, design, and tasks, then dispatch a new `Plan Reviewer` review of those current artifacts. A prior `[APPROVED]` from `/plan`, conversation history, or another session is advisory only and never satisfies this execution-time gate. Only the fresh `[APPROVED]` may permit implementation; a fresh `[REJECTED]` stops and returns the change to Planner without repair inside Executor.

After that gate, run `workspace_inspect` and the Executor Workspace Preflight / Resolver. Reuse suitable existing isolation before creation; distinguish a linked worktree from a submodule; prefer a host-native OpenCode workspace when actually exposed; otherwise use manual Git only as an approved fallback. Bind one canonical OpenSpec change directory to the chosen workspace, capture base SHA/status, run project-appropriate setup/bootstrap, and establish a reasonable baseline before implementation.

Do not use installed OpenCode 1.18.23 session `moveChanges` after OpenSpec artifacts exist: observed untracked-artifact behavior can move the session while leaving duplicate source/destination copies even when the API returns an error. Never silently commit, copy, delete, stash, or migrate proposal/spec/design/tasks. If `/spec` did not place existing artifacts in required isolation, continue safely `IN_PLACE` or stop for explicit user-directed placement; never create a fresh worktree that lacks the canonical artifacts.

Delegate implementation through normal OMO category workers and apply the Executor review/QA/verification gates. Every worker gets `WORKSPACE: <absolute path>` plus containment, no-lifecycle, no-base-merge/push, and workflow-state-read-only rules, but a prompt path alone is not actual cwd binding.

`LANE_WORKTREES` is implemented but remains behind both gates defined by Executor: exact adopted mechanical evidence for the active OpenCode/OMO runtime, and at least two dependency-ready tasks whose writes and shared contracts/schemas/migrations/generated files/state/resources are independently safe. The installed production OMO 4.19.4 has no adopted capability evidence, so this invocation must use `CHANGE_WORKTREE`/serialization unless the exact runtime contract is established first. Never infer support from a version number or historical lab result.

When both gates pass, Executor alone creates a current-wave set of genuine linked worktrees from one captured canonical HEAD, records transient path/branch/task/common-directory ownership, and dispatches normal OMO tasks with `directory=<absolute lane worktree>`. It inspects each lane's actual diff and provenance, obtains lane-local review/QA, integrates accepted committed branches in `tasks.md` order with non-fast-forward Git merges, runs combined canonical checks, and only then marks tasks complete. Conflict, unknown mutation, failed combined checks, cancellation, or interruption preserves evidence and blocks dependent work. Cleanup uses only normal worktree removal and safe branch deletion after exact ownership/integration/cleanliness proof; no force operations and no broad `.omo/**` exclusion.

`EPHEMERAL_SANDBOX` remains disabled and unimplemented. Executor alone owns lane landing, task checkbox transitions, integration sequencing, and conservative cleanup. Never create or use `.omo/plans`, `.omo/notepads`, `.omo/work`, `.superpowers/sdd`, OMO Team task state, a worktree ledger, or `/opsx-apply`.

Continue until all tasks and the final whole-change review pass or a genuine blocker is reached. Then hand off to `/verify <change>`; do not self-verify or ship automatically.
