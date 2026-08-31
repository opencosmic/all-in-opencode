---
description: Run independent final verification for an implemented OpenSpec change
agent: Verifier
subtask: true
---

Independently verify one OpenSpec change:

`$ARGUMENTS`

Resolve an explicit change or one unambiguous active implemented change. Run read-only `workspace_inspect` and bind all evidence to the exact current workspace, branch/detached state, HEAD/base, canonical artifacts, and actual diff. Read proposal, delta specs, design, tasks, known review/QA findings when available, and fresh test evidence. Map every requirement to implementation and test/runtime evidence. Missing historical review messages are not a blocker by themselves; independently prove the current tree. Any later code, artifact, base, branch, or worktree change makes prior evidence stale.

OpenSpec validation and native verify are supplemental structural/heuristic inputs, never sole proof. Do not edit, repair, delegate, archive, ship, change task state, or create/move/reset/remove/merge/clean worktrees. Return exactly `VERIFIED`, `VERIFIED_WITH_CONCERNS`, or `BLOCKED` under the Verifier contract. `VERIFIED` may proceed directly to shipping authorization; `VERIFIED_WITH_CONCERNS` requires `/ship` to obtain explicit acceptance of the exact current named concerns before authorization; `BLOCKED` cannot proceed.
