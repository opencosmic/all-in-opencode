# All-in OpenCode (aio)

**All-in OpenCode (aio)** is the canonical authored source for an OpenCode/OpenSpec system. It extends and integrates with the upstream OpenCode coding agent through public plugin and SDK APIs, Git worktrees, an independent CodeGraph MCP server, and external browser and video runtimes. It has no Oh My OpenAgent runtime dependency.

In this documentation, `OpenCode` means the upstream coding agent/runtime; `All-in OpenCode` or `aio` means this repository's extensions and workflow.

## Workflows

`Assistant` handles ordinary work: explanations, investigation, bounded implementation, documentation, reviews, dependency research, Git mechanics, and video analysis. It answers or edits directly when work is truly small, consults read-only specialists when evidence improves correctness, can delegate general or current web search to the read-only `Searcher` leaf, and routes non-trivial implementation through `delegate_task(category=...)` to `Implementer`. `Searcher` and `/search` provide a separate user-facing normal web Search / Answer Engine route for grounded current answers; `Professor` and `/research` provide stateful Deep Research with durable evidence and verification.

The formal lifecycle is:

```text
/spec -> Strategist -> proposal.md + specs/**
/plan -> Planner -> design.md + tasks.md -> Plan Reviewer
/execute -> Executor preflight -> primary change workspace -> Implementer -> Reviewer/QA -> primary integration
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

`Director`, `Creator`, and `Editor` are dedicated `subagent` phase owners for Producer-led video production. They can delegate only their bounded execution and analysis categories; ordinary named specialists remain leaves.

Named delegation is fail closed. Built-in specialists retain their workflow-specific parent ceilings; custom OpenCode agents are eligible only when the public effective-agent list contains them, `aio.json` opts them in with `delegatable: true`, and the caller lists them. `Verifier` remains reserved for Executor's fresh shipping-verification handoff.

`Searcher` is read-only and does bounded adaptive retrieval with native `websearch`/`websearch_*` and `webfetch`. It may run directly through `/search` or as an explicitly authorized Assistant/configured-caller leaf, but it never delegates onward, owns OpenSpec, implements code, or replaces the distinct `Researcher` and `Librarian` specialist roles. It is intentionally a normal-search route, not Deep Research.

`Professor` is read-only and owns the user-facing `/research` route. It uses native `websearch`/`websearch_*` and selective `webfetch` through a small persistent runtime. The runtime owns ResearchState, the priority frontier, evidence and claim IDs, budgets, contradictions, verification, events, and reports. The canonical report remains in the Professor run directory; completed runs expose a runtime-controlled symlink under `/Users/code/Documents/Research/`, and later follow-ups can reload a clearly identified completed report with `research_report`. Professor's final response is a concise localized handoff with runtime metrics and the report path, not a duplicate full report. `Researcher` remains a bounded product and market specialist for Strategist; `Librarian` remains a bounded external technical evidence specialist.

## Delegation Runtime

The runtime exposes delegation tools, three Producer-only production tools, and six bounded Atlas Cloud media tools:

- `execution_preflight`
- `workspace_prepare`
- `production_preflight`
- `production_prepare_artifacts`
- `production_checkpoint`
- `delegate_task`
- `consult_agents`
- `task_status`
- `task_output`
- `task_cancel`
- `workspace_release`
- `media_calculate`
- `media_upload`
- `media_generate_image`
- `media_generate_video`
- `media_prediction`
- `media_wait_prediction`

`CategoryEngine` maps the current enabled category registry to one reusable `Implementer`. Built-ins are repository-owned in the registry, while the optional user-local `~/.config/opencode/aio.json` can override a built-in, add a custom category, or disable one without JavaScript changes. The loader reads this file once per control plane; an absent file means only built-ins are used. Delegation policy keeps Assistant broad, caps Executor at the `implementation` family, and caps Producer at the `media` family except for `media-generation`, reserved for Assistant/Creator, while reserving `blender-previs` for Director. Producer delegates named Director, Creator, and Editor; only Executor retains the named Blender route. Director may call `blender-previs` and `video-analysis`, Creator may call `media-generation` and `video-analysis`, and Editor may call `video-analysis`. These exact phase ceilings cannot be widened through `aio.json`. Blender remains category-free. The static `delegate_task` description is caller-neutral; each delegating agent receives only the enabled categories it is authorized to use in its AIO system context. That catalog is derived from `CategoryEngine` and `DelegationPolicy`, not maintained as a separate allowlist.

`delegate_task` delegates a real scoped assignment. `consult_agents` is separate: only `Implementer` can call it, and only for a bounded batch of information-gathering requests to `Explorer` or `Librarian`. The batch starts its requests concurrently, waits synchronously for every outcome, and returns results in input order. Explorer reports local repository evidence; Librarian reports external documentation and upstream evidence. Neither consultant can edit, delegate, or consult another agent, and `Implementer` remains responsible for all implementation decisions, edits, and validation. Consultation tasks are always foreground (`background: false`, `completion_group: null`) and never enter the parent-resume lifecycle. A `session_id` may continue a completed consultation only for the same target, parent Implementer, and directory; skills are not exposed by this tool.

Category execution has three separate layers: the shared Implementer contract holds invariants for every delegated task, `category.prompt_append` supplies the selected execution mindset and completion bar, and `load_skills` injects only the explicitly selected capability instructions. Category choice and skill choice remain independent. Git and video behavior still have hard session permissions; their category contexts do not replace those boundaries.

The Delegation Runtime loads in any directory. Ordinary `delegate_task` work does not require a Git repository; `workspace_prepare` and `workspace_release` remain Git/worktree operations and report a clear error when called outside one.

Categories define the model, optional variant, execution mindset, optional tool narrowing, and an optional lightweight `family` label. The V1 schema is intentionally small and lives under `~/.config/opencode/aio.json`:

```json
{
  "version": 1,
  "categories": {
    "deep": { "model": "openai/gpt-5.6-sol", "variant": "max", "family": "implementation" },
    "backend-heavy": {
      "description": "Complex backend implementation work",
      "model": "provider/model",
      "variant": "high",
      "family": "implementation",
      "prompt_append": "Check failure and data-integrity paths."
    },
    "unused-category": { "disable": true }
  },
  "agents": {
    "Security Reviewer": { "delegatable": true }
  },
  "delegation": {
    "My Architect": {
      "categories": ["backend-heavy"],
      "category_families": ["implementation"],
      "agents": ["Explorer", "Security Reviewer"]
    }
  }
}
```

Each enabled category has exactly one configured `model` and may have one string `variant`; there are no model arrays, fallback models, category-level `reasoning`, presets, catalogs, overlays, or inheritance. `family` is an authorization grouping for configured callers; it does not grant the exact-category Git, video, or other runtime permissions. A category still routes only to the reusable Implementer. The built-in family catalog is `implementation` (`quick`, `standard`, `blender-previs`, `deep`, `ultrabrain`, `visual-engineering`, `writing`, `artistry`, `unspecified-low`, `unspecified-high`, `migration`, `database`, `testing`, `browser-testing`, `bugfix`, `tiny-refactor`, and `git`) plus `media` (`video-analysis` and `media-generation`). A built-in category's family is canonical architecture metadata: `aio.json` may repeat the same family, but cannot reclassify it; other built-in fields remain configurable. Custom categories may choose their own family. The `categories`, `category_families`, and `agents` lists in each `delegation` entry are unioned, then the hard role ceilings apply: Assistant remains broad except for caller-exclusive categories, Executor may use only `implementation` except for those same hard boundaries, Producer may use `media` except `media-generation`, which is Assistant/Creator-only; `blender-previs` is Director-only. Director may use exactly `blender-previs` and `video-analysis`, Creator exactly `media-generation` and `video-analysis`, and Editor exactly `video-analysis`; Strategist/Planner/Blender retain their existing restrictions. Named-agent ceilings and Blender's category-free leaf boundary remain separate hard boundaries. Custom callers and targets must be present in OpenCode's public effective-agent discovery, and custom targets additionally require the `agents` opt-in. Skills are separate specialized instructions and are injected only when selected, for example `delegate_task(category="deep", load_skills=["debugging"], ...)`.

Independent background launches in one parent turn form one completion group. The parent does unrelated work or yields. `CompletionTracker` records terminal state and `ParentResumeCoordinator` resumes the idle parent exactly once after the group is terminal. The parent then retrieves bounded results with `task_output`; it does not run a model-driven polling loop.

Release is provenance-bound and non-destructive. The runtime accepts direct ancestry or Git-proven patch equivalence; after a cherry-pick it can remove the clean worktree while retaining the non-ancestor source branch instead of force-deleting it.

Executor first reconciles each logical change with current Git/workspace and persisted task reality through mandatory `execution_preflight`. It reuses or creates one primary change branch/workspace, runs sequential tasks there by default, and uses child worktrees only when safe isolation or concurrency provides a concrete benefit. It inspects real diffs, obtains Reviewer/QA evidence, determines integration order, and uses `category="git"` for explicitly authorized mechanics into the primary change branch. The Git category may stage, create task-local commits, inspect history, and integrate selected SHAs, but cannot mutate protected `main`/`master`, reset, clean, force-remove, force-push, or silently discard user changes. Whole-change verification precedes `/ship`, the normal final boundary into the protected base, and a normal implementation category is never used to re-apply an isolated diff into canonical.

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

Browser automation has one dedicated entry path:

- `/browser` opens the dedicated `Browser` agent provided by All-in OpenCode for direct browser workflows.

The dedicated `Browser` route is the All-in OpenCode-facing browser agent. It independently uses `ego-browser`, the current external backend/skill identifier, through the official `citrolabs/ego-lite` runtime. Browser work is not an Implementer category, and Assistant-to-Browser delegation is not part of this phase.

Engineering verification of a web implementation uses the separate `browser-testing` CategoryEngine profile through the shared Implementer. It prefers the external [Vercel Labs `agent-browser` CLI](https://github.com/vercel-labs/agent-browser) for runtime verification, exploratory QA, reproduction, console or network evidence, screenshots, and accessibility checks. Persistent regression, E2E, and CI work extends an existing project-native framework when one exists; AIO does not install a new framework or make Playwright the default. `browser-testing` is not the `/browser` route and never uses Browser or `ego-browser` as its backend.

Each `browser-testing` task must run `agent-browser session id --scope worktree --prefix "browser-testing-$(date +%s)-$$"` in its own Bash call and copy the literal stdout value. Use that exact literal with `--session <id>` on every later invocation, including guidance, browser actions, diagnostics, and close; do not rely on shell variables or exported `AGENT_BROWSER_SESSION` surviving across calls or use the unnamed/default session. If runtime readiness is uncertain, use `agent-browser --session <id> doctor --offline --quick`; if startup fails and the quick check is insufficient, use the full `agent-browser --session <id> doctor` diagnostic.

Browser-command success is not equivalent to application success. For meaningful interactions, verify the smallest relevant observable postcondition, use one bounded normal retry with a fresh ref or semantic locator when it is missing, and report a suspected no-op when the effect is still absent. DOM-level event dispatch is diagnostic-only and must not turn an unverified normal interaction into a pass.

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

`Producer` remains the single video-production orchestration owner. `/video` is the lightweight HyperFrames-first route for deterministic motion graphics, product/UI showcases, explainers, screen recordings, captions, existing footage, and simple social videos. It does not load the film methodology or invoke media generation.

HyperFrames is an external upstream framework and skill set. The repository does not vendor or fork it. Run the explicit provisioning flow when the skill set is missing or needs an update:

```sh
./scripts/setup-hyperframes.sh
./scripts/check-hyperframes.sh
```

The setup script uses the official `npx hyperframes skills update` path to refresh the core skill set and workflows that are already installed. It does not eagerly install every creation workflow. When `/hyperframes` selects a workflow that is not installed, the upstream router can request the named `npx hyperframes skills update <workflow-name>` refresh; Producer keeps that global mutation approval-gated. Ordinary `/video` work never silently updates global skills, and normal `init` work should use `HYPERFRAMES_SKIP_SKILLS=1` where appropriate. Workflow skills remain available on demand through the upstream router.

HyperFrames is intentionally not a `video-production` CategoryEngine category in this phase. The shared CategoryEngine -> `Implementer` path remains for bounded execution profiles, while HyperFrames owns an interactive orchestration flow that may pause for brief, storyboard, preview, or render decisions. Video-content questions remain separate: `Assistant` -> `video-analysis` -> `watch`.

## Advanced AI filmmaking

Use `/film` for the advanced film-production workflow:

```text
/film -> Producer -> film-production -> ShotSpec[] -> production routing
      -> Director PREVIS -> blender-previs -> video-analysis/Watch
      -> Creator strategy -> Producer approval -> Creator media-generation
      -> Creator video-analysis/Watch -> Producer assets-ready checkpoint [M4 stop]
