# CodeGraph integration research

This is the knowledge record behind the current architecture policy, not a replacement for [Architecture](../architecture.md). Status labels distinguish current production fact from historical findings.

## Current production facts

- **CURRENT PRODUCTION FACT:** the custom surface exposes only `codegraph_codegraph_explore`.
- **CURRENT PRODUCTION FACT:** Planner, Plan Reviewer, Executor, Reviewer, and Verifier may use it; Strategist, Researcher, Validator, and QA do not receive it.
- **CURRENT PRODUCTION FACT:** CodeGraph is OMO-owned derived structural/index evidence. This repository neither provisions its runtime/indexes nor adds proxy tooling, durable graph state, or a second lifecycle.
- **HISTORICALLY VALIDATED VERSION:** the experiments used OMO 4.19.4 and OMO-owned CodeGraph 1.5.0. This records the validation environment; it is not a claim that every deployment must use exactly those versions.

The role permissions and fallbacks are in the [agent definitions](../../opencode/agents/). The frozen policy is summarized in [architecture](../architecture.md#codegraph).

## Evidence hierarchy

```text
OpenSpec                    -> product/behavior contract truth
CodeGraph explore           -> derived structural evidence
exact source and LSP        -> code and semantic evidence
Git diff                    -> actual mutation evidence
tests / QA / runtime checks -> behavior and runtime evidence
```

CodeGraph is useful for mapping architecture, dependencies, callers/consumers, structural blast radius, task topology, and candidate verification surfaces. It is not authoritative for compilation, actual diffs, tests, runtime behavior, external state, or product decisions. Enabled roles use it first for a current structural question and fall back immediately if it is unavailable, pending, unindexed, stale, ambiguous, or insufficient; it must not become a retry loop or blocker.

## Valid overall A/B: `20260827T165722Z`

**HISTORICALLY VALIDATED FINDING.** A corrected A/B benchmark on `ego-lite` compared the frozen production CodeGraph-first policy with a role-local control for Planner, Executor, and Reviewer. All 14 treatment explore calls succeeded; independent warm indexes had exact roots, zero pending work, and no worktree mismatch.

| Role | Structural outcome | Efficiency outcome | Historical role conclusion |
|---|---|---|---|
| Planner | Recall fell from 8/8 to 7/8; no critical miss; one required public-test relationship was omitted. | Retrieval calls fell 26→9, but total tokens rose 248,778→295,432 due to repeated graph retrieval. | `KEEP_BUT_TIGHTEN` |
| Executor | Recall rose 6/7→7/7; no critical miss; it surfaced an active-tab versus attached/preferred-session distinction. | Calls 22→10; tokens 332,801→146,179; wall time 78.949s→63.605s. | `KEEP_CODEGRAPH_FIRST` |
| Reviewer | Recall/precision/quality stayed level at 6/7, 100%, 9.5/10; no critical miss. | Calls 16→5; tokens 73,779→66,599; wall time 70.400s→51.980s. | `KEEP_CODEGRAPH_FIRST` |

Across the three roles, treatment had 62.5% fewer retrieval calls (64→24), 22.5% fewer total tokens (655,358→508,210), and 14.6% less wall time (262.678s→224.263s), with aggregate structural recall 20/22 in both arms, 100% precision, zero critical misses, and equal mean quality. The frozen overall verdict was **PASS WITH CONCERNS**: effective overall, but Planner repetition and a one-surface regression meant that Planner-only tightening was investigated rather than automatically promoted.

Raw evidence is local under `$OPENCODE_WORKFLOW_DATA_ROOT/benchmarks/codegraph-ab/20260827T165722Z`; it is intentionally not linked from GitHub.

## Invalid infrastructure attempt

**EXPERIMENTAL / INVALID:** `20260827T155125Z` placed disposable worktrees under `~/.config/opencode/benchmarks`. CodeGraph refused those sensitive-directory paths, so all three treatment calls failed before returning structural evidence and the agents used fallback retrieval. The report classifies every pair `INSUFFICIENT_EVIDENCE` and the overall result `BENCHMARK_INCONCLUSIVE`.

Do not aggregate its tool, token, latency, recall, or quality observations into valid CodeGraph effectiveness metrics. Its durable lesson is operational: keep raw evidence under the local data root, but locate disposable worktrees outside sensitive configuration directories and require an infrastructure-only successful explore probe before a live treatment run.

## Worktrees and indexes

**HISTORICALLY VALIDATED FINDING:** the corrected CodeGraph and later Planner experiments used detached worktrees outside sensitive configuration roots, each with an independent complete OMO-owned CodeGraph 1.5.0 index, exact resolved project root, zero pending work, and `worktreeMismatch: null`. Indexing and preflight probes were excluded from timed model work.

This validates an experiment preflight pattern, not a new custom runtime lifecycle. OMO retains index ownership. The current Executor policy separately requires actual child cwd binding before lane worktrees or worker-driven sandboxes can be used; a `WORKSPACE:` prompt is not binding proof.

## Why the narrow tool surface and no proxy

**CURRENT PRODUCTION FACT:** the custom rollout remains explore-only. The frozen Planner decision explicitly does not authorize `impact`, `callers`, `callees`, `node`, `search`, `files`, or `status` tools. The evidence established value for structural exploration, not a need for additional custom graph APIs, a second index owner, or a proxy layer. Introducing any of those would duplicate OMO ownership and create a lifecycle/state boundary the workflow deliberately avoids.

## Limits and open questions

- **UNPROVEN:** direct worker/subagent CodeGraph access. Workers are briefed with grounded conclusions; current policy does not assume they can call CodeGraph.
- **UNPROVEN:** whether Executor and Reviewer efficiency gains replicate under model variance. The valid A/B supports the observed run, not universal performance guarantees.
- **FUTURE RESEARCH:** Planner context economics/information value if a new, falsifiable need arises. This is not authorization for Planner V5 or cosmetic prompt tightening.

For Planner experiment chronology and the reviewed-pipeline result, see [Planner benchmarks](planner-benchmarks.md). For the final engineering boundary, see the [Planner optimization decision](../decisions/planner-optimization.md).
