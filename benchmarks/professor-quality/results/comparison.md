# Professor V1.1 research-correctness comparison

Captured 15 September 2026 local time in the isolated worktree
`feat/professor-v1-1-research-correctness`. This note is the corrective
comparison for the existing Professor V1.1 change; it does not merge or push
anything.

## Current gate result

**CODE READY / BENCHMARK VALIDATION BLOCKED BY ENVIRONMENT.** The alias-only
and question-status-only canonical-progress loopholes are fixed and covered by
focused regression tests. Benchmark task lifecycle records now preserve
criterion progress, and claim-status summaries derive from canonical
`state.claims`; legacy incomplete records with stale zero metrics are marked
status-unavailable rather than treated as verified zeroes. The fresh post-patch
original B6 attempt used the required model/variant but timed out after 600
seconds before Professor created a run or session: no outer steps, retrieval,
or durable state were observed. This is a Case D startup/provider/CLI stall,
not evidence of a Professor ResearchRuntime failure. Earlier controlled B6
execution reached verification/writing at approximately 25 observed outer
steps without reaching the 32-step emergency boundary. A provider-ready final
B6 run is still required before merging.

## Run provenance and model control

| Dataset | Code / suite | OpenCode | Model | Variant | Use |
| --- | --- | --- | --- | --- | --- |
| Historical frozen baseline | V1 commit `84e259b` / blind B1b–B4b | 1.18.30 | Unknown; the old runner did not record it | Unknown | Preserved blind reference only |
| Pre-change fixed-model control | Frozen V1 / blind B1b–B4b | 1.18.31 | `opencode/muse-spark-1.3-contributor-free` | `xhigh` | Four startup timeouts; no quality baseline inferred |
| Corrected regression batch | V1.1 / original B1–B7 plus blind B1b–B4b | 1.18.31 | `opencode/muse-spark-1.3-contributor-free` | `xhigh` | Primary corrected run, 180-second harness ceiling |
| Corrected focused repeats | B2, B4, and B6 | 1.18.31 | `opencode/muse-spark-1.3-contributor-free` | `xhigh` | Separate completion/latency evidence |

Every new Professor run in this pass explicitly used the fixed model and
`xhigh` variant. The runner records both values in each JSONL record. The
historical model identity is unknown, so the historical blind comparison is
not presented as apples-to-apples model evidence.

## Suite correction

- **Original regression:** B1–B7 are the exact frozen prompts recovered from
  the preserved durable Professor run artifacts, including the original
  adaptive-replanning B5, evidence-dense integration B6, and practical-stack
  B7.
- **Blind suite:** B1b–B4b remain the exact blind prompts, without hidden
  coaching.
- **Supplemental suite:** the formerly mislabelled newer cases are now C1–C7
  in `cases.json`. The old `after-runs.jsonl` records are retained as
  historical artifacts but are not silently relabelled or counted as current
  original results; no valid post-correction C1–C7 batch was required for this
  gate.

## Original B1–B7 results

The primary corrected batch is
[`corrected-regression-runs.jsonl`](corrected-regression-runs.jsonl), with
objective metrics in
[`corrected-regression-summary.json`](corrected-regression-summary.json).
Durable state and event data provide task status and per-task canonical
progress.

| Case | 180s primary result | Outer observed / CLI steps | Rounds | Durable tasks | Sources / evidence / claims | Follow-up result |
| --- | --- | ---: | ---: | --- | ---: | --- |
| B1 | Completed; no timeout | 16 / 18 | 4 | 4 completed | 13 / 19 / 8 | Report produced |
| B2 | Incomplete: harness timeout while writing | 22 / 23 | 6 | 6 completed | 12 / 19 / 11 | `corrected-B2-extended.jsonl` completed in 169s |
| B3 | Completed at the 180s timer race; no runtime failure | 20 / 22 | 4 | 4 completed | 10 / 14 / 6 | Report produced |
| B4 | Incomplete: harness timeout with 1 task running | 17 / 18 | 5 | 4 completed, 1 running | 9 / 19 / 0 | `corrected-B4-extended.jsonl` completed in 169s |
| B5 | Completed; no timeout | 19 / 21 | 5 | 5 completed | 15 / 24 / 8 | Adaptive assumptions and blockers reported |
| B6 | Incomplete: harness timeout while writing | 25 / 26 | 6 | 6 completed | 17 / 23 / 13 | Earlier `corrected-B6-runs-v2.jsonl` completed; final-code retries at 240s, 360s, and 600s timed out |
| B7 | Completed at the 180s timer race; no runtime failure | 21 / 22 | 6 | 6 completed | 17 / 20 / 10 | 0 zero-value completed tasks; no superseded task arose in this run |

