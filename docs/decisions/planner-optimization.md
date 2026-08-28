# Planner optimization decision

## Decision

`RETAIN_CURRENT_PRODUCTION_PLANNER`

`STOP_PLANNER_PROMPT_OPTIMIZATION`

The current production Planner remains canonical. Planner V1, V2, V3, and V4 were experiments and are not active production configurations.

## Rationale

CodeGraph integration was effective overall, but Planner-specific experiments exposed a recurring efficiency-versus-coverage trade-off. Tightened variants reduced retrieval or token cost while losing relevant coverage; stronger coverage variants gave back the efficiency gains.

The final two-repository Planner-to-Plan-Reviewer benchmark tested the reviewed pipeline on `ego-lite` and `codegraph`. V4 improved one side of the trade-off in each repository, but it did not generalize safely: reviewed coverage regressed on CodeGraph, Plan Reviewer did not reliably recover the omissions, and aggregate pipeline cost did not establish a superior production result.

Therefore:

- the current production Planner and Plan Reviewer remain in place;
- Executor and Reviewer keep their CodeGraph-first structural-evidence policy;
- Verifier retains supporting CodeGraph use;
- Strategist, Researcher, Validator, and QA receive no rollout;
- the only custom CodeGraph tool remains `codegraph_codegraph_explore`;
- no Planner V5 or further cosmetic tightening is authorized.

The frozen production hashes are:

- Planner: `7824a471a233b29ca97ff632dcf9948db9b79d2bbf021b8b365d58e4cc8a10d0`
- Plan Reviewer: `80a33ef1dd75e7a43586182f524e7f8d63887efc56a668ee324f39f97a7c3281`
- Executor: `7e65076fd1b7ddd22e4095ddbb41a3645b8d43c52c811d16f9c0edc56e3aae65`
- Reviewer: `82ff6503ed4c6fcc2d312f3c8cd6b0c128c8a3220cf2713ea9d7fb35f0ae1c6a`

## Revisit criteria

Reopen this decision only with a new, falsifiable hypothesis and new evidence—for example repeated production coverage failures, unacceptable operational context cost, a material model or CodeGraph change, or a genuinely different retrieval mechanism. Do not resume V1-V4 prompt tweaking.

If cost is revisited, study context economics and information value: which evidence changes the plan, which evidence Plan Reviewer uses, and which retrieval classes dominate cost or critical-surface discovery.

This record is an engineering decision, not runtime state. `tasks.md` remains the only durable custom execution-progress state.
