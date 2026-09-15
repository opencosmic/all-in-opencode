## 1. Baseline and OpenSpec artifacts

- [x] 1.1 Freeze the exact B1b–B4b blind Professor V1 runs in `benchmarks/professor-quality/results/` and verify the records preserve state-derived metrics, reports, and the B4b timeout evidence
- [x] 1.2 Create and strictly validate the standard `professor-v1-1-research-correctness` OpenSpec proposal/spec artifacts with `openspec validate ... --strict --no-interactive --json`

## 2. ResearchState budget and lifecycle contract

- [x] 2.1 Add a conservative closure-aware controller budget derived from the Professor outer-step contract, normalize older budgets, expose remaining capacity, and verify with default/custom/near-boundary runtime tests
- [x] 2.2 Add the auditable `superseded` task lifecycle, counters, timestamps/reasons, state validation, frontier sweep, and events; verify pending sufficient-question tasks are skipped and excluded from gaps
- [x] 2.3 Tighten `research_commit` canonical-result gating and explicit failed/already-sufficient paths; verify meaningful completion, empty rejection, failure, and supersession behavior

## 3. Evidence and completion correctness

- [x] 3.1 Strengthen evidence validation and bounded state projections for source identity, canonical citation, fact, supporting span/context, and claim-bound evidence; verify regression fixtures for merged/missing/mismatched evidence shapes
- [x] 3.2 Add deterministic supported/partial/unsupported/contradicted claim counts and honest reportable uncertainty metrics with backward-compatible defaults; verify all verdicts and older state loading

## 4. Professor contract, benchmark, and integration verification

- [x] 4.1 Update the Professor prompt and public tool descriptions for closure capacity, selective retrieval, atomic evidence, superseded work, failure semantics, and claim accounting; verify deny-by-default/native-retrieval policy tests
- [x] 4.2 Update Professor runtime/plugin tests and benchmark harness tests for every changed behavior; verify focused Professor tests and the benchmark harness pass
- [x] 4.3 Run the affected deterministic project suite, OpenSpec validation, and repository verification where the environment supports it; record any user-level configuration limitation without claiming it as a source failure
- [ ] 4.4 Rerun B1–B7 and B1b–B4b with unchanged prompts, analyze before/after metrics, and verify B6 bounded completion and B7 absence of zero-value actionable tasks before final branch review (B6 remains intermittent under the fixed benchmark model and needs a successful final regression run)
