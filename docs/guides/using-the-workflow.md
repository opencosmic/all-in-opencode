# Using the workflow

## Ordinary work

Use Assistant for normal questions and bounded work. It may answer directly, inspect the codebase, make a truly small safe edit, or choose one specialist:

- Explorer for local code and architecture evidence.
- Librarian for upstream documentation and version-specific behavior.
- Technical Advisor for a difficult design decision with meaningful alternatives.

Use `/search <question>` or select `Searcher` when you want a standalone normal web Search / Answer Engine response. Assistant may also delegate a general or current web-search question to Searcher as a named leaf. Searcher uses bounded adaptive `websearch`/`websearch_*` and `webfetch` retrieval, checks freshness and source quality, and returns a concise grounded synthesis with citations. It is read-only, never delegates onward, and is distinct from Researcher, Librarian, browser automation, OpenSpec, and Deep Research.

Use `/research <question>` or select `Professor` when the question needs a durable, multi-aspect investigation. Professor creates a ResearchState plan, works through one prioritized task at a time using native web retrieval, records explicit evidence and contradictions, adapts to gaps, verifies claims, and persists a final report under the configured workflow data root. The canonical report stays in its run directory while a human-facing symlink is created under `/Users/code/Documents/Research/`. Completion returns a concise handoff with runtime metrics and the report path; if a later follow-up needs details outside the current context, Professor can lazily reload the clearly identified run through `research_report`. The runtime state—not chat history—is the source of truth. `Researcher` remains the bounded internal product/market evidence specialist for Strategist.

Non-trivial implementation flows through `delegate_task(category=...)` to Implementer. Use `load_skills=["skill-name"]` only for selected specialized instructions. Use `git` only when the Git operation and authority are explicit. Browser work uses the dedicated `/browser` route and Browser agent; it is not routed through the Implementer category catalog.

The category catalog is dynamic. Built-ins are centrally defined; the optional user-local `~/.config/opencode/aio.json` can add, override, or disable entries and may be absent. It is read once by the shared loader at the control-plane boundary. Each enabled entry uses one `model`, an optional `variant`, an optional `family`, an optional `prompt_append`, and optional tool narrowing. The file also supports explicit custom-agent opt-in and per-caller `categories`, `category_families`, and `agents` lists. These lists are unioned, including with the built-in `Producer -> video-analysis` default; Blender has no default category entry. Built-in Assistant/Executor breadth and Strategist/Planner/Verifier workflow ceilings remain in force. OpenCode's public effective-agent discovery is required for custom callers and targets; a custom target additionally needs `delegatable: true`. The schema has no model arrays, fallback models, `reasoning`, presets, catalogs, overlays, or inheritance. All category entries route to the shared Implementer. The category's `prompt_append` supplies its execution specialization, while `load_skills` remains an independent explicit capability selection and families do not grant exact-category runtime permissions.

Assistant uses todos for meaningful multi-step work and verifies results before reporting completion. It does not silently create OpenSpec changes.

## Formal workflow

```text
approved product strategy
  -> /spec <strategy>
  -> proposal.md + specs/**
  -> /plan <change>
  -> design.md + tasks.md + independent Plan Reviewer
  -> /execute <change>
  -> Executor execution preflight
  -> primary change branch/workspace + sequential implementation
  -> optional isolated child worktrees + review + integration into primary
  -> whole-change verification
  -> /verify <change>
  -> /ship <change>
```

`/spec` owns product behavior, not engineering design. `/plan` owns engineering design and unchecked tasks, not implementation. Technical Advisor may advise Planner on a genuinely difficult choice; Plan Reviewer remains the separate mandatory approval gate.

`/execute` treats `tasks.md` as the durable formal-workflow progress source. Before any branch/worktree or implementation delegation, Executor runs `execution_preflight` to reconcile the logical change with current Git/workspace state, persisted tasks, unfinished work, dependencies, source overlap, contention, acceptance criteria, verification, and any workspace description/checkpoint context. It reuses or resumes one primary change workspace by default, serializes dependent or overlapping tasks, and creates child worktrees only for concrete safe isolation/concurrency cases. It then launches ready work, yields, and resumes once when a background group is terminal; retrieves outputs, inspects diffs, obtains Reviewer/QA evidence, uses `git` for authorized task-local commits and integration into the primary branch, runs whole-change checks, updates checkboxes, and releases only clean integrated child workspaces. Normal `/execute` never integrates partial work into protected `main`/`master`.