Across the 11-record corrected regression batch: 8 records completed, 3 were
incomplete (B2, B4, B6), 0 zero-value completed tasks were observed, and 0
runs hit the Professor outer-step boundary. The three timer-race records are
kept as `timedOut: true` in the raw artifacts even though durable state reached
`completed`; they are not silently treated as ordinary fast completions.

The primary B6 record contains 13 canonical claims. Its pre-fix normalized
JSONL snapshot did not retain the claim objects, so its stale all-zero verdict
metrics cannot be reconstructed without inventing statuses. The regenerated
[`corrected-regression-summary.json`](corrected-regression-summary.json) now
reports those 13 claims as `claimStatusCountsUnavailable: 13` instead of
presenting a false zero-status count; the same treatment is applied to the
10-claim extended B6 writing artifact.

The successful focused B6 repeat in
[`corrected-B6-runs-v2.jsonl`](corrected-B6-runs-v2.jsonl) used the required
model/variant and completed in 3 controller rounds with 15 durably observed
outer steps (17 CLI steps), 10 sources, 10 evidence records, and 8 claims
(6 supported, 1 partial, 1 unsupported). It is useful evidence that the
runtime can close B6 without the outer emergency ceiling, but it predates the
latest final-code evidence-dedup and timeout-plumbing edits, so it does not
clear the final-code gate by itself. The subsequent records
[`corrected-B6-extended-v2.jsonl`](corrected-B6-extended-v2.jsonl),
[`corrected-B6-extended-v3.jsonl`](corrected-B6-extended-v3.jsonl), and
[`corrected-B6-final.jsonl`](corrected-B6-final.jsonl) preserve the final-code
240-second, 360-second, and 600-second failures. The final record contains no
durable state because the child process was still in startup/retrieval when
the harness ceiling elapsed.

The post-alias-fix retry is preserved in
[`corrected-B6-alias-fix.jsonl`](corrected-B6-alias-fix.jsonl), with its
summary in [`corrected-B6-alias-fix-summary.json`](corrected-B6-alias-fix-summary.json).
The final status/claims retry is preserved in
[`corrected-B6-status-claims.jsonl`](corrected-B6-status-claims.jsonl), with its
regenerated summary in
[`corrected-B6-status-claims-summary.json`](corrected-B6-status-claims-summary.json).
It is the Case D startup/provider stall: 600,093 ms, no run ID, no session,
zero outer steps, zero retrieval calls, and no durable state. The final retry
was 600,078 ms and had the same Case D result.

### Main-case report assessment

Scores are 0–5 in the rubric order: bounded completion, question coverage,
evidence atomicity, claim accounting, report usefulness. They are manual
assessment of available completed reports, not a synthetic runner score.

| Case | Score | Assessment |
| --- | ---: | --- |
| B1 | 23/25 | Current App Router guidance is direct and legacy behavior is separated; minor version/source caveats remain. |
| B2 | 25/25 on the completed extended report | Released, roadmap, PR, community, and not-found categories are explicitly separated. |
| B3 | 24/25 | Official web/source status is separated from third-party packaging and community claims. |
| B4 | 25/25 on the completed extended report | Classic, rewrite, roadmap, and version conflicts are reconciled without collapsing them. |
| B5 | 24/25 | Production blockers and changed assumptions are useful; adaptive replanning is reflected in the report, though this run created no additional follow-up task. |
| B6 | 22/25 on the earlier completed focused report | The report is candid about partial desktop/licensing evidence and gives feasible-today/future architectures; final-code completion remains unproven. |
| B7 | 25/25 | The report covers HyperFrames, Blender, OpenCut, FFmpeg, AI services, audio, captions, and human/file boundaries with a practical architecture. |

