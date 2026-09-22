# Agents and commands

## Primary roles

| Agent | Responsibility | Mutation boundary |
|---|---|---|
| Assistant | Ordinary questions, investigation, bounded work, and routing | Small direct edits or delegated implementation; no implicit OpenSpec state |
| Browser | Direct browser navigation, interaction, visual inspection, and Task Spaces | Browser backend only; no application or workflow-file mutation |
| Blender | Reusable 3D leaf for Blender scene/artifact inspection, authoring, previs, rendering, and visual verification through Blender MCP | Direct `/blender` or named `Executor` route; no child AIO tasks, categories, repository, Git, OpenSpec, CategoryEngine, or Delegation Runtime ownership |
| Producer | Single video-production owner for lightweight HyperFrames and advanced `/film` orchestration | Active-project artifacts; no Git/history or workflow-runtime ownership; named Director/Creator/Editor delegation plus transitional direct media and `blender-previs` routes; named Blender denied |
| Searcher | Normal web Search / Answer Engine with grounded current answers | Read-only native web retrieval; direct or delegated leaf, no onward delegation or OpenSpec ownership |
| Professor | Stateful evidence-first Deep Research with adaptive verification | Read-only native retrieval plus Professor ResearchState tools; no filesystem, Git, delegation, or browser access |
| Strategist | Product WHAT, WHY, WHO, behavior, and scope | Product strategy, proposal, and specs only |
| Planner | Engineering HOW and executable tasks | Active change's `design.md` and `tasks.md` only |
| Executor | Execution preflight, change-workspace topology, implementation orchestration, review, integration, task transitions, recovery checkpoint context | `tasks.md` plus runtime workspace provenance; code changes occur through workers in the primary change workspace; local descriptions/checkpoints are advisory |
| Verifier | Independent final proof | Read-only |

## Video production phase owners

| Agent | Responsibility | Delegation boundary |
|---|---|---|
| Director | CreativeBrief, scene structure, provider-neutral ShotSpecs, camera and motion intent, creative previs revisions | `blender-previs`, `video-analysis` with Watch |
| Creator | Generation strategy, prompts, references, curated models and controls, generation revisions | `media-generation`, `video-analysis` with Watch; Producer owns budget and user approval |
| Editor | Timeline, graphics, captions, audio assembly, cuts, previews, renders | Official upstream HyperFrames directly, plus `video-analysis` with Watch |

All three are `mode: subagent` and report to Producer. They cannot delegate
named agents or ordinary implementation categories. Existing `/video` and
`/film` commands remain with Producer until their live workflows migrate.

## Specialists

Explorer, Librarian, Technical Advisor, Plan Reviewer, Researcher, Validator, Reviewer, QA, and Verifier are read-only. Technical Advisor has no approval authority. Plan Reviewer is the independent `[APPROVED]` / `[REJECTED]` gate. Verifier is reserved for Executor's fresh shipping-verification handoff. Named delegation uses the public OpenCode effective-agent list plus the AIO policy. A custom caller needs a `delegation` entry; a custom target must be listed in OpenCode, set to `delegatable: true` under `agents`, and listed by that caller. Unknown names fail closed, and the AIO lists do not override the Strategist/Planner/Verifier ceilings.

Implementer executes one bounded category assignment through one shared contract. Category `prompt_append` supplies domain behavior and completion expectations; hard category permissions supply Git and video boundaries, while Browser has its own dedicated primary-agent boundary. It cannot create workspaces, delegate implementation, mutate OpenSpec state, ship, or own global integration. It may use `workspace_checkpoint_update` only for its own active task/workspace session, at meaningful execution boundaries, with concise factual recovery notes. For each consultation step, it may use `consult_agents` to batch independent bounded questions for Explorer or Librarian into one synchronous call; later consultation or continuation remains allowed when genuinely needed. Those children remain read-only and cannot recurse. Ordinary Implementers cannot commit, merge, rebase, reset, clean, switch, modify worktrees, stash, mutate branches/tags, or push. The exact `git` category receives only the public-hook permission needed for its explicit bounded operation, and `video-analysis` can run only an explicitly selected upstream `watch` skill.

Executor runs `execution_preflight` before creating topology or delegating implementation. The normal shape is one logical change -> one continuing primary branch/workspace -> sequential tasks, with optional child worktrees only for concrete safe isolation/concurrency. `workspace_prepare(description=...)` explains workspace purpose, while the latest checkpoint records advisory recovery state and may be replaced when execution is re-planned. Child work integrates into the primary change workspace; `/ship` is the final normal boundary into protected `main`/`master`.

## Commands

| Command | Agent | Result |
|---|---|---|
| `/spec <strategy>` | Strategist | Proposal and behavioral delta specs |
| `/plan <change>` | Planner | Design, task graph, and Plan Reviewer verdict |
| `/execute <change>` | Executor | Reviewed, integrated, tested implementation |
| `/verify <change>` | Verifier | Independent verification verdict |
| `/ship <change>` | Executor | Explicitly selected integration/archive action |
| `/browser <goal>` | Browser | Standalone browser workflow through the external browser backend |
| `/blender <goal>` | Blender | Standalone Blender scene workflow through the external Blender MCP server and addon |
| `/video <goal>` | Producer | Lightweight standalone HyperFrames-first video-production workflow |
| `/film <goal>` | Producer | Advanced film-production-first workflow using ShotSpec, ProductionManifest, bounded routing, later HyperFrames composition, and grounded QA |
| `/search <question>` | Searcher | Bounded normal web Search / Answer Engine response with grounded citations |
| `/research <question>` | Professor | Stateful Deep Research with persistent evidence, adaptive tasks, verification, and a final report |

Ordinary Assistant work needs no dedicated command. Video production deliberately does not use a `video-production` CategoryEngine category: HyperFrames' upstream router and review gates are interactive orchestration, not a bounded `Implementer` profile.

Assistant remains the broad/general category orchestrator. Executor is capped at
the `implementation` family (including the bounded `git` category), while
Producer is temporarily capped at the `media` family plus
`blender-previs`. Director, Creator, and Editor have exact category ceilings.
These ceilings are separate from named-agent policy. Built-in family labels are canonical architecture metadata
and cannot be reclassified through `aio.json`, while custom categories may
choose their own family. Assistant may delegate `media-generation`
technically, but not `blender-previs`; `/video` and `/film` remain
Producer-owned workflows.

`/film` also deliberately does not use a `video-production` category. It loads
the repository-owned `film-production` methodology, plans `ShotSpec[]` and a
single `ProductionManifest`, then routes lightweight camera/blocking/timing
previs to `blender-previs`, reviews stills and preview video through
`video-analysis`, sends bounded Atlas media execution to `media-generation`
only after previs approval, and leaves composition and rendering to
HyperFrames. Atlas is the only implemented media provider; paid submissions
remain behind the calculate/approval boundary.

Blender is the single reusable 3D specialist. Use `/blender` directly, or let
Executor delegate Blender-native product/artifact work. Producer's `/film`
previs temporarily uses the `blender-previs` category until Director owns the
live workflow. Named Blender is denied to Producer. Blender does not delegate
child AIO tasks or receive a category catalog.