`workspace_prepare(description=...)` records a short explanation of a primary or child workspace. `workspace_checkpoint_update` replaces the one local checkpoint at meaningful boundaries, and runtime records the actual workspace HEAD and timestamp. A checkpoint is recovery evidence, not an immutable plan: if HEAD or dirty state has changed, Executor inspects and re-plans as needed. `completed` in a checkpoint does not complete OpenSpec tasks or bypass Reviewer, QA, Verifier, or `/ship`; released manifests may retain their last checkpoint for diagnostics.

The intended topology is:

```text
logical change
    -> primary change branch/workspace
       -> sequential tasks in the same workspace
       -> optional child worktrees for safe parallel/isolation cases
    -> whole-change verification
    -> /ship
    -> main
```

Planner task boundaries do not imply separate agents, branches, or worktrees. Worktree is an isolation/concurrency mechanism, not the unit of work. If a child depends on another workspace's uncommitted changes, coordinate or make those changes shareable first; a new worktree from stale committed HEAD is not a valid resume.

If commit authority is absent, Executor preserves the workspace and reports integration pending. It never fakes completion or uses a normal Implementer to duplicate reviewed changes in canonical.

`/verify` independently proves the current implementation against the product contract. `/ship` preserves the existing explicit integration menu and never infers push, PR, deploy, cleanup, or archive authority.

## Background work

Launch independent tasks together only when preflight shows dependencies, required state, write scopes, and integration risk make that safe and isolation provides a concrete benefit. After launch, do unrelated useful work or yield. Do not poll task state in a loop. The runtime records completion and wakes the idle parent exactly once for the terminal group. Use `task_output` after that wake. `task_cancel` aborts a child but preserves its workspace.

## CodeGraph

Run `./scripts/setup-codegraph.sh` once per machine/repository and `./scripts/check-codegraph.sh` for health. Explorer uses the graph for architecture, structural relationships, and cross-file flow. If the index is unavailable, pending, stale, or insufficient, use ordinary source tools immediately. Always use real source, diffs, tests, and runtime evidence for correctness.

## Browser automation

Before first browser use, run:

```sh
./scripts/setup-ego-browser.sh
./scripts/check-ego-browser.sh
```

The dedicated user-facing route is `/browser`, backed by Ego Lite. Assistant-to-Browser delegation is not part of this phase. Login, CAPTCHA, MFA, payment, security confirmation, and user takeover remain human-control boundaries. Browser work must verify the resulting page state and must not mutate repository files.

For engineering verification of a web implementation, Executor may route a bounded assignment through `delegate_task(category="browser-testing")`. This is the shared Implementer category, not the dedicated Browser agent. It prefers the external `agent-browser` CLI for runtime verification, exploratory QA, reproduction, console or network evidence, screenshots, and accessibility checks. Each task must establish and use an isolated named session, never the shared unnamed/default session, then close it when verification is complete. If the CLI exists but browser startup fails or runtime readiness is uncertain, use `agent-browser doctor --offline --quick` before attributing the failure to the application. For persistent regression, E2E, or CI coverage, extend the repository's existing project-native framework; do not install a new E2E framework automatically or make Playwright the default. If a runtime assignment requires `agent-browser` and it is unavailable, report the actionable prerequisite rather than silently switching to another backend.

## OpenDesign references

When a UI task benefits from an existing OpenDesign design system or functional skill reference, use the shared Implementer route with the optional skill:

```text
delegate_task(category="visual-engineering", load_skills=["open-design"], ...)
```

The skill reads OpenDesign MCP resources through OpenCode and applies them as guidance while the current repository/worktree remains the source of truth. It does not use OpenDesign as an executor or call `start_run`. Prepare and verify the external prerequisite explicitly:

```sh
./scripts/setup-open-design.sh
./scripts/check-open-design.sh
```

Setup reuses a supported existing CLI/app installation and obtains the upstream print-only launch payload with `od mcp install opencode --print --json`; it stores the validated command, arguments, and environment in the user-local `~/.config/opencode/open-design-mcp.json` file. The repository launcher passes that metadata to the headless MCP process and does not rediscover the setup CLI at runtime, without opening the GUI or downloading software. If upstream returns only its metadata-free direct-daemon fallback, setup requires an explicit `OPEN_DESIGN_MCP_DAEMON_URL` or a supported runtime/daemon context rather than converting it into fake bootstrap mode. Set `OPEN_DESIGN_CLI` to an absolute CLI path if the system `od` command is unrelated; this is a setup-time override.

