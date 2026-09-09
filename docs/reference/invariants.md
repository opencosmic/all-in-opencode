# Invariants

| Invariant | Enforcement |
|---|---|
| Runtime code uses stock public OpenCode plugin and SDK APIs only. | Static dependency guard and loader test |
| Exactly six workflow-owned delegation tools are exposed. | Plugin test |
| Category selection is deterministic and implementation categories route to Implementer. | CategoryEngine tests |
| Named delegation accepts only project-owned read-only specialists. | AgentDispatcher tests |
| Ordinary Implementers cannot mutate Git topology or history. | Effective-agent permission test |
| `git` and `browser-automation` capability is scoped to sessions launched through those exact categories. | Category permission tests |
| Workspace identity is provenance-bound; release proves ancestry or patch equivalence and never forces cleanup. | WorkspaceManager tests |
| Background completion is durable and resumes an eligible parent once per terminal group. | Completion and host integration tests |
| Missing parent status is resumable only with a current-process idle witness. | Parent resume tests |
| OpenSpec `tasks.md` is the only durable formal-workflow progress source. | Prompt and command policy tests |
| Technical Advisor advises and Plan Reviewer independently approves or rejects. | Agent policy tests |
| CodeGraph is a direct public MCP integration and only structural evidence. | Config and role-policy tests |
| Browser has a dedicated `/browser` route and Assistant's backend-neutral `browser-automation` route; both retain the external browser backend boundary. | Browser agent and category tests |
| The retired alternate runtime, config, command, agents, and continuation tools are absent. | Zero-dependency policy test |