## Blind B1b–B4b

The corrected primary batch completed all four blind cases with the fixed model
and variant. All four reports are judged **PASS**:

- **B1b — PASS:** current App Router/Next.js guidance is distinguished from
  supported Pages Router and version-specific caching/legacy behavior, with
  residual uncertainty disclosed.
- **B2b — PASS:** no released official automation surface is separated from
  roadmap items, closed/open proposals, third-party controllers, and bounded
  not-found evidence.
- **B3b — PASS:** first-party web/source-only desktop status is separated from
  unofficial DMG/fork claims and community evidence.
- **B4b — PASS:** classic/current rewrite/roadmap generations and stack
  differences are reconciled, with remaining version uncertainty recorded.

The primary blind metrics were 4/4 completed, 14 completed tasks, no failed or
superseded tasks, 36 sources, 55 evidence records, 24 supported claims, and no
zero-value completed tasks. The historical frozen baseline was 3/4 completed
(B1b PARTIAL, B2b PASS, B3b PASS, B4b FAIL), but its model was not recorded.

## Correctness and budget changes verified

The zero-value completion root cause was checking whether input arrays were
non-empty before normalization. The runtime now computes canonical progress
after normalization. It counts only new source records or observed aliases,
new canonical evidence, new findings/contradictions, meaningful criterion or
contradiction mutations, and follow-up tasks actually created and still
actionable. Only new canonical source records count as source progress. An
observed-URL alias may remain source metadata, but it cannot by itself count as
progress. Question status bookkeeping is likewise metadata, not criterion
progress. Duplicate source/evidence records and unchanged updates therefore
reject an unresolved successful commit, preserve the running task, or use
supersession when the linked question is already sufficient. Durable
`task.completed` events include sources, evidence, findings, contradictions,
criteria, follow-ups, and `canonicalResult`.

Benchmark state summaries now derive claim-status counts directly from
`state.claims`, so a writing-stage state with 13 claims cannot be represented as
13 claims with four false zero counts. When only an old normalized record is
available and its status total does not equal its claim total, the report marks
the status count unavailable instead of guessing.

The unsafe budget root cause was treating one controller round as a fixed three
outer steps. That estimate is retained only for compatibility/diagnostics. New
runs retain a 32-step emergency ceiling and an 8-step closure reserve. Without
an observed host step event, the runtime uses a fallback five-round controller
ceiling (default two-round controller reserve, three normal research rounds).
Once completed outer-step events are observed, the configured ceiling can be
used, but actual observed outer steps gate new research when only the closure
reserve remains. Capacity exposes observed/remaining steps, normal research
steps, controller limits, and closure recommendation; the Professor prompt
also requires bounded tasks, selective retrieval, and early commit/verify.

The remaining host limitation is observability: if the host emits no recognized
step event, the runtime cannot know live outer usage and must use the fallback.
On OpenCode 1.18.31, recognized `message.part.updated` `step-finish` events were
available, although durable counts can lag the CLI step count by a small amount
because event delivery occurs after session binding.

## Verification status

- Deterministic repository tests excluding the host-readiness integration:
  **245 passed**.
- Professor/runtime/plugin/agent focused tests: **64 passed** (included in the
  deterministic total).
- Benchmark harness tests: **6 passed**.
- `git diff --check`: passed.
- Strict OpenSpec validation: run after the final artifact update; the existing
  change remains the single change, with task 4.4 intentionally open until a
  provider-ready B6 validation is available.
- Host-dependent integration: **1 failed at readiness** after 183.9 seconds;
  the test's OpenCode server printed that it was listening on localhost, but
  its HTTP readiness operation timed out before the test could exercise the
  linked-worktree flow. This is an environment-level limitation, not a
  Professor assertion failure.

The exact remaining limitation is therefore provider-ready benchmark
validation for the original B6, not a detected outer-step-cap breach or a
zero-value task regression.
