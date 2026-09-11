# Architecture

```text
User
 +-- ordinary work --> Assistant
 |                      +-- Explorer / Librarian / Technical Advisor
 |                      +-- CategoryEngine --> Implementer
 |                                            +-- consult_agents --> Explorer / Librarian
 |                                            +-- git
 |                                            +-- browser-automation
 |                                            +-- video-analysis + watch
 |                      +-- /browser --> Browser --> ego-browser backend
 |                      +-- /video --> Producer --> HyperFrames external skills/CLI
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

`delegate_task` requires exactly one category or allowlisted named specialist. Categories route to the reusable Implementer. Named specialists are Explorer, Librarian, Technical Advisor, Plan Reviewer, Researcher, Validator, Reviewer, and QA. Unknown names fail closed. `consult_agents` is a separate, runtime-guarded facade available only to `Implementer`; it accepts one to four concurrent requests targeting exactly `Explorer` or `Librarian`, carries no skills or category, and reuses the same child-session/task lifecycle for bounded information gathering. It never delegates implementation ownership.

The seven runtime tools are `workspace_prepare`, `delegate_task`, `consult_agents`, `task_status`, `task_output`, `task_cancel`, and `workspace_release`. The runtime uses only public OpenCode plugin and SDK surfaces.

The runtime also initializes outside Git repositories. In that case, ordinary delegation and task inspection use a stable directory-scoped control plane, while workspace preparation and release remain Git-only operations.

Categories are small execution profiles: one `model`, an optional string `variant`, an execution-mindset `prompt_append`, and optional tool narrowing. `opencode/categories.json` is loaded once at startup and field-merges user entries over built-ins. It supports built-in overrides, custom categories, and `disable: true`; an enabled category without a model fails clearly. There is no model fallback chain. Every category uses the same Implementer contract. Category context changes the executor's mindset and completion bar; it is not a second executor or a skill binding.

`load_skills` is an explicit list of installed/local skill names. The runtime advertises only name/description metadata and injects full content plus the selected skill's location for bundled runtime resolution into the child Implementer system context. Unknown names fail closed. Skill choice remains independent from category choice, while hard runtime authorization remains category-scoped: the current `watch` runtime boundary is available only to `video-analysis`.

Workspace release accepts either ancestry or Git-proven patch equivalence. A cherry-picked workspace is removed normally while its non-ancestor branch is retained when safe `git branch -d` refuses; release never force-deletes it.

## Background lifecycle

Independent tasks launched by one parent turn share a completion group. The parent performs unrelated work or becomes idle. Child events are observed and terminal state is persisted. Once every member is terminal, ParentResumeCoordinator resumes an eligible idle parent once. A missing status requires a current-process idle witness; busy, running, or retry status suppresses resume and invalidates stale witnesses. The parent retrieves detailed stored output after resume. There is no model-driven polling loop. `consult_agents` is synchronous: every consultation task is registered with `background: false` and `completion_group: null`, all requests are launched concurrently, and the call waits for ordered outcomes. Consultation tasks never resume the parent.

Consultation continuation is deliberately narrower than general delegation: `session_id` may refer only to a completed Explorer/Librarian consultation owned by the current Implementer and running in the same directory. The runtime sends the follow-up through the existing child session; in-flight, cross-parent, cross-directory, and target-changing continuations fail closed. Consultation does not expose `load_skills`.

## Workspace and integration lifecycle

Executor obtains a fresh Plan Reviewer verdict, prepares one provenance-bound workspace per eligible task, launches implementation, inspects each real diff, and delegates Reviewer/QA into that same workspace. After approval, Executor selects a deterministic integration order and delegates explicit Git mechanics through the `git` category. Task-scoped commits become source-derived integration inputs. A normal implementation category never re-applies reviewed changes in canonical.

The Git category is session-scoped through OpenCode's public permission hook. Ordinary Implementers retain their restrictive Git policy. Only the exact Git category may receive bounded status/log/diff/show/rev-parse, staging, commit, and selected-SHA cherry-pick operations. Destructive operations, force operations, arbitrary history rewriting, and silent user-change disposal remain denied.

The `video-analysis` category is also session-scoped. It disables repository mutation and admits the upstream `watch` skill only when the caller explicitly selects `load_skills=["watch"]`. Its permission boundary permits only the selected skill's `setup.py`/`watch.py`, the skill directory, and generated `watch-*` outputs beneath the system temp directory. The upstream skill owns video download, captions, frame extraction, timestamp filtering, and optional Whisper fallback; selecting `watch` with another category does not grant those runtime permissions.

Workspace release is conservative: tasks must be terminal, identity and provenance must still match, the worktree must be clean, and unique changes must be integrated. Refusal preserves evidence.

## Specialists

Explorer answers questions about this codebase. Librarian answers questions about external dependencies and platforms. Technical Advisor helps choose among genuinely difficult technical approaches but has no approval authority. Plan Reviewer independently audits a completed plan and returns `[APPROVED]` or `[REJECTED]` without repairing it.

## CodeGraph

The public CodeGraph CLI is provisioned independently and connected through `codegraph serve --mcp` in the authored OpenCode config. Explorer is the primary consumer of `codegraph_codegraph_explore`; other structurally relevant roles use it selectively. Graph results are derived structural evidence, never a substitute for source, diff, compiler, tests, or runtime proof.

## Browser capability

The dedicated `/browser` route launches the purpose-built `Browser` primary agent for direct navigation, interaction, visual inspection, Task Spaces, and browser evidence. Assistant independently routes website work to `browser-automation` with `load_skills=["ego-browser"]`; CategoryEngine launches an Implementer with editing disabled and a session-scoped permission for the installed browser skill/runtime only. Both use the current external Ego Lite backend, while the category remains backend-neutral. The two routes intentionally coexist.

## HyperFrames video capability

The dedicated `/video` route launches the `Producer` primary agent. Producer loads the official external `hyperframes` skill first, then follows its current intent, workflow, domain-skill, project, validation, preview, and render-approval contracts. The repository owns the route and the least-privilege boundary; it does not copy HyperFrames source, recreate its router, or vend its skills.

```text
User -> /video -> Producer -> /hyperframes -> selected workflow/domain skills -> HyperFrames CLI/project artifacts
```

Producer can edit and write active-project artifacts, ask the user at upstream interaction gates, and run the normal `npx hyperframes ...` path. It is denied access to protected `.env`-style files, Git history mutation, the workflow-owned Delegation Runtime, and unrelated global skills. External skill directories remain approval-gated because the official installer may place them under different supported global roots.

Current OpenCode exposes native `task` as a broad flat permission rather than a target-scoped frame-worker channel. Producer therefore leaves native task/delegation disabled and follows HyperFrames' documented serial fallback when a workflow has no usable delegation channel. No HyperFrames-specific scheduler, worker pool, or CategoryEngine exception is introduced. `video-production` is intentionally not a CategoryEngine category in this phase: HyperFrames is an interactive primary route, not a bounded Implementer execution profile.

## Video analysis boundary

The existing `video-analysis` category remains separate from production. It uses the independent upstream `watch` skill for grounded inspection of existing video, while `/video` uses HyperFrames for creation, editing, composition, preview, and rendering. Watch provisioning and permissions are unchanged.
