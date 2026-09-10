# Using the workflow

## Ordinary work

Use Assistant for normal questions and bounded work. It may answer directly, inspect the codebase, make a truly small safe edit, or choose one specialist:

- Explorer for local code and architecture evidence.
- Librarian for upstream documentation and version-specific behavior.
- Technical Advisor for a difficult design decision with meaningful alternatives.

Use `/search <question>` or select `Searcher` when you want a standalone normal web Search / Answer Engine response. Searcher uses bounded adaptive `websearch`/`websearch_*` and `webfetch` retrieval, checks freshness and source quality, and returns a concise grounded synthesis with citations. It is read-only, does not delegate, and is distinct from Researcher, Librarian, browser automation, OpenSpec, and future Deep Research.

Non-trivial implementation flows through `delegate_task(category=...)` to Implementer. Use `load_skills=["skill-name"]` only for selected specialized instructions. Use `git` only when the Git operation and authority are explicit. For browser work, use `/browser` for the dedicated Browser agent or ask Assistant, which routes it through `browser-automation` with `load_skills=["ego-browser"]` to the currently installed browser backend. Both entry paths are intentionally retained.

The category catalog is dynamic. Built-ins are centrally defined; `opencode/categories.json` can add, override, or disable entries. Each enabled entry uses one `model`, an optional `variant`, an optional `prompt_append`, and optional tool narrowing. It does not support model arrays, fallback models, or `reasoning`. All category entries route to the shared Implementer. The category's `prompt_append` supplies its execution specialization, while `load_skills` remains an independent explicit capability selection.

Assistant uses todos for meaningful multi-step work and verifies results before reporting completion. It does not silently create OpenSpec changes.

## Formal workflow

```text
approved product strategy
  -> /spec <strategy>
  -> proposal.md + specs/**
  -> /plan <change>
  -> design.md + tasks.md + independent Plan Reviewer
  -> /execute <change>
  -> isolated implementation + review + deterministic Git integration
  -> /verify <change>
  -> /ship <change>
```

`/spec` owns product behavior, not engineering design. `/plan` owns engineering design and unchecked tasks, not implementation. Technical Advisor may advise Planner on a genuinely difficult choice; Plan Reviewer remains the separate mandatory approval gate.

`/execute` treats `tasks.md` as the durable progress source. It prepares isolated workspaces only from sufficient committed baselines, launches independent ready tasks in one background group, yields, and resumes once when the group is terminal. It then retrieves outputs, inspects diffs, obtains Reviewer/QA evidence, uses `git` for authorized task-local commits and integration, runs combined checks, updates checkboxes, and releases clean integrated workspaces.

If commit authority is absent, Executor preserves the workspace and reports integration pending. It never fakes completion or uses a normal Implementer to duplicate reviewed changes in canonical.

`/verify` independently proves the current implementation against the product contract. `/ship` preserves the existing explicit integration menu and never infers push, PR, deploy, cleanup, or archive authority.

## Background work

Launch independent tasks together only when dependencies and write scopes make that safe. After launch, do unrelated useful work or yield. Do not poll task state in a loop. The runtime records completion and wakes the idle parent exactly once for the terminal group. Use `task_output` after that wake. `task_cancel` aborts a child but preserves its workspace.

## CodeGraph

Run `./scripts/setup-codegraph.sh` once per machine/repository and `./scripts/check-codegraph.sh` for health. Explorer uses the graph for architecture, structural relationships, and cross-file flow. If the index is unavailable, pending, stale, or insufficient, use ordinary source tools immediately. Always use real source, diffs, tests, and runtime evidence for correctness.

## Browser automation

Before first browser use, run:

```sh
./scripts/setup-ego-browser.sh
./scripts/check-ego-browser.sh
```

The dedicated user-facing route is `/browser` and the Assistant category route is `browser-automation`; Ego Lite is only the current backend. Login, CAPTCHA, MFA, payment, security confirmation, and user takeover remain human-control boundaries. Browser work must verify the resulting page state and must not mutate repository files.

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

The route has normal active-project edit/write access and user-question access for brief choices, storyboard or preview review, and final render approval. Git/history mutation, protected `.env`-style files, unrelated skills, `delegate_task`, workspace lifecycle, and task-control tools remain outside its boundary. Native OpenCode task delegation is disabled because the current permission surface cannot bind a child to HyperFrames' frame-worker contract narrowly; use the upstream workflow's documented serial fallback when no delegation channel is available. No new orchestration runtime is added, and `video-production` remains outside CategoryEngine for this phase.
