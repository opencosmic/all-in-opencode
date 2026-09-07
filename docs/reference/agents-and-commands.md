# Agents and commands

## Agents

| Agent | Responsibility | Mutation boundary |
|---|---|---|
| Strategist | Product intent and OpenSpec product contract | Strategy, proposal, specs only |
| Researcher / Validator | Product evidence and adversarial validation | Read-only |
| Planner | Engineering design and executable tasks | `design.md`, unchecked `tasks.md` only |
| Plan Reviewer | Independent planning gate | Read-only |
| Executor | Delegation, review sequencing, integration, task transitions | Task checkboxes; no direct application edits |
| Implementer | One scoped implementation assignment | Assigned workspace application/source/test/config only |
| Reviewer | Diff-first code review in the assigned workspace | Read-only |
| QA | Runtime/user-facing verification in the assigned workspace | Read-only |
| Verifier | Independent final proof | Read-only |
| Ego Browser | Standalone browser automation | Browser Task Space only |

Executor uses the workflow-owned `delegate_task` primitive for implementation and workspace-local Reviewer/QA work. Stock OMO remains available only for unrelated existing routes. Implementer is deliberately non-recursive and cannot create workspaces or delegate. Its resolved shell policy permits ordinary builds/tests and read-only Git inspection while denying commit, merge, rebase, reset, clean, switch/checkout, worktree, stash, branch mutation, tag mutation, and push operations.

## Commands

| Command | Owner | Result |
|---|---|---|
| `/spec <strategy>` | Strategist | Proposal and behavioral specs |
| `/plan <change>` | Planner | Design, unchecked tasks, fresh Plan Reviewer verdict |
| `/execute <change>` | Executor | Delegated implementation, review/QA evidence, controlled integration, task transitions |
| `/verify <change>` | Verifier | `VERIFIED`, `VERIFIED_WITH_CONCERNS`, or `BLOCKED` |
| `/ship <change>` | Executor + fresh Verifier | Explicit merge, push/PR, or keep-branch choice |
| `/omo <strategy>` | Stock OMO | Native OMO planning route |
| `/ego <task>` | Ego Browser | Verified browser result and retained Task Space |

See [architecture](../architecture.md) for the runtime lifecycle and [invariants](invariants.md) for hard boundaries.
