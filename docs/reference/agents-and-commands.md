# Agents and commands

The files under [`opencode/agents/`](../../opencode/agents/) and [`opencode/commands/`](../../opencode/commands/) are canonical for current behavior. This is a reader's reference, not a second policy definition.

## Agents

| Agent | Role and stage | May author / mutate | Must not mutate | CodeGraph |
|---|---|---|---|---|
| Strategist | Product discovery, strategy, `/spec` | Strategy, proposal, behavioral specs | Engineering design, tasks, code, native OMO state | No rollout |
| Researcher | Evidence for Strategist | Nothing; returns research | Files, decisions, delegation | No rollout |
| Validator | Adversarial product validation | Nothing; returns disposition | Files, decisions, delegation | No rollout |
| Planner | `/plan` engineering design | One change's `design.md`, `tasks.md` | Product contract, code, task completion, OMO state | `explore` only |
| Plan Reviewer | Independent plan gate | Nothing | Repairs, delegation, state | `explore` only |
| Executor | `/execute` orchestration | Active change's `tasks.md` checkboxes | Application code directly, native OMO state, alternate state | `explore` only |
| Reviewer | Focused implementation review | Nothing | Repairs, task state, delegation | `explore` only |
| QA | Runtime/user-facing evidence | Nothing | Repairs, task state, delivery | No rollout |
| Verifier | `/verify` and shipping gate | Nothing | Repairs, task state, archive, delivery | `explore` only |
| Ego Browser | Standalone `/ego` browser automation | Browser state within the requested Task Space | Repository files, coding workflow state, delegation, out-of-scope remote actions | No rollout |

### Delegation and independence

- Strategist may use Researcher and Validator for bounded evidence, while retaining product decisions.
- Planner may consult only Plan Reviewer, Explore, Librarian, and Oracle. The [planner delegation guard](../../opencode/plugins/planner-delegation-guard.js) blocks category implementation workers and all continuation shapes.
- Executor delegates application changes to fresh OMO category workers. When its exact runtime and task-independence gates pass, it may create current-wave lane worktrees, bind workers with the task API `directory`, integrate accepted lane commits in task order, and remove only proven-owned clean lanes. It requests Reviewer and applicable QA evidence; those roles report findings and never repair them.
- Verifier independently assesses current artifacts, diff, and fresh evidence. A prior approval, worker claim, or previous verifier message is not durable authority.
- Ego Browser is a primary-only route. Existing coding agents do not delegate to it, and it cannot invoke task or OMO workers.

## Commands

| Command | Main role | Preconditions | Output / state | Stop or rejection | Normal next step |
|---|---|---|---|---|---|
| `/spec <strategy>` | Strategist | One approved strategy and an intended project workspace | Proposal and `specs/**`; reports placement | Ambiguous/unapproved strategy, unresolved product question, unsafe worktree placement, invalid contract | `/plan <change>` |
| `/plan <change>` | Planner | One complete, valid proposal/spec contract | `design.md`, unchecked `tasks.md`, Plan Reviewer verdict | Product blocker or fresh Plan Reviewer `[REJECTED]` | `/execute <change>` only after `[APPROVED]` |
| `/execute <change>` | Executor | Canonical change artifacts and a fresh `[APPROVED]` Plan Reviewer verdict | Implemented work, evidence, canonical task transitions, review/QA results; capability-approved waves may use Executor-owned lane worktrees | Fresh plan rejection, topology/runtime ambiguity, baseline ambiguity, unresolved evidence, lane conflict or failed combined checks | `/verify <change>` |
| `/verify <change>` | Verifier | Explicit or unambiguous implemented change and current comparison basis | `VERIFIED`, `VERIFIED_WITH_CONCERNS`, or `BLOCKED` | Missing essential evidence/context or contradicted contract | `VERIFIED` directly authorizes shipping; concerns require explicit current acceptance; blocked cannot proceed |
| `/ship <change>` | Executor + fresh Verifier | Current artifacts, tree, and fresh Verifier outcome | Explicit choice after shipping authorization: merge locally, push + PR, keep branch | `VERIFIED_WITH_CONCERNS` requires explicit acceptance of exact current named concerns; `BLOCKED` stops | User-selected delivery action after the applicable authorization gate |
| `/omo <strategy>` | OMO Prometheus | One approved product strategy | Native `.omo/plans/<slug>.md` and Momus outcome | Ambiguous/unapproved strategy or product impossibility | Native `/ulw-execute` or `/start-work` handoff |
| `/ego <task>` | Ego Browser | Official external `ego-browser` skill/runtime available when browser execution begins | Verified browser result plus a goal-named Space retained by default with useful final tabs; an explicit cleanup request closes it | Runtime unavailable, user-owned control, required manual step, or unverified result | Inspect the reported Space, continue the same goal, or wait for explicit user confirmation |

## Evidence roles

`codegraph_codegraph_explore` is exposed only to Planner, Plan Reviewer, Executor, Reviewer, and Verifier. It is current structural/index evidence, never an implementation, diff, compiler, test, runtime, or product-contract authority. All enabled roles fall back without retry loops when it is absent, stale, pending, ambiguous, or insufficient.

For the rationale and validated scope, read [CodeGraph integration research](../research/codegraph-integration.md). For hard boundaries, read [invariants](invariants.md).

Ego Browser receives only the `ego-browser` skill, the `ego-browser *` shell surface, and the question tool for user handoff. All other skills and generic shell commands are denied; edit/write, task delegation, OMO delegation, external-directory access, and CodeGraph access are denied. The Node.js runtime remains a behavioral escape risk rather than a hard OS sandbox, as described in [architecture](../architecture.md#independent-browser-route).

The user can passively observe an active `/ego` run by opening ego lite, choosing **Space** in the upper-right, and selecting the reported human-readable Space; observation alone does not transfer control. A real takeover, login, or other manual interaction stops automation until the user explicitly confirms it may resume. Once verified, `/ego` closes scratch tabs and retains the completed Space by default, reporting its name and id. An explicit request to close or clean up the Space selects the destructive `keep: false` completion path instead.