## Blender scene work

Use `/blender <goal>` for interactive Blender scene inspection, creation,
modeling, materials, lighting, cameras, supported animation, rendering,
requested saves/exports, and visual verification:

```text
User -> /blender -> Blender -> Blender MCP -> Blender addon -> Blender scene
```

This is a standalone primary route, not a CategoryEngine category or an
Implementer assignment. Normal Blender work does not own repository files,
Git, OpenSpec, workspace lifecycle, or Delegation Runtime state. Assistant
does not call Blender MCP directly; route scene work to `/blender`.

Blender MCP is external. Set it up explicitly with:

```sh
./scripts/setup-blender-mcp.sh
```

That command runs the upstream `uvx --python 3.11 blender-mcp install-addon`
path but does not launch Blender or manipulate its GUI. In Blender, enable
`Interface: MCP for Blender` if required, open the MCP for Blender panel, and
start the server. Check repository configuration and local tooling without
mutating the installation with:

```sh
./scripts/check-blender-mcp.sh
```

The authored defaults select managed Python 3.11, connect only to
`localhost:9876`, enable Safe Mode, and disable telemetry. The check remains
valid when Blender is closed and reports that live addon/server connectivity
still needs to be confirmed in Blender.

## Video analysis

Ask about the video itself when the required evidence is spoken content, transcript, frames, motion, editing, composition, a screen recording, or on-screen UI state. Assistant should route that work as `category="video-analysis"` with `load_skills=["watch"]`. For example, “Analyze the first 15 seconds of this video and explain the visual and spoken hook.” The `watch` skill remains independent from CategoryEngine and is selected explicitly, but the current hard runtime permissions support its bundled execution only under `video-analysis`; selecting it with another category does not automatically authorize its runtime.

Provision and inspect the upstream skill with:

```sh
./scripts/setup-watch.sh
./scripts/check-watch.sh
```

The upstream skill's bundled preflight owns its current macOS/Linux/Windows dependency guidance for `ffmpeg`, `ffprobe`, `yt-dlp`, and optional Whisper API configuration. On macOS it may use Homebrew for the binaries; API keys belong in the upstream `~/.config/watch/.env` file and are never stored in this repository.

## HyperFrames video production

Use `/video <goal>` for creating, editing, animating, previewing, and rendering a HyperFrames project. The route is intentionally separate from Assistant's `video-analysis` -> `watch` path:

```text
Assistant / ordinary work
Browser / /browser -> Ego Browser
Producer / /video -> HyperFrames
Assistant -> video-analysis -> Watch
```

`Producer` loads the official upstream `hyperframes` skill first. The upstream router then selects the current creation workflow or project operation and loads only the required HyperFrames domain skills. HyperFrames remains external: this repository owns the route, permissions, and provisioning scripts, but does not vendor its source or skill files.

Provision the core skill family explicitly:

```sh
./scripts/setup-hyperframes.sh
./scripts/check-hyperframes.sh
```

Setup uses the official `npx hyperframes skills update` command to refresh the core skill set and workflows that are already installed; it does not eagerly install every creation workflow. The check is read-only and confirms Node.js 22+, `npx`, FFmpeg, `ffprobe`, the `hyperframes` entry skill, OpenCode discovery, and the upstream `hyperframes skills check` result. If the upstream router selects a workflow that is missing or stale, it can request the named `npx hyperframes skills update <workflow-name>` refresh with user approval. Ordinary `/video` work must not update global skills silently. Use `HYPERFRAMES_SKIP_SKILLS=1` for normal initialization where appropriate.

The route has normal active-project edit/write access and user-question access for brief choices, storyboard or preview review, and final render approval. Git/history mutation, protected `.env`-style files, unrelated skills, workspace lifecycle, and native `task` remain outside its boundary. AIO task status/output/cancel controls are available only for children Producer created; they never manage HyperFrames internal workers. `delegate_task` is available only for policy-authorized bounded support, with `video-analysis` as the default category capability; use the upstream workflow's documented serial fallback for HyperFrames frame workers when no suitable channel is available. No new orchestration runtime is added, and `video-production` remains outside CategoryEngine for this phase.
