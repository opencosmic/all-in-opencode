# Architecture

```text
User
 +-- ordinary work --> Assistant
 |                      +-- Explorer / Librarian / Technical Advisor
 |                      +-- CategoryEngine --> Implementer
 |                                            +-- git
 |                                            +-- browser-automation
 |                      +-- /browser --> Browser --> ego-browser backend
 |
 +-- formal work ----> /spec -> /plan -> /execute -> /verify -> /ship
                                      |
                                      +-- Delegation Runtime
                                          +-- WorkspaceManager
                                          +-- TaskRegistry
                                          +-- SessionRunner
                                          +-- CompletionTracker
                                          +-- ParentResumeCoordinator
```

OpenCode owns model, variant, tool, permission, and session execution. Git owns filesystem isolation. This repository owns the built-in and user-overridden category registry, selective skill resolution, agent prompts, task/session lifecycle, workspace provenance, grouped completion, and parent resume. OpenSpec `tasks.md` owns durable formal-workflow progress.

## Delegation boundary

`delegate_task` requires exactly one category or allowlisted named specialist. Categories route to the reusable Implementer. Named specialists are Explorer, Librarian, Technical Advisor, Plan Reviewer, Researcher, Validator, Reviewer, and QA. Unknown names fail closed.

The six runtime tools are `workspace_prepare`, `delegate_task`, `task_status`, `task_output`, `task_cancel`, and `workspace_release`. The runtime uses only public OpenCode plugin and SDK surfaces.

Categories are small execution profiles: one `model`, an optional string `variant`, an execution-mindset `prompt_append`, and optional tool narrowing. `opencode/categories.json` is loaded once at startup and field-merges user entries over built-ins. It supports built-in overrides, custom categories, and `disable: true`; an enabled category without a model fails clearly. There is no model fallback chain.

`load_skills` is an explicit list of installed/local skill names. The runtime advertises only name/description metadata and injects full content for selected skills into the child Implementer system context. Unknown names fail closed.

Workspace release accepts either ancestry or Git-proven patch equivalence. A cherry-picked workspace is removed normally while its non-ancestor branch is retained when safe `git branch -d` refuses; release never force-deletes it.

## Background lifecycle

Independent tasks launched by one parent turn share a completion group. The parent performs unrelated work or becomes idle. Child events are observed and terminal state is persisted. Once every member is terminal, ParentResumeCoordinator resumes an eligible idle parent once. A missing status requires a current-process idle witness; busy, running, or retry status suppresses resume and invalidates stale witnesses. The parent retrieves detailed stored output after resume. There is no model-driven polling loop.

## Workspace and integration lifecycle

Executor obtains a fresh Plan Reviewer verdict, prepares one provenance-bound workspace per eligible task, launches implementation, inspects each real diff, and delegates Reviewer/QA into that same workspace. After approval, Executor selects a deterministic integration order and delegates explicit Git mechanics through the `git` category. Task-scoped commits become source-derived integration inputs. A normal implementation category never re-applies reviewed changes in canonical.

The Git category is session-scoped through OpenCode's public permission hook. Ordinary Implementers retain their restrictive Git policy. Only the exact Git category may receive bounded status/log/diff/show/rev-parse, staging, commit, and selected-SHA cherry-pick operations. Destructive operations, force operations, arbitrary history rewriting, and silent user-change disposal remain denied.

Workspace release is conservative: tasks must be terminal, identity and provenance must still match, the worktree must be clean, and unique changes must be integrated. Refusal preserves evidence.

## Specialists

Explorer answers questions about this codebase. Librarian answers questions about external dependencies and platforms. Technical Advisor helps choose among genuinely difficult technical approaches but has no approval authority. Plan Reviewer independently audits a completed plan and returns `[APPROVED]` or `[REJECTED]` without repairing it.

## CodeGraph

The public CodeGraph CLI is provisioned independently and connected through `codegraph serve --mcp` in the authored OpenCode config. Explorer is the primary consumer of `codegraph_codegraph_explore`; other structurally relevant roles use it selectively. Graph results are derived structural evidence, never a substitute for source, diff, compiler, tests, or runtime proof.

## Browser capability

The dedicated `/browser` route launches the purpose-built `Browser` primary agent for direct navigation, interaction, visual inspection, Task Spaces, and browser evidence. Assistant independently routes website work to `browser-automation` with `load_skills=["ego-browser"]`; CategoryEngine launches an Implementer with editing disabled and a session-scoped permission for the installed browser skill/runtime only. Both use the current external Ego Lite backend, while the category remains backend-neutral. The two routes intentionally coexist.
