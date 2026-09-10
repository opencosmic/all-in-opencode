# Agents and commands

## Primary roles

| Agent | Responsibility | Mutation boundary |
|---|---|---|
| Assistant | Ordinary questions, investigation, bounded work, and routing | Small direct edits or delegated implementation; no implicit OpenSpec state |
| Browser | Direct browser navigation, interaction, visual inspection, and Task Spaces | Browser backend only; no application or workflow-file mutation |
| Producer | HyperFrames-backed video creation, editing, animation, preview, and rendering | Active-project artifacts; no Git/history or workflow-runtime ownership |
| Strategist | Product WHAT, WHY, WHO, behavior, and scope | Product strategy, proposal, and specs only |
| Planner | Engineering HOW and executable tasks | Active change's `design.md` and `tasks.md` only |
| Executor | Implementation orchestration, review, integration, task transitions | `tasks.md`; code changes occur through workers |
| Verifier | Independent final proof | Read-only |

## Specialists

Explorer, Librarian, Technical Advisor, Plan Reviewer, Researcher, Validator, Reviewer, and QA are read-only. Technical Advisor has no approval authority. Plan Reviewer is the independent `[APPROVED]` / `[REJECTED]` gate. Named delegation accepts only this exact allowlist.

Implementer executes one bounded category assignment through one shared contract. Category `prompt_append` supplies domain behavior and completion expectations; hard category permissions supply Git, browser, and video boundaries. It cannot create workspaces, delegate implementation, mutate OpenSpec state, ship, or own global integration. It may use `consult_agent` only for bounded information from Explorer or Librarian; those children remain read-only and cannot recurse. Ordinary Implementers cannot commit, merge, rebase, reset, clean, switch, modify worktrees, stash, mutate branches/tags, or push. The exact `git` category receives only the public-hook permission needed for its explicit bounded operation, and `video-analysis` can run only an explicitly selected upstream `watch` skill.

## Commands

| Command | Agent | Result |
|---|---|---|
| `/spec <strategy>` | Strategist | Proposal and behavioral delta specs |
| `/plan <change>` | Planner | Design, task graph, and Plan Reviewer verdict |
| `/execute <change>` | Executor | Reviewed, integrated, tested implementation |
| `/verify <change>` | Verifier | Independent verification verdict |
| `/ship <change>` | Executor | Explicitly selected integration/archive action |
| `/browser <goal>` | Browser | Standalone browser workflow through the external browser backend |
| `/video <goal>` | Producer | Standalone HyperFrames video-production workflow |

Ordinary Assistant work needs no dedicated command. Video production deliberately does not use a `video-production` CategoryEngine category: HyperFrames' upstream router and review gates are interactive orchestration, not a bounded `Implementer` profile.
