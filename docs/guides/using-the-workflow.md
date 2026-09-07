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

standalone real-browser goal
  -> /ego -> Ego Browser -> external ego-browser runtime -> ego lite Task Space
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
| A website or authenticated web application requires real interaction, extraction, screenshots, or browser QA | `/ego <task>` | You want code changes or any stage of the OpenSpec/OMO implementation workflows. |

## What each route produces

### Custom OpenSpec route

`/spec` is product-contract work. Strategist resolves an **APPROVED** strategy, checks workspace placement before writing, and creates the proposal and behavioral delta specs. It stops before engineering design, task planning, or implementation.

`/plan` is engineering-planning work. Planner reads the current contract and repository, writes only `design.md` and `tasks.md`, and requests an independent Plan Reviewer verdict. `[APPROVED]` is the normal handoff to `/execute`; `[REJECTED]` means planning must be corrected or product intent clarified.

`/execute` is controlled implementation. Executor requests a new Plan Reviewer review every time, establishes the actual workspace and baseline, delegates code changes through the workflow-owned Delegation Runtime, and owns task-checkbox transitions. Independent ready tasks may use separate managed workspaces; category-selected implementation always routes to the reusable Implementer. Executor finishes with a whole-change review and hands off to `/verify`; it does not self-verify or ship.

`/verify` independently binds evidence to the current workspace, artifacts, diff, and fresh checks. Its only outcomes are `VERIFIED`, `VERIFIED_WITH_CONCERNS`, or `BLOCKED`. `VERIFIED` directly authorizes shipping. `VERIFIED_WITH_CONCERNS` can authorize shipping only when the user explicitly accepts its exact current named concerns; that does not change the verdict or erase concerns. `BLOCKED` requires repair or evidence and cannot be bypassed. Verification and concern acceptance both become stale after a relevant code, artifact, base, branch/worktree, comparison-basis, or diff change.

`/ship` is deliberately user-owned. It reruns verification before offering exactly: merge locally, push + PR, or keep branch. Archiving or syncing OpenSpec mutates artifacts, so it requires another fresh verification before merge or push.

### Native OMO route

`/omo` sends an approved neutral strategy to OMO's native Prometheus planner. It creates native `.omo/plans/` state and follows OMO's Momus review gate; it does **not** create or read OpenSpec artifacts and does not start implementation. Keep this route separate from the custom lifecycle.

### Ego Browser route

`/ego` sends one standalone browser goal directly to the primary-only Ego Browser agent. That agent loads the externally installed official `ego-browser` skill, creates or reuses one short, goal-named ego-lite Task Space, performs coherent browser actions, verifies resulting state, and keeps the completed Space available by default with only useful final tabs. Same-goal follow-ups reuse that Space. Ask it to close or clean up the Space when you want the explicit close behavior instead.

This route does **not** enter OpenSpec, mutate implementation progress, use OMO categories, use CodeGraph, or edit repository source. Existing coding agents do not receive `ego-browser` access in Phase 1. If login, CAPTCHA, MFA, payment/security confirmation, or another manual step is required, Ego Browser hands control to the user and resumes only after explicit confirmation.

To watch browser work, open ego lite, click **Space** in the upper-right, and select the human-readable Space name reported by `/ego`. Passive observation does not require handoff. A blue glow marks a Space where the agent is active. If you take over the page, automation stops at the ownership boundary and resumes only after you explicitly confirm that control can return. At completion, `/ego` reports the retained Space name and id so you can inspect it later. The official [Space guide](https://lite.ego.app/document/en/docs/space) explains the browser's Space panel.

Typical requests include:

- `/ego inspect my GitHub notifications and summarize the unread items` — leaves the useful notification tabs in the named Space for review.
- `/ego run browser QA on the checkout flow and keep the evidence visible` — retains the final tested state and evidence tabs.
- `/ego verify the title on example.com, then close the Space` — explicitly closes the test Space after verification.
- `/ego open the account page; hand it to me if login is required` — stops for login or takeover and waits for explicit confirmation before resuming.

Before first use on a machine, run the opt-in `./scripts/setup-ego-browser.sh`, complete ego lite's GUI onboarding, and confirm `./scripts/check-ego-browser.sh` reports `READY`. The official skill and app remain external machine dependencies; neither is installed by `scripts/install.sh` or required by `scripts/verify.sh`. Ensure `~/.local/bin` is visible to the OpenCode process and restart OpenCode after setup.

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

### Parallel workspace execution

Executor uses `workspace_prepare` to create a standard linked Git worktree from a captured base SHA. The returned `workspace_id` is the only normal handle for later mutation: the runtime validates its canonical directory, branch, repository identity, and Git common directory before dispatch or release.

`delegate_task(category=...)` creates an OpenCode child session directly in that validated directory through the stock public SDK. `quick`, `standard`, `deep`, and other implementation categories select execution profiles but all route to Implementer. `delegate_task(agent="Reviewer")` and `delegate_task(agent="QA")` bind those read-only specialists to the same workspace.

Background tasks launched by one Executor assistant turn share a completion group derived from the parent session and message IDs. The first child to finish is stored without waking Executor. When the parent is idle and every group member is terminal, one compact completion notice resumes it; detailed evidence stays behind `task_output`.

Executor reviews the real workspace diff and evidence, controls any commit/integration, runs combined checks, and only then checks `tasks.md`. Failed, cancelled, interrupted, dirty, unintegrated, or provenance-mismatched workspaces are preserved. `workspace_release` performs only normal worktree removal and safe branch deletion after all safety checks pass.

## Use evidence efficiently

- Start with product intent for Strategist, then let Planner derive technical sequencing from the approved contract and current repository.
- Use CodeGraph when a structural question matters: dependencies, callers/consumers, blast radius, task topology, or candidate verification surfaces. It is derived structural evidence, not compiler, runtime, test, diff, or product-contract truth.
- Prefer exact source, LSP, Git diff, tests, and runtime checks when the question is semantic, behavioral, or about the actual mutation. CodeGraph falls back immediately when its index is unavailable, stale, pending, ambiguous, or insufficient.
- Keep review and verification independent. Reviewer examines a focused implementation package; Verifier proves the current change against its full contract. Neither repairs its own findings.
- Do not treat an old approval as permanent. `/execute`, `/verify`, and `/ship` each inspect current state, and archive/sync or integration-related mutations invalidate earlier evidence.
- Keep stock OMO native state separate from Delegation Runtime task/workspace provenance and from OpenSpec `tasks.md`.
- Do not benchmark routine edits. Benchmark only when a change may alter retrieval, context economics, model/tool policy, role boundaries, CodeGraph usage, orchestration, or correctness/coverage trade-offs. See [MAINTAINING.md](../../MAINTAINING.md#when-benchmarking-is-justified).

## Before `/ship`

Know which outcome you want, but wait for the command's explicit choice:

1. **merge locally** — integrates into the confirmed base, then verifies the merged result;
2. **push + PR** — pushes/creates a PR only after selection and preserves the worktree for CI or review fixes;
3. **keep branch** — preserves branch and worktree.

The workflow never infers push, PR, deploy, archive, merge, cleanup, or concern acceptance intent. Archive/sync mutates OpenSpec artifacts, so it makes both prior verification and any concern acceptance stale; `/ship` obtains a new Verifier verdict and, if needed, new explicit acceptance of the new named concerns.
