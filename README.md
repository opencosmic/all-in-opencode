# OpenCode workflow

This repository is the canonical authored source for a workflow-owned OpenCode/OpenSpec system. It uses stock OpenCode public plugin and SDK APIs, Git worktrees, an independent CodeGraph MCP server, and external browser and video runtimes. It has no Oh My OpenAgent runtime dependency.

## Workflows

`Assistant` handles ordinary work: explanations, investigation, bounded implementation, documentation, reviews, dependency research, Git mechanics, and browser interaction. It answers or edits directly when work is truly small, consults read-only specialists when evidence improves correctness, and routes non-trivial implementation through `delegate_task(category=...)` to `Implementer`. `Searcher` and `/search` provide a separate user-facing normal web Search / Answer Engine route for grounded current answers; `Professor` and `/research` provide stateful Deep Research with durable evidence and verification.

The formal lifecycle is:

```text
/spec -> Strategist -> proposal.md + specs/**
/plan -> Planner -> design.md + tasks.md -> Plan Reviewer
/execute -> Executor -> Implementer -> Reviewer/QA -> git category
/verify -> Verifier
/ship -> Executor
```

OpenSpec `tasks.md` is the only durable execution-progress source of truth. Runtime task and workspace manifests hold infrastructure provenance and recovery evidence, not workflow decisions.

## Agents

Primary agents are `Assistant`, `Browser`, `Blender`, `Producer`, `Searcher`, `Professor`, `Strategist`, `Planner`, and `Executor`. `Verifier` is the independent verification role used by the formal route. Read-only specialists are:

- `Explorer`: local source, symbols, architecture, and call/data-flow discovery.
- `Librarian`: official external documentation, upstream source, APIs, releases, and version-specific behavior.
- `Technical Advisor`: trigger-only consultation for difficult technical decisions; never an approval gate.
- `Plan Reviewer`: independent `[APPROVED]` / `[REJECTED]` plan gate.
- `Researcher`, `Validator`, `Reviewer`, and `QA`: bounded product evidence, falsification, code review, and runtime evidence.

Named delegation is fail closed. Only the repository-owned specialist allowlist is accepted.

`Searcher` is read-only and does bounded adaptive retrieval with native `websearch`/`websearch_*` and `webfetch`. It does not delegate, own OpenSpec, implement code, or replace the distinct `Researcher` and `Librarian` specialist roles. It is intentionally a normal-search route, not Deep Research.

`Professor` is read-only and owns the user-facing `/research` route. It uses native `websearch`/`websearch_*` and selective `webfetch` through a small persistent runtime. The runtime owns ResearchState, the priority frontier, evidence and claim IDs, budgets, contradictions, verification, events, and reports. The canonical report remains in the Professor run directory; completed runs expose a runtime-controlled symlink under `/Users/code/Documents/Research/`, and later follow-ups can reload a clearly identified completed report with `research_report`. Professor's final response is a concise localized handoff with runtime metrics and the report path, not a duplicate full report. `Researcher` remains a bounded product and market specialist for Strategist; `Librarian` remains a bounded external technical evidence specialist.

## Delegation Runtime

The runtime exposes seven tools:

- `workspace_prepare`
- `delegate_task`
- `consult_agents`
- `task_status`
- `task_output`
- `task_cancel`
- `workspace_release`

`CategoryEngine` maps the current enabled category registry to one reusable `Implementer`. Built-ins are preserved in the registry, while `opencode/categories.json` can override a built-in, add a custom category, or disable one without JavaScript changes. The `delegate_task` description presents the resolved catalog at startup.

`delegate_task` delegates a real scoped assignment. `consult_agents` is separate: only `Implementer` can call it, and only for a bounded batch of information-gathering requests to `Explorer` or `Librarian`. The batch starts its requests concurrently, waits synchronously for every outcome, and returns results in input order. Explorer reports local repository evidence; Librarian reports external documentation and upstream evidence. Neither consultant can edit, delegate, or consult another agent, and `Implementer` remains responsible for all implementation decisions, edits, and validation. Consultation tasks are always foreground (`background: false`, `completion_group: null`) and never enter the parent-resume lifecycle. A `session_id` may continue a completed consultation only for the same target, parent Implementer, and directory; skills are not exposed by this tool.

Category execution has three separate layers: the shared Implementer contract holds invariants for every delegated task, `category.prompt_append` supplies the selected execution mindset and completion bar, and `load_skills` injects only the explicitly selected capability instructions. Category choice and skill choice remain independent. Git and browser behavior still have hard session permissions; their category contexts do not replace those boundaries.

The Delegation Runtime loads in any directory. Ordinary `delegate_task` work does not require a Git repository; `workspace_prepare` and `workspace_release` remain Git/worktree operations and report a clear error when called outside one.

Categories define the model, optional variant, execution mindset, and optional tool narrowing. The V1 schema is intentionally small:

