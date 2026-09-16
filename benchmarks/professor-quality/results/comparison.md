# Professor V1.1 research-correctness comparison

Captured 16 September 2026 local time in the isolated worktree
`feat/professor-v1-1-research-correctness`. This note is the corrective
comparison for the existing Professor V1.1 change; it does not merge or push
anything.

## Current gate result

**READY TO MERGE.** The alias-only and question-status-only canonical-progress
loopholes are fixed and covered by focused regression tests. Benchmark task
lifecycle records now preserve criterion progress, and claim-status summaries
derive from canonical `state.claims`; legacy incomplete records with stale zero
metrics are marked status-unavailable rather than treated as verified zeroes.
After the fixed model quota reset, the exact model/variant health check
completed successfully, and the fresh original B6 run completed normally in
176,933 ms: 5 controller rounds, 22 CLI steps, 19 observed outer steps, 5
completed tasks, 22 sources, 24 evidence records, 9 findings, and 13 claims
(11 supported, 2 partial). Verification and writing completed, a final report
was generated, no zero-value completed tasks were observed, and the 32-step
emergency ceiling was not reached. This is Case A; the prior Case D startup
records remain preserved as historical environment evidence.

## Run provenance and model control

| Dataset | Code / suite | OpenCode | Model | Variant | Use |
| --- | --- | --- | --- | --- | --- |
| Historical frozen baseline | V1 commit `84e259b` / blind B1b–B4b | 1.18.30 | Unknown; the old runner did not record it | Unknown | Preserved blind reference only |
| Pre-change fixed-model control | Frozen V1 / blind B1b–B4b | 1.18.31 | `opencode/muse-spark-1.3-contributor-free` | `xhigh` | Four startup timeouts; no quality baseline inferred |
| Corrected regression batch | V1.1 / original B1–B7 plus blind B1b–B4b | 1.18.31 | `opencode/muse-spark-1.3-contributor-free` | `xhigh` | Primary corrected run, 180-second harness ceiling |
| Corrected focused repeats | B2, B4, and B6 | 1.18.31 | `opencode/muse-spark-1.3-contributor-free` | `xhigh` | Separate completion/latency evidence |
| Quota-reset final validation | V1.1 / original B6 | 1.18.31 | `opencode/muse-spark-1.3-contributor-free` | `xhigh` | Provider-ready Case A gate run |

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
| B6 | Incomplete: harness timeout while writing | 25 / 26 | 6 | 6 completed | 17 / 23 / 13 | Fresh quota-reset final B6 completed in 176.9s; 19 / 22 steps, 5 rounds, report generated |
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

The final bounded fixed-model preflight is recorded in
[`fixed-model-health-check.json`](fixed-model-health-check.json): OpenCode
1.18.31 launched with `opencode/muse-spark-1.3-contributor-free` and `xhigh`,
but the non-Professor request emitted no output or session/run event before
the 20-second timeout. This prevented a responsible additional 600-second B6
attempt. It remains preserved as historical environment evidence; the later
quota-reset health check and B6 run are the provider-ready validation below.

### Quota-reset provider-ready B6 validation

The fresh original B6 artifact is
[`corrected-B6-quota-reset.jsonl`](corrected-B6-quota-reset.jsonl), with its
normalized summary in
[`corrected-B6-quota-reset-summary.json`](corrected-B6-quota-reset-summary.json).
The runner used the exact frozen B6 prompt with
`opencode/muse-spark-1.3-contributor-free` and `xhigh`.

- Run/session: `run-1789552278925-1ab5cedf-243` /
  `ses_f56600e1fffebx4jgwg4c3xH5O`
- Started/ended: `2026-09-16T09:50:17.427Z` /
  `2026-09-16T09:53:14.362Z`; duration `176,933 ms`
- Process: exit `0`, not timed out, final status `completed`
- Budget: 22 CLI steps, 19 observed outer steps, 5 controller rounds, 32-step
  ceiling not reached
- Lifecycle: 5 completed, 0 pending/running/failed/superseded; every completed
  task has canonical progress and `canonicalResult: true`; zero-value count `0`
- Retrieval: 12 searches, 2 fetches (14 retrieval calls)
- State: 22 sources, 24 evidence records, 9 findings, 13 claims
- Canonical claim statuses: 11 supported, 2 partial, 0 unsupported, 0
  contradicted; totals reconcile to 13
- Verification resolved all 5 questions with 0 critical blockers and 0 open
  critical contradictions; writing and `research_complete` completed
- Report: generated; the complete `finalReport` is preserved in the raw JSONL
  artifact and the completion output records the isolated report reference

The successful health check is preserved in
[`fixed-model-health-check-2026-09-16.json`](fixed-model-health-check-2026-09-16.json):
it returned exit `0` in `44,233 ms`, emitted `step_start`, `text`, and
`step_finish`, and created session `ses_f5660ff3bffeXARtD4m7a0FRJY`.

This run is the required Case A validation and clears the final B6 gate.

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
| B6 | 22/25 on the earlier completed focused report | The report is candid about partial desktop/licensing evidence and gives feasible-today/future architectures; the fresh quota-reset Case A run validates final-code completion. |
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
after normalization. It counts only new canonical source records, new
canonical evidence, new findings/contradictions, meaningful criterion or
contradiction mutations, and follow-up tasks actually created and still
actionable. Observed URL aliases remain source metadata, but they cannot by
themselves count as source progress. Question status bookkeeping is likewise metadata, not criterion
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
- Strict OpenSpec validation: passed after the final artifact/OpenSpec update;
  task 4.4 is complete and the existing change remains the single change.
- Fixed-model provider preflight: **passed** after 44,233 ms with output,
  `step_start`, `text`, and `step_finish` events, and session
  `ses_f5660ff3bffeXARtD4m7a0FRJY`; OpenCode resolved as **1.18.31**.
- Host-dependent integration: **1 failed at readiness** after 183.9 seconds;
  the test's OpenCode server printed that it was listening on localhost, but
  its HTTP readiness operation timed out before the test could exercise the
  linked-worktree flow. This is an environment-level limitation, not a
  Professor assertion failure.

The original B6 provider-ready validation is complete. The prior host-readiness
integration limitation remains an environment-level risk, but no Professor
correctness or outer-step-cap failure was observed in the fresh Case A run.
