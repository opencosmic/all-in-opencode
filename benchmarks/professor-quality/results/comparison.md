# Professor V1.1 research-correctness comparison

Captured 14 September 2026 UTC / 15 September local time from the frozen
Professor V1 commit `84e259b6e9e5a963875e908045bda28536b4aa1c` and the
`feat/professor-v1-1-research-correctness` worktree. Prompts were unchanged.

## Run provenance

| Dataset | Code | OpenCode | Model | Variant | Result use |
| --- | --- | --- | --- | --- | --- |
| Historical frozen baseline | V1 commit above | 1.18.30 | Not recorded; runner used the OpenCode default | Not recorded | Original B1b–B4b baseline; retained unchanged |
| Post-change full batch | V1.1 worktree | 1.18.31 | `opencode/muse-spark-1.3-contributor-free` | `xhigh` | B1–B7 and B1b–B4b; one B4b timeout retained |
| Post-change focused B4b | V1.1 worktree | 1.18.31 | `opencode/muse-spark-1.3-contributor-free` | `xhigh` | Successful repeat used for B4b quality assessment |
| Pre-change fixed-model control | Frozen V1 code | 1.18.31 | `opencode/muse-spark-1.3-contributor-free` | `xhigh` | Four startup timeouts; no quality score inferred |

The fixed-model control was attempted to remove the historical model mismatch.
All four pre-change controls timed out before `research_start` produced a
state or any retrieval output, so they cannot serve as a successful quality
baseline. The historical baseline is consequently reported as a separately
identified, unpinned reference rather than an apples-to-apples model match.

## Objective metrics

### Blind B1b–B4b

| Metric | Historical frozen baseline | V1.1 full batch | V1.1 focused B4b |
| --- | ---: | ---: | ---: |
| Runs completed | 3/4 (75%) | 3/4 (75%) | 1/1 (100%) |
| Completed / failed / superseded tasks | 9 / 1 / 0 | 10 / 0 / 0 | 5 / 0 / 1 |
| Sources / evidence / claims | 30 / 35 / 11 | 26 / 42 / 17 | 5 / 14 / 4 |
| Claim verdicts: supported / partial / unsupported / contradicted | 10 / 1 / 0 / 0 | 17 / 0 / 0 / 0 | 4 / 0 / 0 / 0 |
| Searches / fetches | 16 / 30 | 20 / 52 | 5 / 1 |

The full batch B4b record is conservatively incomplete: it timed out at the
180-second harness boundary while still researching, with 3 pending and 1
running task. A separate fixed-model, `xhigh` B4b run completed in 5 rounds;
both records remain available so repeat variability is not hidden.

### Main B1–B7 V1.1 run

All seven main cases completed. The aggregate contained 23 completed tasks, 1
superseded task, 62 sources, 93 evidence records, 44 claims (43 supported and
1 partial), 39 searches, and 65 fetches. Every completed task in the batch
produced canonical source/evidence/finding/claim progress, and the runtime’s
empty-success rejection test also passed directly.

## Blind quality assessment

- **B1b — PASS.** The report leads with current Next.js 16/App Router guidance,
  separates the still-supported Pages Router and version-specific Cache
  Components behavior, and lists residual version/vendor uncertainties.
- **B2b — PASS.** It distinguishes no currently documented released interface
  from official roadmap items, a closed community PR, third-party bridges, and
  bounded not-found evidence; the absence claim is not presented as proof of
  impossibility.
- **B3b — PASS.** It separates first-party source-only desktop work from a
  usable packaged application, distinguishes the official web path, and labels
  similarly named `.dmg` packaging as third-party.
- **B4b — PASS for the focused completed run; FAIL for the full-batch record
  solely on completion.** The completed report separates classic documentation,
  the current rewrite, and roadmap material, identifies stack differences, and
  records remaining version uncertainty. The full-batch timeout remains a real
  boundedness result, not a hidden failure.

## Main-case rubric scores

Scores are 0–5 per rubric dimension in the order: bounded completion, question
coverage, evidence atomicity, claim accounting, report usefulness.

| Case | Scores | Total | Short evidence note |
| --- | --- | ---: | --- |
| B1 | 5 / 4 / 4 / 5 / 5 | 23/25 | Current/legacy guidance is clear; one non-primary legacy reference and minor version ambiguity remain. |
| B2 | 5 / 5 / 5 / 5 / 5 | 25/25 | Released, roadmap, community, third-party, and not-found categories are explicitly separated. |
| B3 | 5 / 5 / 4 / 5 / 5 | 24/25 | First-party authority and packaging provenance are strong; some citations are plain URL forms. |
| B4 | 5 / 5 / 5 / 5 / 5 | 25/25 | Current rewrite, classic stack, roadmap, and version conflicts are labeled rather than merged. |
| B5 | 5 / 5 / 5 / 5 / 5 | 25/25 | Official Node 24 evidence keeps stable core status distinct from experimental subfeatures and flag dating. |
| B6 | 5 / 5 / 5 / 5 / 5 | 25/25 | Uses a small official source set, separates current main from classic/roadmap material, and states gaps. |
| B7 | 5 / 5 / 5 / 5 / 5 | 25/25 | Covers repository, runtime, and UI; stops at sufficient dimensions and exposes a partial media/persistence claim. |

## Verification and environment notes

- `node --test opencode/tests/*.test.js`: 236 passed.
- `node --test benchmarks/professor-quality/harness.test.mjs`: 5 passed.
- Strict OpenSpec validation: passed with no issues.
- The durable-event task audit was added after the full batch, so its older
  records are not used as the sole zero-value-task proof; the direct runtime
  guard and B7 terminal task counts provide the verification for that case.
- The local global OpenCode launcher initially contained a postinstall
  placeholder; rerunning its package postinstall restored the CLI. This was a
  user-level environment issue, not a retrieval/source failure, and the
  successful benchmark records were produced after repair.
