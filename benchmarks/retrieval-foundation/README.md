# Native retrieval foundation evaluation

This benchmark evaluates the Searcher baseline at `9e91fe0` without changing
production Searcher behavior. It asks whether native OpenCode `websearch` plus
`webfetch` is sufficient as the shared retrieval foundation for Searcher and a
future Deep Research agent.

## Runtime isolation

The runner invokes the installed OpenCode CLI (`1.18.30`) with:

- a temporary `XDG_CONFIG_HOME` containing symlinks to this worktree's
  `opencode/agents`, `commands`, `plugins`, `categories.json`, and `tui.json`;
- `OPENCODE_CONFIG` set to this worktree's `opencode/opencode.jsonc`;
- `--dir` set to this evaluation worktree;
- `--agent Searcher --format json`.

This avoids repointing or mutating `~/.config/opencode`. OpenCode's normal data,
authentication, cache, and log directories remain outside the repository; the
runner does not copy credentials or runtime state into Git.

## Frozen benchmark

`cases.json` was frozen before live execution. It contains 24 cases:

| Category | Cases | Baseline runs |
|---|---:|---:|
| Simple factual retrieval | 3 | 3 |
| Exact first-party detail | 3 | 3 |
| Current/fresh information | 3 | 3 |
| Comparison | 3 | 3 |
| Multi-aspect informational | 3 | 3 |
| Stale/conflicting information | 3 | 3 |
| Community/user experience | 2 | 2 |
| Fetch-heavy/document detail | 2 | 2 |
| Ambiguous/context behavior | 1 | 1 |
| Retrieval robustness | 1 | 1 |
| **Total** | **24** | **24** |

Six representative cases are marked for two additional runs, producing 36
total executions. The repeat set is one simple, current, comparison,
multi-aspect, conflicting, and fetch-heavy case.

## Run

From the repository root:

```sh
node benchmarks/retrieval-foundation/run.mjs
node benchmarks/retrieval-foundation/analyze.mjs
node --test benchmarks/retrieval-foundation/harness.test.mjs
```

The live runner is intentionally not part of the ordinary test suite. It writes
compact JSONL records to `results/runs.jsonl`; it does not commit raw OpenCode
transcripts or full fetched pages. `analyze.mjs` writes objective metrics to
`results/summary.json` when requested by the runner's default flow.

To resume an interrupted run, rerun the same command. Existing `caseId/runIndex`
pairs are skipped. To run one case during harness development:

```sh
node benchmarks/retrieval-foundation/run.mjs --case simple-01
```

## Scoring and decision

`rubric.md` pre-registers the six 0–5 dimensions and the pass thresholds.
Objective metrics come from normalized runtime events. Correctness, coverage,
citation entailment, and source appropriateness remain evaluator judgments and
must retain a short evidence note in the score record.

The recommendation must distinguish retrieval limitations from model
reasoning, prompt policy, source selection, fetch extraction, citation, runtime,
and Deep Research orchestration/state requirements. This branch evaluates and
documents the decision; it does not implement `search_batch`, `fetch_evidence`,
Deep Research, or a production Search Core.
