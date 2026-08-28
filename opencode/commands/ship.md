---
description: Safely integrate, sync, and archive a VERIFIED OpenSpec change
agent: Executor
subtask: false
---

Finish this OpenSpec change safely:

`$ARGUMENTS`

Every invocation is an independent shipping gate. Resolve exactly one current change, inspect the current git/worktree state and comparison basis, and ALWAYS dispatch a new `Verifier` against the current OpenSpec artifacts, repository tree, diff, and fresh evidence before presenting any archive or integration choice. A previous `/verify` result or `VERIFIED` message is advisory only and never satisfies this gate; any code, artifact, base, or worktree change after an earlier verdict makes that verdict stale by definition.

Handle the fresh result exactly:

- `VERIFIED`: rerun the relevant final checks against the same current tree, inspect their output, then present the integration menu.
- `VERIFIED_WITH_CONCERNS`: stop and ask for explicit acceptance of the named risks before any archive or integration action.
- `BLOCKED`: stop. Do not archive, integrate, or offer a bypass.

Only after the fresh `VERIFIED` gate and final checks, confirm the exact worktree/branch and base branch, then present exactly these integration choices and stop for the user's selection:

1. merge locally
2. push + PR
3. keep branch

Do not infer merge, push, PR, deploy, cleanup, sync, or archive intent. Never force-push or delete work automatically.

For merge or PR delivery, recommend syncing/archiving the verified change on the feature branch before integration so updated main specs and the archived audit trail are included in the merge/PR. Perform `openspec archive <change> --yes` only after explicit approval, then validate archived state and rerun the relevant checks on the resulting tree.

Any archive or sync mutation of an OpenSpec artifact invalidates the pre-archive Verifier verdict. After such a mutation, ALWAYS dispatch a NEW fresh `Verifier` against the post-archive current artifacts/tree/diff before any merge or push. Handle that post-archive verdict exactly: `VERIFIED` permits the selected integration to continue; `VERIFIED_WITH_CONCERNS` stops and requires explicit acceptance under the existing concern policy; `BLOCKED` stops with no integration or bypass. For keep-as-is, ask whether to archive now or defer it; any later merge/push still requires this post-mutation Verifier gate.

Execute only the selected and approved actions.

- `merge locally`: verify the worktree again, merge into the user-confirmed base, then verify the merged result. If merged verification fails, preserve the feature branch/worktree and stop. Consider cleanup only after successful merged verification.
- `push + PR`: push/create the PR only after this explicit choice and KEEP the worktree for CI/review fixes.
- `keep branch`: preserve both branch and worktree.

Before any cleanup inspect ownership/provenance, status, untracked/uncommitted data, branch state, and integration state. Unknown/external worktrees are never auto-deleted. If normal removal refuses because data exists, do not force it; report the at-risk paths and require an explicit user decision. Never use `git worktree remove --force`, `git branch -D`, `git reset --hard`, or `git clean -ffdx` on user work. Do not treat OpenCode's raw remove/reset endpoints as cleanup policy.

If any post-archive/integration check fails, stop without destructive cleanup and report the recoverable state.
