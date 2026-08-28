---
description: Route an approved product strategy to native OMO Prometheus planning
agent: Prometheus - Plan Builder
subtask: false
---

This is the native product-strategy → OMO engineering-planning handoff. Do not use OpenSpec in this route and do not start implementation.

Strategy argument:

`$ARGUMENTS`

Resolve exactly one approved strategy:

1. If an argument is supplied, read that path. Accept canonical `.product/strategy/*.md` and legacy `.omo/strategy/*.md`; reject unrelated files unless the user explicitly confirms they are equivalent product contracts.
2. If no argument is supplied, inspect `.product/strategy/` and legacy `.omo/strategy/`. Select automatically only when exactly one APPROVED strategy is unambiguous; otherwise ask which strategy to use and stop.
3. If Status is not APPROVED, stop and return the artifact to Strategist. Do not plan around unresolved product fundamentals.

Treat locked decisions, approved scope, out-of-scope decisions, product principles, required behavior, design direction, and product success criteria as authoritative product input. Challenge them only when repository or technical evidence proves the strategy impossible, internally contradictory, destructive without approval, or subject to a serious engineering constraint. Surface that blocker instead of silently redefining product intent.

Your responsibility now begins at native OMO engineering planning. Load and follow the current upstream `ulw-plan` skill exactly. Explore the repository and determine HOW: architecture, files, dependencies, sequence, migrations, engineering risks, tests, rollout, and verification. Create the normal complete Prometheus plan under `.omo/plans/` and use the normal Momus review gate.

Do not create or read OpenSpec artifacts merely because OpenSpec is installed. Do not create a thin manifest. Do not modify application code. Do not invoke Atlas or implementation workers.

Finish with the native `.omo/plans/<slug>.md` path, Momus verdict when available, and the native handoff `/ulw-execute <slug>` (or `/start-work <slug>` where that is the active OMO command). Do not invoke execution automatically.