```json
{
  "categories": {
    "deep": { "model": "openai/gpt-5.6-sol", "variant": "max" },
    "backend-heavy": {
      "description": "Complex backend implementation work",
      "model": "provider/model",
      "variant": "high",
      "prompt_append": "Check failure and data-integrity paths."
    },
    "unused-category": { "disable": true }
  }
}
```

Each enabled category has exactly one configured `model` and may have one string `variant`; there are no model arrays, fallback models, or category-level `reasoning` fields. A category still routes only to the reusable Implementer. Skills are separate specialized instructions and are injected only when selected, for example `delegate_task(category="deep", load_skills=["debugging"], ...)`.

Independent background launches in one parent turn form one completion group. The parent does unrelated work or yields. `CompletionTracker` records terminal state and `ParentResumeCoordinator` resumes the idle parent exactly once after the group is terminal. The parent then retrieves bounded results with `task_output`; it does not run a model-driven polling loop.

Release is provenance-bound and non-destructive. The runtime accepts direct ancestry or Git-proven patch equivalence; after a cherry-pick it can remove the clean worktree while retaining the non-ancestor source branch instead of force-deleting it.

Executor prepares isolated workspaces, launches ready independent implementation categories, inspects real diffs, obtains Reviewer/QA evidence, determines integration order, and uses `category="git"` for explicitly authorized Git mechanics. The Git category may stage, create task-local commits, inspect history, and integrate selected SHAs, but cannot reset, clean, force-remove, force-push, or silently discard user changes. A normal implementation category is never used to re-apply an isolated diff into canonical.

## CodeGraph

CodeGraph is configured directly as a public local MCP server in [`opencode/opencode.jsonc`](opencode/opencode.jsonc):

```text
codegraph serve --mcp
```

The stable OpenCode tool is `codegraph_codegraph_explore`. Explorer is its main consumer. Other structurally relevant roles may use it selectively. CodeGraph is derived structural evidence; source, Git diff, compilers, tests, and runtime observations remain correctness authority.

Install the public CodeGraph CLI and initialize this repository once:

```sh
./scripts/setup-codegraph.sh
```

Check runtime, index, and OpenCode MCP health with:

```sh
./scripts/check-codegraph.sh
```

## Browser automation

There are intentionally two browser entry paths for practical comparison:

- `/browser` opens the dedicated workflow-owned `Browser` agent for direct browser workflows.
- Assistant delegates `category="browser-automation", load_skills=["ego-browser"]` through CategoryEngine to Implementer for browser work requested as part of ordinary assistance.

The dedicated `Browser` route is the workflow-facing browser agent. The `browser-automation` category is browser capability through the reusable Implementer, and `ego-browser` is the current external backend/skill identifier. Both paths use the external official `citrolabs/ego-lite` runtime.

Provision the current backend explicitly, then verify it:

```sh
./scripts/setup-ego-browser.sh
./scripts/check-ego-browser.sh
```

The backend remains external. This repository does not vendor its skill, application, Task Spaces, browser state, or credentials.

## HyperFrames video production

Video production has its own primary route:

```text
User -> /video -> Producer -> /hyperframes -> HyperFrames workflows and domain skills
```

`Producer` is dedicated to HyperFrames-backed creation, editing, animation, composition, preview, and rendering. It is not a general coding agent, OpenSpec worker, CategoryEngine `Implementer`, Git worker, or video-content analysis route. It preserves the upstream brief, review, preview, and final-render approval gates and writes project artifacts in the active project.

HyperFrames is an external upstream framework and skill set. The repository does not vendor or fork it. Run the explicit provisioning flow when the skill set is missing or needs an update:

```sh
./scripts/setup-hyperframes.sh
./scripts/check-hyperframes.sh
```

The setup script uses the official `npx hyperframes skills update` path to refresh the core skill set and workflows that are already installed. It does not eagerly install every creation workflow. When `/hyperframes` selects a workflow that is not installed, the upstream router can request the named `npx hyperframes skills update <workflow-name>` refresh; Producer keeps that global mutation approval-gated. Ordinary `/video` work never silently updates global skills, and normal `init` work should use `HYPERFRAMES_SKIP_SKILLS=1` where appropriate. Workflow skills remain available on demand through the upstream router.

HyperFrames is intentionally not a `video-production` CategoryEngine category in this phase. The shared CategoryEngine -> `Implementer` path remains for bounded execution profiles, while HyperFrames owns an interactive orchestration flow that may pause for brief, storyboard, preview, or render decisions. Video-content questions remain separate: `Assistant` -> `video-analysis` -> `watch`.

## Blender scene work

Blender has its own primary route:

```text
User -> /blender -> Blender -> Blender MCP -> Blender addon -> Blender scene
```

`Blender` is dedicated to scene inspection, modeling, materials, lighting,
cameras, supported animation, rendering, requested saves/exports, and fresh
visual verification. It is not a general coding agent, Implementer, OpenSpec,
Git, CategoryEngine, or Delegation Runtime worker. Assistant routes Blender
scene work to `/blender` and does not call Blender MCP directly.

Blender MCP remains the external `ahujasid/blender-mcp` dependency. The
repository owns only the route, MCP configuration, least-privilege agent
policy, setup/check scripts, tests, and documentation. Provision the addon
explicitly:

