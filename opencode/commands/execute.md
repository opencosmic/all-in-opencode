---
description: Execute an approved OpenSpec task list through the aio-owned Delegation Runtime
agent: Executor
subtask: false
---

Execute this approved OpenSpec change:

`$ARGUMENTS`

Use `tasks.md` as the only durable task-progress source of truth. Re-read the current proposal, specs, design, and tasks, then obtain a new `Plan Reviewer` approval through `delegate_task(agent="Plan Reviewer")` for this invocation.

Resolve and inspect the actual workspace, capture its baseline, and run a practical baseline check. Use `workspace_prepare` only when committed baseline content is sufficient for the isolated assignment. Delegate application changes with `delegate_task(category=...)`; categories always route to the reusable Implementer. Use `delegate_task(agent="Reviewer"|"QA")` in the same workspace for quality gates.

Ready independent background tasks launched in this turn may run concurrently. Let the runtime group them and resume once when the group is terminal. Retrieve detailed evidence with `task_output`, inspect each real diff, and preserve failed, cancelled, interrupted, dirty, or ambiguous workspaces.

Executor alone decides integration order and scope. Use `delegate_task(category="git")` for explicitly authorized task-scoped commits and source-derived integration; never launch a normal Implementer merely to re-apply a reviewed workspace diff in canonical. Run combined checks and update task checkboxes only after integrated success. Release only provenance-validated, terminal, clean, safely integrated workspaces through `workspace_release`; never force cleanup.

Continue until all tasks and the final whole-change review pass or a genuine blocker is reached. Then hand off to `/verify <change>`; do not self-verify or ship automatically.
