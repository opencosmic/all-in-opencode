# Professor V1.1 research correctness benchmark

This benchmark freezes the current Professor V1 behavior before the V1.1
runtime, state, and prompt changes. It keeps the same isolated OpenCode
execution pattern as `benchmarks/retrieval-foundation`: the runner uses the
installed OpenCode CLI, temporary XDG config/data/state/cache roots, this
worktree's Professor configuration, and native retrieval only.

The seven main cases exercise the observed research failure shapes: temporal
and version scope, negative claims, source authority, contradictions, a
multi-aspect question, deep technical retrieval, and frontier supersession.
The four blind cases are intentionally exactly these prompts:

- B1b — `Research the current recommended Next.js architecture for a new production application.`
- B2b — `Research what official automation interfaces OpenCut currently provides.`
- B3b — `Research whether I can install a usable official OpenCut desktop application on macOS today.`
- B4b — `Research OpenCut's current architecture and technology stack.`

The blind prompts contain no hints about temporal reasoning, source authority,
negative-claim discipline, or contradiction handling. Assess each blind report
as PASS, PARTIAL, or FAIL after the run and record concise evidence in the
comparison notes.

## Run

From this worktree:

```sh
node benchmarks/professor-quality/run.mjs --fresh
node benchmarks/professor-quality/analyze.mjs
node --test benchmarks/professor-quality/harness.test.mjs
```

Use `--case B6` or `--case B1b` for a focused run. Existing `caseId/runIndex`
pairs are skipped unless `--fresh` is supplied. Do not edit the prompts to
improve a result.

## Preserved run data

Each JSONL record preserves the prompt/case ID, run ID, process status,
duration, outer step count, controller rounds, task status counts including
`superseded`, source/evidence/finding/claim counts, claim verdict counts,
search/fetch/retrieval activity, contradiction summaries, uncertainty lines,
the canonical final report when available, and a failure reason when the run
does not complete. Retrieved page bodies and raw OpenCode transcripts are not
committed.

The report is reconstructed from the isolated Professor run's durable
`state.json`, `events.jsonl`, and `report.md` artifacts while the temporary
environment is still available. `results/summary.json` contains objective
before/after metrics; quality judgments remain an explicit manual evaluation.

## Main-case rubric

Score each main case against the frozen prompt on a 0–5 scale for:

1. completion and bounded termination;
2. question coverage;
3. evidence atomicity and source/span grounding;
4. claim verification accounting;
5. final report usefulness and uncertainty disclosure.

The runner does not convert these judgments into a synthetic pass. Keep the
before/after records and evaluator notes together so fewer retrieval calls do
not hide a quality regression.

All post-change benchmark runs explicitly pass the fixed model
`opencode/muse-spark-1.3-contributor-free` with its `xhigh` variant to
OpenCode. The frozen historical
baseline was captured before this pin was added and its resolved model was not
recorded, so comparisons must identify that model-control limitation rather
than treating the baseline as an apples-to-apples model match.