```sh
./scripts/setup-blender-mcp.sh
./scripts/check-blender-mcp.sh
```

The setup command uses the upstream `uvx --python 3.11 blender-mcp
install-addon` path and does not launch Blender or change GUI state. In Blender,
enable `Interface: MCP for Blender` if needed, open the MCP for Blender panel,
and start the server. The authored MCP configuration pins managed Python 3.11,
keeps the socket on localhost:9876, enables Safe Mode, and disables telemetry.
The read-only check does not require Blender to be running; it reports that
addon/server connectivity must be confirmed in Blender.

The Phase 1 agent allowlist is limited to addon status, scene info, object info,
viewport screenshots, and Blender code execution, plus user questions. Future
upstream tools and provider-backed asset or AI-generation integrations are not
implicitly authorized.

## Video analysis

For questions that depend on the actual contents of a video, Assistant routes through the shared Implementer with `category="video-analysis"` and `load_skills=["watch"]`. This covers summaries, timestamped questions, hooks, editing structure, screen recordings, visual-versus-spoken comparisons, and on-screen UI evidence. A website-only task remains `browser-automation`; watching the video embedded on that website is `video-analysis`.

Provision the upstream `bradautomates/claude-video` Agent Skill with:

```sh
./scripts/setup-watch.sh
./scripts/check-watch.sh
```

The setup script installs the self-contained `watch` skill into an existing supported global skill root. Its own bundled `scripts/setup.py` handles the current `ffmpeg`, `ffprobe`, and `yt-dlp` preflight and optional Whisper configuration. The project does not vendor those scripts or store API keys. The normal example is: “Analyze the first 15 seconds of this video and explain the visual and spoken hook.”

## OpenDesign design references

OpenDesign is an optional, read-only design resource capability. For frontend/UI/design work that benefits from its references, delegate with:

```text
category="visual-engineering", load_skills=["open-design"]
```

The selected skill discovers and reads OpenDesign `DESIGN.md` and `SKILL.md` resources through OpenCode's generic MCP resource interface. OpenCode and `opencode-workflow` remain the control plane: the Implementer edits the current repository/worktree, which remains the source of truth, and the existing verification workflow remains authoritative. This integration intentionally does not call OpenDesign's nested agent-running `start_run` path or expose its raw MCP tools.

Provisioning is explicit and uses an already-installed supported OpenDesign CLI or app; the UI is not required for normal headless MCP use when the installed upstream supports it. Setup asks the upstream CLI for its print-only canonical payload (`od mcp install opencode --print --json`), preserves the generated command, arguments, and environment, and stores that machine-local launch metadata at `~/.config/opencode/open-design-mcp.json` (outside Git):

```sh
./scripts/setup-open-design.sh
./scripts/check-open-design.sh
```

If `od` on `PATH` is ambiguous, set `OPEN_DESIGN_CLI` to the absolute path of the supported OpenDesign CLI for setup. After provisioning, the persisted spec—not a rediscovered `od` wrapper—is the runtime source of truth. The repository launcher consumes the saved spec, including upstream headless-bootstrap metadata, and an `OPEN_DESIGN_MCP_DAEMON_URL` override remains available. If upstream can return only its metadata-free direct-daemon fallback while no daemon URL was supplied, setup fails clearly instead of pretending that `od mcp` can cold-start the packaged runtime. The setup and check scripts do not download software, open the GUI, or mutate unrelated configuration.

## Installation

The live OpenCode configuration is linked narrowly from this repository:

```sh
./scripts/install.sh --dry-run
./scripts/install.sh
```

The installer backs up pre-existing matching content before linking. During migration it removes the old `~/.omo/omo.jsonc` destination only when it is a symlink to this repository's former managed config. Any other file or symlink is preserved and reported.

Install the stock public JavaScript plugin dependency where OpenCode discovers it:

```sh
npm install --prefix ~/.config/opencode @opencode-ai/plugin@1.18.29
```

Final verification used OpenCode 1.18.30, `@opencode-ai/plugin` 1.18.29, CodeGraph 1.5.0, OpenSpec CLI, and Node.js 24.

## Verification

```sh
git diff --check
node --test opencode/tests/*.test.js
./scripts/verify.sh
npm ls --depth=1 --prefix ~/.config/opencode
npm audit --omit=dev --prefix ~/.config/opencode
opencode debug config
opencode agent list
opencode debug agent Assistant
opencode debug agent Browser
opencode debug agent Blender
opencode debug agent Producer
opencode debug agent Executor
```

The deterministic suite covers discovery, permissions, planning/execution gates, independent CodeGraph configuration, loader safety, shared cross-worktree control-plane ownership, workspace provenance, completion correctness, grouped single-resume behavior, cancellation, category-specific Git/browser policy, and conservative release.

Edit canonical files here, rerun verification, inspect the diff, and commit one coherent change. Never copy sessions, caches, credentials, indexes, runtime state, browser state, or external repositories into this repository.
