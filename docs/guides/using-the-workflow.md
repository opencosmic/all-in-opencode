# Using the workflow

This is the daily operating guide for the custom OpenCode workflow. It describes the current command definitions; for the authoritative command source, see the [command files](../reference/agents-and-commands.md#commands).

## Choose a route

```text
new or unclear product direction
  -> Strategist -> approved product strategy
       -> /spec for the custom OpenSpec lifecycle
       -> /omo for native OMO planning

approved OpenSpec proposal + behavioral specs
  -> /plan -> reviewed design.md + tasks.md
  -> /execute -> implemented, reviewed, and QA-evidenced change
  -> /verify -> independent current-state verdict
  -> /ship -> user chooses integration
```

| Situation | Use | Do not use it when |
|---|---|---|
| The product problem, customer, scope, or success criteria are not settled | Strategist, then an approved strategy | You already have an approved OpenSpec change ready for engineering planning. |
| An approved strategy should become a behavioral contract in the target repository | `/spec <strategy>` | You want OMO's native planning route instead of OpenSpec. |
| A complete, valid OpenSpec proposal and specs need engineering design and tasks | `/plan <change>` | Product fundamentals are still open or you want implementation to begin. |
| A freshly approved task list needs implementation | `/execute <change>` | The Plan Reviewer rejects the current plan, or there is no canonical change workspace. |
| The implemented change needs independent proof | `/verify <change>` | You expect it to repair, archive, or integrate the change. |
| A freshly verified change is ready for an explicit delivery decision | `/ship <change>` | You want automatic merge, push, archive, or cleanup. |
| An approved strategy should go to native OMO Prometheus planning | `/omo <strategy>` | You want the custom OpenSpec lifecycle; `/omo` does not create OpenSpec artifacts. |

## What each route produces

### Custom OpenSpec route

`/spec` is product-contract work. Strategist resolves an **APPROVED** strategy, checks workspace placement before writing, and creates the proposal and behavioral delta specs. It stops before engineering design, task planning, or implementation.

`/plan` is engineering-planning work. Planner reads the current contract and repository, writes only `design.md` and `tasks.md`, and requests an independent Plan Reviewer verdict. `[APPROVED]` is the normal handoff to `/execute`; `[REJECTED]` means planning must be corrected or product intent clarified.

`/execute` is controlled implementation. Executor requests a new Plan Reviewer review every time, establishes the actual workspace and baseline, delegates code changes to OMO workers, and owns custom task-checkbox transitions. When both runtime capability and task independence are proven, it may use sibling lane worktrees for a ready wave; otherwise it retains the existing in-place/change-worktree path. It finishes with a whole-change review and hands off to `/verify`; it does not self-verify or ship.

`/verify` independently binds evidence to the current workspace, artifacts, diff, and fresh checks. Its only outcomes are `VERIFIED`, `VERIFIED_WITH_CONCERNS`, or `BLOCKED`. `VERIFIED` directly authorizes shipping. `VERIFIED_WITH_CONCERNS` can authorize shipping only when the user explicitly accepts its exact current named concerns; that does not change the verdict or erase concerns. `BLOCKED` requires repair or evidence and cannot be bypassed. Verification and concern acceptance both become stale after a relevant code, artifact, base, branch/worktree, comparison-basis, or diff change.

`/ship` is deliberately user-owned. It reruns verification before offering exactly: merge locally, push + PR, or keep branch. Archiving or syncing OpenSpec mutates artifacts, so it requires another fresh verification before merge or push.

### Native OMO route

`/omo` sends an approved neutral strategy to OMO's native Prometheus planner. It creates native `.omo/plans/` state and follows OMO's Momus review gate; it does **not** create or read OpenSpec artifacts and does not start implementation. Keep this route separate from the custom lifecycle.

## Real operating patterns

### Substantial new feature

```text
product intent and uncertainty
  ↓ Strategist with Researcher/Validator when evidence is needed
APPROVED strategy in .product/strategy/
  ↓ /spec
proposal.md + specs/**
  ↓ /plan
design.md + tasks.md + fresh [APPROVED] Plan Reviewer verdict
  ↓ /execute
implementation, task evidence, Reviewer and applicable QA
  ↓ /verify → /ship
```

Give Strategist the user problem, target customer, desired outcome, constraints, and evidence—not an implementation recipe. The user explicitly approves consequential scope and locked decisions before the strategy becomes `APPROVED`.

### Already-approved specification

```text
one valid OpenSpec change with proposal/specs
  ↓ /plan <change>
reviewed executable design and unchecked tasks
  ↓ /execute <change>
```

Planner owns engineering how; do not force it through a missing contract or a Plan Reviewer rejection. Corrective feedback should name the rejected artifact, evidence, and desired resolution, then let the owning role revise it.

### Clearly scoped engineering change

```text
approved product contract
  ↓ /plan
small, dependency-ordered task list
  ↓ /execute
fresh implementation evidence and review
```

Small scope does not waive the current-artifact review or verification gates. It may reduce the amount of QA or breadth of testing where the change is mechanical and the source supports that judgment.

### Native OMO planning

```text
APPROVED .product/strategy/<slug>.md
  ↓ /omo <path>
native .omo/plans/<slug>.md + Momus verdict
  ↓ /ulw-execute <slug> or /start-work <slug>
```

Choose this only when you intentionally want the native OMO workflow. Do not combine its OMO state with `tasks.md` or the custom commands.

### A finding or blocker

```text
[REJECTED] Plan Reviewer → Planner repairs planning, then requests a fresh review
[CHANGES_REQUIRED] Reviewer or QA_FAIL → Executor assigns repair to an implementation worker, then re-runs evidence
BLOCKED → provide the requested missing context, authority, or observation; do not bypass the gate
```

Treat `BLOCKED` as a useful statement of what cannot currently be proven or safely decided. Supply the smallest missing input—for example, the canonical change, a target workspace, a user delivery choice, or access to an external observation—rather than asking the role to guess.

### Lane-worktree execution

`LANE_WORKTREES` is an Executor-owned execution mode, not a Planner guarantee. Executor may select it only when the exact active OpenCode/OMO runtime has adopted mechanical proof for child directory binding and the full measured isolation/completion contract, and the current ready wave has at least two tasks with no dependency, write-scope, shared-contract/schema/migration/generated-output/state/resource, or verification collision. A version number or `WORKSPACE:` prompt is not that proof. The installed production OMO 4.19.4 currently leaves the capability gate unavailable, so production lane execution remains disabled.

For an eligible wave, Executor creates one uniquely named linked worktree/branch per lane from the same canonical HEAD. Normal OMO workers receive the lane through the task API's `directory` field; OMO/OpenCode owns provider-slot queuing. Executor inspects each lane diff, obtains lane-local review and applicable QA, commits accepted task-attributable changes, and integrates them in approved task order with non-fast-forward merges. It then runs combined checks in the canonical change worktree. Only integrated tasks whose combined checks pass become checked in `tasks.md`; a correct but unintegrated lane is still incomplete.

Conflicts, cancellations, unknown mutations, and interruptions preserve the lane. Known provenance-matched OMO continuation markers are runtime bookkeeping rather than worker escape, but no other `.omo` state is ignored. Cleanup is optional: only an exact Executor-owned, integrated, clean lane with no needed unique commits may be normally removed, followed by safe branch deletion. Refused removal, dirty state, or unclear ownership is preserved. Resume uses `tasks.md` plus current Git/worktree facts rather than a custom lane ledger.

## Use evidence efficiently

- Start with product intent for Strategist, then let Planner derive technical sequencing from the approved contract and current repository.
- Use CodeGraph when a structural question matters: dependencies, callers/consumers, blast radius, task topology, or candidate verification surfaces. It is derived structural evidence, not compiler, runtime, test, diff, or product-contract truth.
- Prefer exact source, LSP, Git diff, tests, and runtime checks when the question is semantic, behavioral, or about the actual mutation. CodeGraph falls back immediately when its index is unavailable, stale, pending, ambiguous, or insufficient.
- Keep review and verification independent. Reviewer examines a focused implementation package; Verifier proves the current change against its full contract. Neither repairs its own findings.
- Do not treat an old approval as permanent. `/execute`, `/verify`, and `/ship` each inspect current state, and archive/sync or integration-related mutations invalidate earlier evidence.
- Treat OMO runtime state by provenance, not by filename exclusion. A mechanically matched `.omo/run-continuation/<known-session-id>.json` marker is runtime bookkeeping rather than a worker mutation escape; any other `.omo` mutation remains untrusted and must be preserved for investigation.
- Do not benchmark routine edits. Benchmark only when a change may alter retrieval, context economics, model/tool policy, role boundaries, CodeGraph usage, orchestration, or correctness/coverage trade-offs. See [MAINTAINING.md](../../MAINTAINING.md#when-benchmarking-is-justified).

## Before `/ship`

Know which outcome you want, but wait for the command's explicit choice:

1. **merge locally** — integrates into the confirmed base, then verifies the merged result;
2. **push + PR** — pushes/creates a PR only after selection and preserves the worktree for CI or review fixes;
3. **keep branch** — preserves branch and worktree.

The workflow never infers push, PR, deploy, archive, merge, cleanup, or concern acceptance intent. Archive/sync mutates OpenSpec artifacts, so it makes both prior verification and any concern acceptance stale; `/ship` obtains a new Verifier verdict and, if needed, new explicit acceptance of the new named concerns.
