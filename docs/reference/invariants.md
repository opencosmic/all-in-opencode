# Invariants

| Invariant | Enforcement |
|---|---|
| Runtime code uses stock public OpenCode plugin and SDK APIs only. | Static dependency guard and loader test |
| Nine project-owned delegation tools are exposed, including the Executor-only `execution_preflight`, bounded `workspace_checkpoint_update`, and restricted `consult_agents` facades. | Plugin and runtime policy tests |
| Category selection is deterministic and implementation categories route to Implementer. | CategoryEngine tests |
| Named delegation accepts only project-owned read-only specialists. | AgentDispatcher tests |
| `consult_agents` is Implementer-only, accepts only bounded Explorer/Librarian requests, waits for all outcomes in input order, and consultation children cannot recurse. | Consultation runtime, profile, and effective-agent permission tests |
| Ordinary Implementers cannot mutate Git topology or history. | Effective-agent permission test |
| Git, browser, and video capabilities are scoped to sessions launched through their exact categories; video additionally requires the explicitly selected `watch` skill. | Category permission tests |
| Workspace identity is provenance-bound; release proves ancestry or patch equivalence and never forces cleanup. | WorkspaceManager tests |
| Background completion is durable and resumes an eligible parent once per terminal group. | Completion and host integration tests |
| Missing parent status is resumable only with a current-process idle witness. | Parent resume tests |
| OpenSpec `tasks.md` is the only durable formal-workflow progress source. | Prompt and command policy tests |
| Executor performs a mandatory current-state execution preflight before topology or implementation delegation. | Execution preflight and Executor policy tests |
| Planner task boundaries do not imply agent, branch, or worktree boundaries; one logical change reuses one primary workspace by default. | Change-centric workspace resolver tests |
| Workspace descriptions and one latest checkpoint are local advisory manifest metadata; they cannot override identity, ownership, Git facts, or workflow gates. | Workspace context, runtime ownership, and preflight tests |
| Checkpoints are bounded, overwrite-only, carry runtime-derived HEAD/timestamp, report simple HEAD freshness, and do not create history, event logs, or alternate durable workflow state. | Workspace context tests |
| Protected base branches such as `main` and `master` are never normal Executor implementation or Git-mutation targets. | Executor runtime and Git permission tests |
| Child worktrees require a concrete isolation reason and integrate into the primary change branch, never directly into the protected base. | Child workspace and cleanup tests |
| Technical Advisor advises and Plan Reviewer independently approves or rejects. | Agent policy tests |
| CodeGraph is a direct public MCP integration and only structural evidence. | Config and role-policy tests |
| Browser has a dedicated `/browser` route and Assistant's backend-neutral `browser-automation` route; both retain the external browser backend boundary. | Browser agent and category tests |
| Blender has a dedicated `/blender` primary route backed by external Blender MCP; it is not a CategoryEngine category and uses an explicit five-tool MCP allowlist. | Blender agent, provisioning, and discovery tests |
| Video production has a dedicated `Producer` + `/video` primary route backed by the external upstream HyperFrames skill family; it is not a CategoryEngine category. | Producer-agent, command, and provisioning tests |
| Video-content questions remain separate: `video-analysis` uses the independent upstream `watch` skill, while `/video` owns HyperFrames production. | Producer-agent and existing watch/category tests |
| `/video` never silently updates global HyperFrames skills without approval; setup is explicit and the health check is read-only. | Producer-agent and HyperFrames provisioning tests |
| Searcher is a read-only primary `/search` route using bounded native web retrieval, with no delegation or Deep Research infrastructure. | Searcher integration and discovery tests |
| Professor is a separate read-only primary `/research` route; ResearchState owns IDs, frontier ordering, evidence, contradictions, verification, persistence, and reports while native web retrieval remains direct. | Professor agent, runtime, plugin, persistence, and command tests |
| Video-content questions route to `video-analysis` plus the independent upstream `watch` skill; no video-production capability is included. | Video category, routing, and provisioning tests |
| OpenDesign is optional read-only design context: only an Implementer in `visual-engineering` plus selected `open-design` may execute generic MCP resource operations for the exact `open-design` server; raw sanitized OpenDesign tools remain denied and the current worktree remains authoritative. | OpenDesign integration and permission-boundary tests |
| The retired alternate runtime, config, command, agents, and continuation tools are absent. | Zero-dependency policy test |
