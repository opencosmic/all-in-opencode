# Project map

| Path | Purpose |
|---|---|
| [`opencode/agents/`](../../opencode/agents/) | Assistant, Browser, formal lifecycle roles, specialists, and Implementer. |
| [`opencode/commands/`](../../opencode/commands/) | `/spec`, `/plan`, `/execute`, `/verify`, `/ship`, and `/browser`. |
| [`opencode/plugins/delegation-runtime.js`](../../opencode/plugins/delegation-runtime.js) | Loader-safe Delegation Runtime entrypoint. |
| [`opencode/plugins/delegation/`](../../opencode/plugins/delegation/) | WorkspaceManager, dynamic CategoryEngine, selective SkillResolver, TaskRegistry, SessionRunner, CompletionTracker, ParentResumeCoordinator, dispatch, and category permissions. |
| [`opencode/categories.json`](../../opencode/categories.json) | Repository-owned built-in category overrides, custom categories, and disable entries. |
| [`opencode/plugins/workspace-inspector.js`](../../opencode/plugins/workspace-inspector.js) | Read-only workspace placement and provenance evidence. |
| [`opencode/opencode.jsonc`](../../opencode/opencode.jsonc) | Public CodeGraph MCP configuration. |
| [`opencode/tests/`](../../opencode/tests/) | Deterministic discovery, policy, runtime, workspace, completion, and host tests. |
| [`scripts/links.tsv`](../../scripts/links.tsv) | Narrow canonical-to-live symlink manifest. |
| [`scripts/setup-codegraph.sh`](../../scripts/setup-codegraph.sh), [`scripts/check-codegraph.sh`](../../scripts/check-codegraph.sh) | Independent CodeGraph setup and health. |
| [`scripts/setup-ego-browser.sh`](../../scripts/setup-ego-browser.sh), [`scripts/check-ego-browser.sh`](../../scripts/check-ego-browser.sh) | Current external browser backend setup and health. |
