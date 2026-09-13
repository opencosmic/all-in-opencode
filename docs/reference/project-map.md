# Project map

| Path | Purpose |
|---|---|
| [`opencode/agents/`](../../opencode/agents/) | Assistant, Browser, Blender, Producer, Searcher, Professor, formal lifecycle roles, specialists, and Implementer. |
| [`opencode/commands/`](../../opencode/commands/) | `/spec`, `/plan`, `/execute`, `/verify`, `/ship`, `/browser`, `/blender`, `/video`, `/search`, and `/research`. |
| [`opencode/plugins/delegation-runtime.js`](../../opencode/plugins/delegation-runtime.js) | Loader-safe Delegation Runtime entrypoint. |
| [`opencode/plugins/delegation/`](../../opencode/plugins/delegation/) | WorkspaceManager, dynamic CategoryEngine, selective SkillResolver, TaskRegistry, SessionRunner, CompletionTracker, ParentResumeCoordinator, dispatch, and category permissions. |
| [`opencode/plugins/workspace-inspector.js`](../../opencode/plugins/workspace-inspector.js) | Read-only workspace placement and provenance evidence. |
| [`opencode/plugins/professor-runtime.js`](../../opencode/plugins/professor-runtime.js) | Default-only stateful Deep Research tool entrypoint. |
| [`opencode/plugins/professor/`](../../opencode/plugins/professor/) | Deterministic ResearchState, persistence, frontier, evidence, verification, and report runtime. |
| [`opencode/opencode.jsonc`](../../opencode/opencode.jsonc) | Public CodeGraph MCP configuration plus the bounded OpenDesign MCP launcher and raw-tool deny ceiling. |
| [`opencode/skills/open-design/`](../../opencode/skills/open-design/) | Repository-owned optional OpenDesign resource capability instructions. |
| [`opencode/open-design-mcp.sh`](../../opencode/open-design-mcp.sh), [`scripts/lib/run-open-design-mcp.mjs`](../../scripts/lib/run-open-design-mcp.mjs) | Runtime launcher that consumes the validated user-local upstream launch spec; CLI identity discovery remains setup-only. |
| [`opencode/tests/`](../../opencode/tests/) | Deterministic discovery, policy, runtime, workspace, completion, and host tests. |
| [`scripts/links.tsv`](../../scripts/links.tsv) | Narrow canonical-to-live symlink manifest. |
| [`scripts/setup-codegraph.sh`](../../scripts/setup-codegraph.sh), [`scripts/check-codegraph.sh`](../../scripts/check-codegraph.sh) | Independent CodeGraph setup and health. |
| [`scripts/setup-ego-browser.sh`](../../scripts/setup-ego-browser.sh), [`scripts/check-ego-browser.sh`](../../scripts/check-ego-browser.sh) | Current external browser backend setup and health. |
| [`scripts/setup-blender-mcp.sh`](../../scripts/setup-blender-mcp.sh), [`scripts/check-blender-mcp.sh`](../../scripts/check-blender-mcp.sh) | External Blender MCP addon setup and read-only configuration health. |
| [`scripts/setup-watch.sh`](../../scripts/setup-watch.sh), [`scripts/check-watch.sh`](../../scripts/check-watch.sh) | Upstream `claude-video` watch skill provisioning and bundled-runtime health. |
| [`scripts/setup-hyperframes.sh`](../../scripts/setup-hyperframes.sh), [`scripts/check-hyperframes.sh`](../../scripts/check-hyperframes.sh) | External HyperFrames core-skill provisioning and Node/FFmpeg/OpenCode-discovery health. |
| [`scripts/setup-open-design.sh`](../../scripts/setup-open-design.sh), [`scripts/check-open-design.sh`](../../scripts/check-open-design.sh), [`scripts/lib/write-open-design-spec.mjs`](../../scripts/lib/write-open-design-spec.mjs) | Explicit OpenDesign prerequisite setup, atomic user-local launch-spec provisioning, and headless MCP/resource health. |
