---
description: Execute an approved OpenSpec task list through the All-in OpenCode Delegation Runtime
agent: Executor
subtask: false
---

Execute this approved OpenSpec logical change:

`$ARGUMENTS`

Use `tasks.md` as the only durable task-progress source of truth for the formal workflow. Re-read the current proposal, specs, design, and tasks, then obtain a new `Plan Reviewer` approval through `delegate_task(agent="Plan Reviewer")` for this invocation. Workspace descriptions and latest checkpoints are bounded local recovery context, not OpenSpec state, TaskRegistry state, Git history, or a completion contract.

Before creating a branch/worktree or delegating implementation, run `execution_preflight(change_id=...)`. Reconcile Planner intent with the current branch/HEAD/dirty state, existing worktrees, managed workspace manifests, persisted task state, unfinished related work, dependencies, source overlap, active contention, acceptance criteria, and the verification strategy. Planner task boundaries do not imply branch, worktree, or agent boundaries.

After `execution_preflight` and before creating a branch/worktree or delegating implementation, CALL the `workspace_inspect` tool directly from the tool catalog and use its structured workspace result. `workspace_inspect` is a callable OpenCode/AIO tool, not an executable or shell command. Do not use Bash, `command -v workspace_inspect`, `git status`, `git worktree`, or `git rev-parse`; shell Git inspection is not a substitute. If the `workspace_inspect` tool is unavailable or its call fails, STOP before mutating workflow state or a workspace and report a tool/runtime blocker.

Resolve and inspect the actual primary change workspace, capture its baseline, and run a practical baseline check. `workspace_prepare(description=...)` records a concise reason for the primary or child workspace and reuses the current or existing primary workspace before creating one. Its returned/preflight context may include one `latest_checkpoint`; compare its recorded HEAD with current Git and inspect dirty state before resuming or re-planning. Use its `role="child"` only when preflight identifies a concrete isolation/concurrency reason and the child has a primary parent workspace. Never use a protected `main`/`master` checkout for implementation. Delegate application changes with `delegate_task(workspace_id=<resolved workspace>, change_id=..., category=...)`; categories always route to the reusable Implementer. Use `delegate_task(agent="Reviewer"|"QA")` in the same primary or child workspace for quality gates.

Prefer serialization and reuse. Ready tasks may run concurrently only after preflight establishes independent dependencies, non-overlapping write scopes, available required state, and a concrete isolation benefit. Let the runtime group them and resume once when the group is terminal. Use `workspace_checkpoint_update` at meaningful execution boundaries only—start, milestone, blocker, material re-plan, important verification, integration, and completion—not after every tool call. Executor supplies the current execution task's `TaskRegistry` `task_id`, which must resolve to an existing TaskRegistry task; the workspace creation `task_id` is not a fallback. A checkpoint's `next_steps` are provisional; current Git, OpenSpec, TaskRegistry, and ownership facts remain authoritative. Retrieve detailed evidence with `task_output`, inspect each real diff, and preserve failed, cancelled, interrupted, dirty, or ambiguous workspaces.

Executor alone decides integration order and scope. Integrate reviewed child work into the primary change branch/workspace, never directly into protected `main`/`master`. Use `delegate_task(workspace_id=<primary workspace>, category="git")` for explicitly authorized task-scoped commits and source-derived integration; never launch a normal Implementer merely to re-apply a reviewed workspace diff in canonical. Run whole-change checks in the primary workspace and update task checkboxes only after integrated success. Release only provenance-validated, terminal, clean, safely integrated child workspaces through `workspace_release`; after a successful local `/ship`, finalize an in-place primary manifest only with the confirmed protected integration branch; keep the primary workspace for `/verify` and `/ship`; never force cleanup.

Continue until all tasks and the final whole-change review pass or a genuine blocker is reached. Then hand off to `/verify <change>`; do not self-verify or ship automatically.