```

`film-production` is a repository-owned methodology skill. It defines
renderer-neutral shotcraft, validated `ShotSpec` entries, one resumable
`ProductionManifest`, reference-asset handling, routing, and revision guidance.
Producer owns the live film workflow's interaction, canonical state, budget,
approval, and lifecycle. Director owns creative intent, ShotSpecs, and previs;
Creator owns generated-media strategy and execution coordination; Editor owns
post-production with the official upstream HyperFrames skill directly. The
`blender-previs` category is the reusable camera/blocking/timing Implementer
for Director. Named Blender is outside the video-production graph. `media-generation` is a
bounded provider-neutral Implementer category, HyperFrames remains the
composition and render authority, and `video-analysis`/Watch provides
grounded QA of stills, preview video, and generated footage.

Producer uses the deterministic `production_preflight` tool to create or resume
`production/production-manifest.json`. `production_prepare_artifacts` checks
canonical `production/...` file destinations, creates only their safe parent
directories, and returns transient absolute runtime paths for previs or later
execution. `production_checkpoint` replaces one concise recovery summary in
the same manifest without changing lifecycle revision or history. Producer
decides spending and approvals and owns lifecycle transitions. Creator proposes
generated-media strategy, obtains quotes through `media-generation`, and stops
for Producer's explicit user approval before submission. In M4, `/film` stops
after successful generated-media review at `assets-ready`; composition and
final QA remain future work.

Assistant remains technically able to delegate enabled media categories as part
of its broad orchestration role; Producer cannot delegate `media-generation`,
and `/film` ownership still belongs to Producer.

The `/film` media runtime currently implements Atlas Cloud only. It calculates
the exact effective request before submission, requires request-digest and cost
approval data, uploads only project-local media, polls asynchronously, and
materializes completed outputs into local production assets. There is no
provider fallback, automatic reroll, or generic HTTP tool. Set
`ATLASCLOUD_API_KEY` in the runtime environment; tests use injected fake
transports and never spend credits.

## Blender 3D leaf work

Blender has its own reusable 3D route:

```text
User -> /blender -> Blender -> Blender MCP -> Blender addon -> Blender scene
```

`Blender` is a reusable 3D leaf specialist (`mode: all`) for scene inspection,
modeling, materials, lighting, cameras, animation, asset preparation,
import/export, rendering, previs, and fresh visual verification. It is
available directly through `/blender` and by named delegation from `Executor`:

```text
/blender             -> Blender
Executor             -> Blender (general-purpose Blender work)
```

Blender owns Blender-native scene/artifact work and does not delegate child AIO
tasks. It cannot use categories and receives no category catalog. For product
work it returns relevant `.blend`/GLB/glTF/FBX artifacts and integration notes;
for general-purpose Blender work it returns the scene/preview plus camera,
timing, blocking, and shot assumptions. `/film` previs uses the
`blender-previs` Implementer category, whose stills and preview video are
reviewed through `video-analysis` before paid generation. Generic React,
Three.js, UI, asset-loader, and repository engineering remains with the parent
and its Implementer workflow.

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

For questions that depend on the actual contents of a video, Assistant routes through the shared Implementer with `category="video-analysis"` and `load_skills=["watch"]`. This covers summaries, timestamped questions, hooks, editing structure, screen recordings, visual-versus-spoken comparisons, and on-screen UI evidence. Website interaction remains the responsibility of the dedicated Browser route; watching the video embedded on that website is `video-analysis`.

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

The selected skill discovers and reads OpenDesign `DESIGN.md` and `SKILL.md` resources through OpenCode's generic MCP resource interface. OpenCode and All-in OpenCode (`aio`) remain the control plane: the Implementer edits the current repository/worktree, which remains the source of truth, and the existing verification workflow remains authoritative. This integration intentionally does not call OpenDesign's nested agent-running `start_run` path or expose its raw MCP tools.

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

Project runtime data uses `AIO_DATA_ROOT` when set, otherwise `$XDG_DATA_HOME/all-in-opencode` or `~/.local/share/all-in-opencode`. Installer migration backups default to `~/Workspace/data/all-in-opencode`. Existing `OPENCODE_WORKFLOW_DATA_ROOT` configurations and legacy data under `opencode-workflow` remain supported for compatibility.

Install the stock public JavaScript plugin dependency where OpenCode discovers it:

```sh
npm install --prefix ~/.config/opencode @opencode-ai/plugin@1.18.29
```

Install the external `/cache-stats` TUI plugin and verify the pinned upstream file:

```sh
./scripts/setup-cache-stats.sh
./scripts/check-cache-stats.sh
```

The workflow registers `./tui-plugins/cache-stats.tsx` in its canonical `tui.json`, while the plugin source remains outside this repository under `~/.config/opencode/tui-plugins/`. Restart OpenCode after installation or after this namespace migration, then run `/cache-stats` inside a session.

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

The deterministic suite covers discovery, permissions, planning/execution gates, independent CodeGraph configuration, loader safety, shared cross-worktree control-plane ownership, workspace provenance, completion correctness, grouped single-resume behavior, cancellation, category-specific Git/video policy, dedicated Browser policy, and conservative release.

Edit canonical files here, rerun verification, inspect the diff, and commit one coherent change. Never copy sessions, caches, credentials, indexes, runtime state, browser state, or external repositories into this repository.
