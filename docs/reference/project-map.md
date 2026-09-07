# Project map

| Path | Purpose |
|---|---|
| [`opencode/agents/`](../../opencode/agents/) | Workflow roles, including reusable Implementer and read-only Reviewer/QA specialists. |
| [`opencode/commands/`](../../opencode/commands/) | `/ego`, `/omo`, `/spec`, `/plan`, `/execute`, `/verify`, and `/ship`. |
| [`opencode/plugins/delegation-runtime.js`](../../opencode/plugins/delegation-runtime.js) | Public six-tool Delegation Runtime plugin entry. |
| [`opencode/plugins/delegation/`](../../opencode/plugins/delegation/) | WorkspaceManager, category configuration/engine, TaskRegistry, SessionRunner, CompletionTracker, ParentResumeCoordinator, and dispatch boundaries. |
| [`opencode/plugins/workspace-inspector.js`](../../opencode/plugins/workspace-inspector.js) | Read-only repository/worktree preflight. |
| [`opencode/plugins/planner-delegation-guard.js`](../../opencode/plugins/planner-delegation-guard.js) | Planner consultation limits. |
| [`opencode/tests/`](../../opencode/tests/) | Deterministic policy, plugin, fake-SDK, completion, background, and temporary-Git-worktree tests. |
| [`opencode/opencode.jsonc`](../../opencode/opencode.jsonc), [`opencode/tui.json`](../../opencode/tui.json) | Stock OMO plugin declaration and public-safe OpenCode configuration. |
| [`opencode/package.json`](../../opencode/package.json) | Exact public OpenCode plugin/SDK dependency used for local validation. |
| [`omo/omo.jsonc`](../../omo/omo.jsonc) | Stock OMO configuration for unrelated existing routes; not a Delegation Runtime dependency. |
| [`scripts/`](../../scripts/) | Conservative live-link installation and verification only. |

The live link topology is defined by [`scripts/links.tsv`](../../scripts/links.tsv). Runtime provenance is stored outside Git and never replaces OpenSpec `tasks.md`.
