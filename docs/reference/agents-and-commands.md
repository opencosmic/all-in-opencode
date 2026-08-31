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

### Delegation and independence

- Strategist may use Researcher and Validator for bounded evidence, while retaining product decisions.
- Planner may consult only Plan Reviewer, Explore, Librarian, and Oracle. The [planner delegation guard](../../opencode/plugins/planner-delegation-guard.js) blocks category implementation workers and all continuation shapes.
- Executor delegates application changes to fresh OMO category workers. It requests Reviewer and applicable QA evidence; those roles report findings and never repair them.
- Verifier independently assesses current artifacts, diff, and fresh evidence. A prior approval, worker claim, or previous verifier message is not durable authority.

## Commands

| Command | Main role | Preconditions | Output / state | Stop or rejection | Normal next step |
|---|---|---|---|---|---|
| `/spec <strategy>` | Strategist | One approved strategy and an intended project workspace | Proposal and `specs/**`; reports placement | Ambiguous/unapproved strategy, unresolved product question, unsafe worktree placement, invalid contract | `/plan <change>` |
| `/plan <change>` | Planner | One complete, valid proposal/spec contract | `design.md`, unchecked `tasks.md`, Plan Reviewer verdict | Product blocker or fresh Plan Reviewer `[REJECTED]` | `/execute <change>` only after `[APPROVED]` |
| `/execute <change>` | Executor | Canonical change artifacts and a fresh `[APPROVED]` Plan Reviewer verdict | Implemented work, evidence, task transitions, review/QA results | Fresh plan rejection, topology ambiguity, baseline ambiguity, unresolved evidence | `/verify <change>` |
| `/verify <change>` | Verifier | Explicit or unambiguous implemented change and current comparison basis | `VERIFIED`, `VERIFIED_WITH_CONCERNS`, or `BLOCKED` | Missing essential evidence/context or contradicted contract | `VERIFIED` directly authorizes shipping; concerns require explicit current acceptance; blocked cannot proceed |
| `/ship <change>` | Executor + fresh Verifier | Current artifacts, tree, and fresh Verifier outcome | Explicit choice after shipping authorization: merge locally, push + PR, keep branch | `VERIFIED_WITH_CONCERNS` requires explicit acceptance of exact current named concerns; `BLOCKED` stops | User-selected delivery action after the applicable authorization gate |
| `/omo <strategy>` | OMO Prometheus | One approved product strategy | Native `.omo/plans/<slug>.md` and Momus outcome | Ambiguous/unapproved strategy or product impossibility | Native `/ulw-execute` or `/start-work` handoff |

## Evidence roles

`codegraph_codegraph_explore` is exposed only to Planner, Plan Reviewer, Executor, Reviewer, and Verifier. It is current structural/index evidence, never an implementation, diff, compiler, test, runtime, or product-contract authority. All enabled roles fall back without retry loops when it is absent, stale, pending, ambiguous, or insufficient.

For the rationale and validated scope, read [CodeGraph integration research](../research/codegraph-integration.md). For hard boundaries, read [invariants](invariants.md).
