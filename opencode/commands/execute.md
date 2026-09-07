---
description: Execute an approved OpenSpec task list through the workflow-owned Delegation Runtime
agent: Executor
subtask: false
---

Execute this approved OpenSpec change:

`$ARGUMENTS`

Use `tasks.md` as the only durable task-progress source of truth. Re-read the current proposal, specs, design, and tasks, then obtain a new `Plan Reviewer` approval for this invocation.

Resolve and inspect the actual workspace, capture its baseline, and run a practical baseline check. Use `workspace_prepare` only when committed baseline content is sufficient for the isolated assignment. Delegate application changes with `delegate_task(category=...)`; categories always route to the reusable Implementer. Use `delegate_task(agent="Reviewer"|"QA")` in the same workspace for quality gates.

Ready independent background tasks launched in this turn may run concurrently. Let the runtime group them and resume once when the group is terminal. Retrieve detailed evidence with `task_output`, inspect each real diff, and preserve failed, cancelled, interrupted, dirty, or ambiguous workspaces.

Executor alone decides controlled commit and integration, runs combined checks, and updates task checkboxes after integrated success. The runtime and workers must never auto-commit, merge, rebase, ship, or mutate workflow state. Release only provenance-validated, terminal, clean, safely integrated workspaces through `workspace_release`; never force cleanup.

Continue until all tasks and the final whole-change review pass or a genuine blocker is reached. Then hand off to `/verify <change>`; do not self-verify or ship automatically.
