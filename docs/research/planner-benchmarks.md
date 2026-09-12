# Planner benchmark history

This chronology records what happened in the Planner experiments. It does not reopen the decision: [Planner optimization decision](../decisions/planner-optimization.md) remains authoritative for production policy.

## Terms used in these experiments

| Term | Meaning here |
|---|---|
| Recall | How many frozen relevant planning surfaces the result covered out of those required by the reference. |
| Precision | Whether scored claims/findings were supported rather than invented or overstated. |
| Critical miss | A missing surface that would materially threaten safe/correct planning; no critical miss is not the same as complete coverage. |
| Silent relevant drop | Evidence discovered during retrieval but neither represented in the final plan nor explicitly excluded with a reason. |
| Retrieval call | A CodeGraph or ordinary repository lookup used to obtain planning evidence. |
| Pipeline tokens | Planner plus Plan Reviewer token use, not Planner cost alone. |
| Macro-average | The equal-repository average of percentage changes, so a large repository cannot hide a regression in another. |
| Effective / reviewed recall | Required coverage after the Plan Reviewer has had a chance to recover Planner omissions. |
| Reviewer recovery | The share of known Planner misses the Plan Reviewer independently detected and corrected. |

## Chronology

| Experiment | Candidate | Repository / repositories | Question | Key result | Verdict / production effect |
|---|---|---|---|---|---|
| `20260827T174152Z` | V1 tightened retrieval discipline | `ego-lite` | Can bounded graph retrieval cut cost and restore coverage? | Tokens −50.1%, wall −25.5%, but recall 8/8→7/8. | `PLANNER_TIGHTENING_REGRESSES`; not promoted. |
| `20260827T180404Z` | V2 reconciliation reminder | `ego-lite` | Can an explicit reconciliation step prevent omissions? | Recall remained 7/8; relevant tests were silently dropped despite discovery. | `PLANNER_RECONCILIATION_REGRESSES`; not promoted. |
| `20260827T182526Z` | V3 coverage accounting | `ego-lite`, replicated | Can stronger coverage accounting restore stable coverage? | Both treatments reached 8/8, but median tokens +60.4%, wall +30.3%, and each silently dropped a relevant surface. | `PLANNER_V3_REGRESSES`; not promoted. |
| `20260827T190106Z` | V4 consolidated probing | `ego-lite`, replicated | Can V3 coverage be retained without probe fan-out? | Median tokens −64.8%, wall −20.2%, but both treatments stabilized at 7/8; one had a silent drop. | `PLANNER_V4_REGRESSES`; not promoted. |
| `20260827T195837Z` | V4 + unchanged Plan Reviewer | `ego-lite` and `codegraph` | Does the reviewed system generalize safely? | Better reviewed ego-lite coverage at materially higher cost; CodeGraph effective recall 100%→80% with two unrecovered critical omissions. | `V4_PIPELINE_REGRESSES`; retain production Planner. |

Raw evidence convention: `$AIO_DATA_ROOT/benchmarks/<experiment-id>`. Existing installations may continue using `OPENCODE_WORKFLOW_DATA_ROOT`. Protocols, manifests, reports, and checksums are local forensic evidence; no raw sessions are committed here.

## What each candidate taught

### V1 — lean retrieval can lose coverage

V1 required a broad first structural query, concrete evidence gaps for follow-ups, a retrieval stop after sufficient evidence, and anti-overlap rules. It halved token use (207,371→103,491) and reduced wall time (108.393s→80.796s), but its delivered plan covered 7/8 rather than 8/8 required surfaces. The task-space public-test relationship was retrieved but not retained in the final plan. Efficiency could not compensate for a coverage regression.

### V2 — a generic reminder was not enough

V2 added reconciliation to V1. It preserved most efficiency (tokens −2.1%, wall −7.2%) but still produced 7/8 recall and silently dropped discovered `ego-errors` and `driver/waits` regression surfaces. A general instruction to reconcile evidence did not create robust synthesis retention.

### V3 — coverage accounting restored frozen coverage at disproportionate cost

V3 added transient coverage dispositions across implementation, contract, downstream, regression, and state classes. Both replicas reached 8/8 recall with zero critical/unsupported claims. But its targeted ordinary-tool probing became an expensive pattern: median tokens rose 60.4% and wall time 30.3%. Each replica also silently dropped a relevant discovered regression surface, so the accounting rule was not fully reliable.

### V4 — efficient again, but not robust enough

V4 attempted to consolidate V3 probing. Its replicated median token and wall reductions were strong, but both treatment plans settled at 7/8 recall; one silently omitted discovered update-notice/output evidence. The candidate recovered efficiency but did not establish sufficiently robust coverage and retention.

## Cross-repository reviewed pipeline

`ego-lite` had been used repeatedly during V1–V4. The `codegraph` repository supplied a distinct structural dry-run planning task, reducing the chance that a candidate only fit the first repository's task/reference shape. Results were scored per repository before macro efficiency was considered.

| Repository | Control effective recall / quality / pipeline cost | V4 effective recall / quality / pipeline cost | Result |
|---|---|---|---|
| `ego-lite` | 7/8; 9.0; 342,505 tokens, 16 retrievals, 159.789s | 8/8; 9.5; 490,981 tokens, 22 retrievals, 231.085s | Coverage improved, but tokens +43.35%, retrieval +37.50%, wall +44.62%. |
| `codegraph` | 10/10; 9.5; 2,044,608 tokens, 55 retrievals, 443.602s | 8/10; 8.0; 1,393,461 tokens, 36 retrievals, 320.154s | Efficient, but two critical omissions were unrecovered; safety/quality failed. |

On `codegraph`, V4 Planner raw recall was 5/10. Plan Reviewer recovered three of five misses but not Antigravity command-resolution subprocess behavior or exact CLI-removal discovery/reporting. This is why V4 was **not** rejected merely for raw Planner recall: the decisive failure was reviewed-pipeline behavior—unrecovered critical omissions, lower effective coverage, and no equal-repository macro token reduction. Macro V4 deltas were tokens **+5.75%**, retrieval **+1.48%**, wall **+8.40%**, effective recall **−2.86%**, and quality **−5.12%**.

## What we learned

The tested prompt changes repeatedly exposed an efficiency-versus-coverage trade-off. A Reviewer can add valuable independent corrections, but the cross-repository result shows it is not a reliable universal compensation layer for V4 Planner omissions. Future work, if newly justified, should study information value and context economics—not resume V1–V4 tuning.

See the authoritative [Planner optimization decision](../decisions/planner-optimization.md).
