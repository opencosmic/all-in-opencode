# Professor V1.1 research correctness benchmark

This benchmark evaluates the Professor V1.1 runtime in an isolated OpenCode
execution environment. The runner uses the installed OpenCode CLI, temporary
XDG config/data/state/cache roots, this worktree's Professor configuration, and
native retrieval only.

The original B1–B7 cases are frozen verbatim from the preserved original
Professor run artifacts. They cover temporal/version scope, negative claims,
source authority, architecture reconciliation, production viability,
integration feasibility, and practical-stack selection. The four blind cases
remain intentionally exactly these prompts:

- B1b — `Research the current recommended Next.js architecture for a new production application.`
- B2b — `Research what official automation interfaces OpenCut currently provides.`
- B3b — `Research whether I can install a usable official OpenCut desktop application on macOS today.`
- B4b — `Research OpenCut's current architecture and technology stack.`

The blind prompts contain no hints about temporal reasoning, source authority,
negative-claim discipline, or contradiction handling. The former coached
seven-case set is retained as supplemental C1–C7; it is not presented as the
original B1–B7 suite.

## Run

From this worktree:

```sh
node benchmarks/professor-quality/run.mjs --suite regression --fresh --out results/corrected-regression-runs.jsonl
node benchmarks/professor-quality/analyze.mjs --in results/corrected-regression-runs.jsonl --out results/corrected-regression-summary.json
node --test benchmarks/professor-quality/harness.test.mjs
```

Use `--case B6` or `--case B1b` for a focused run, and `--suite original`,
`--suite blind`, or `--suite supplemental` to select one suite. Existing
`caseId/runIndex` pairs are skipped unless `--fresh` is supplied. Do not edit
the prompts to improve a result.

## Preserved run data

Each JSONL record preserves the prompt/case ID, run ID, process status,
duration, outer step count, controller rounds, task status counts including
`superseded`, source/evidence/finding/claim counts, claim verdict counts,
search/fetch/retrieval activity, contradiction summaries, uncertainty lines,
the canonical final report when available, actual observed outer steps when
the host emits step events, and a failure reason when the run does not
complete. Retrieved page bodies and raw OpenCode transcripts are not
committed. Durable task lifecycle events are used for canonical progress
counts; a task completed with only a summary, duplicate source/evidence,
observed-URL-alias metadata, unchanged criterion/contradiction, or uncreated
follow-up is a benchmark failure signal. Claim verdict counts are derived from
the canonical `state.claims` snapshot; legacy normalized records whose stored
status totals do not match `claimCount` are reported as status-unavailable
instead of being presented as verified zeroes.

The report is reconstructed from the isolated Professor run's durable
`state.json`, `events.jsonl`, and `report.md` artifacts while the temporary
environment is still available. The historical `results/summary.json` remains
the frozen blind-baseline summary; current selected-run metrics are written to
the explicit `--out` path, such as `results/corrected-regression-summary.json`.
Quality judgments remain an explicit manual evaluation.

## Main-case rubric

Score each main case against the frozen prompt on a 0–5 scale for:

1. completion and bounded termination;
2. question coverage;
3. evidence atomicity and source/span grounding;
4. claim verification accounting;
5. final report usefulness and uncertainty disclosure.

The runner does not convert these judgments into a synthetic pass. Keep the
before/after records and evaluator notes together so fewer retrieval calls do
not hide a quality regression. The original historical repository baseline
contains only the blind B1b–B4b records; preserved live Professor artifacts
for the old B1–B7 runs are provenance, not runner-normalized apples-to-apples
measurements.

All post-change benchmark runs explicitly pass the fixed model
`opencode/muse-spark-1.3-contributor-free` with its `xhigh` variant to
OpenCode. The frozen historical
baseline was captured before this pin was added and its resolved model was not
recorded, so comparisons must identify that model-control limitation rather
than treating the baseline as an apples-to-apples model match.
