# Evaluation rubric

Cases are scored independently from 0–5 on six dimensions. Scores for
correctness, coverage, citation grounding, and source appropriateness are
evaluator judgments and must include a short evidence note. Runtime counts and
URLs/domains are deterministic observations from the normalized JSONL record.

## Quality dimensions

### Correctness

| Score | Anchor |
|---:|---|
| 5 | Materially correct; no meaningful factual error. |
| 4 | Correct with only minor imprecision or harmless omission. |
| 3 | Partly correct, but a meaningful omission, qualification, or error remains. |
| 2 | Major factual weakness; answer is only partly usable. |
| 1 | Mostly wrong or materially misleading. |
| 0 | Unusable, fabricated, or no answer. |

### Coverage

| Score | Anchor |
|---:|---|
| 5 | Covers every requested dimension and important qualification. |
| 4 | Covers all main dimensions; one minor gap. |
| 3 | Covers the central question but omits one requested dimension or caveat. |
| 2 | Multiple requested dimensions are missing. |
| 1 | Barely addresses the question. |
| 0 | Does not address the case. |

### Citation grounding

| Score | Anchor |
|---:|---|
| 5 | Important claims are clearly supported by nearby, relevant citations. |
| 4 | Almost all important claims are supported; minor citation looseness. |
| 3 | Mixed support; some important claims are only indirectly supported. |
| 2 | Multiple important claims are unsupported or citations are poorly aligned. |
| 1 | Citations are mostly decorative, generic, or mismatched. |
| 0 | Citations are absent when required or fabricated. |

### Source quality

| Score | Anchor |
|---:|---|
| 5 | Uses the strongest applicable primary/authoritative sources and appropriate community evidence. |
| 4 | Mostly authoritative; one secondary source is used where a stronger source was available. |
| 3 | Adequate sources, but quality or provenance is mixed. |
| 2 | Relies mainly on weak, stale, or low-provenance sources. |
| 1 | Sources are inappropriate for the claims. |
| 0 | No usable source evidence. |

### Freshness

| Score | Anchor |
|---:|---|
| 5 | Current, dated, version-applicable evidence; stale/conflicting material is resolved. |
| 4 | Current evidence with a minor date/version qualification missing. |
| 3 | Plausibly current but weakly dated or version-scoped. |
| 2 | Some stale evidence is used without adequate resolution. |
| 1 | Clearly stale or undated evidence answers a current question. |
| 0 | No usable current evidence. |

This dimension is recorded as `null` for a case that does not require
freshness; it does not reduce the quality-pass threshold.

### Retrieval efficiency

This is reported separately and is not a factual quality gate.

| Score | Anchor |
|---:|---|
| 5 | Minimum sufficient calls; no unnecessary fetch/search or repeated source. |
| 4 | Small, reasonable overhead with no material context waste. |
| 3 | Noticeable overhead but still bounded and usable. |
| 2 | Excessive fan-out, duplicate retrieval, or avoidable fetch volume. |
| 1 | Retrieval is wasteful or reaches the step boundary unnecessarily. |
| 0 | Retrieval fails, loops, or cannot support an answer. |

## Quality pass

A normal case passes when:

```text
correctness >= 4
coverage >= 4
citationGrounding >= 4
sourceQuality >= 3
freshness >= 4 when required
```

Efficiency is analyzed separately. Every critical factual failure,
unsupported important claim, step-cap boundary, and runtime/tool failure is
reported even when the case passes overall.

## Root causes

Each meaningful failure receives one primary cause from this closed set:

```text
SEARCH_PROVIDER
SEARCH_ORCHESTRATION
SOURCE_SELECTION
FETCH_EXTRACTION
FRESHNESS
CITATION_GROUNDING
MODEL_REASONING
TOOL_RUNTIME
BROWSER_ACCESS
PROMPT_POLICY
CASE_INVALID
OTHER
```

For a passing case with no meaningful failure, use `failure: false` and
`OTHER`; that is an explicit no-failure marker, not a claim that the other
causes were tested and disproved.

Use `SEARCH_PROVIDER` only when the provider failed to return a reasonably
available relevant result. Use `SEARCH_ORCHESTRATION` for query fan-out,
deduplication, or step/latency limitations. Use `FETCH_EXTRACTION` when the
page was reachable but useful evidence could not be isolated. Use
`MODEL_REASONING` for synthesis or interpretation mistakes that the retrieved
evidence could support. Deep Research planning, state, gap analysis, stopping,
and report synthesis are orchestration requirements, not Search Core failures.

## Architecture signals

These are pre-registered signals, not automatic rules:

- `search_batch` is justified only if structural search/orchestration problems
  affect roughly 20% or more of complex cases, with repeated duplicate results,
  meaningful step pressure, unnecessary sequential latency, or diversity loss.
- `fetch_evidence` is justified only if fetch/extraction problems materially
  affect roughly 15–20% or more of fetch-requiring cases.
- Browser fallback requires a recurring, high-value class of inaccessible or
  JavaScript-dependent sources; one blocked page is insufficient.

The supplemental extraction benchmark and its extraction-specific dimensions
are documented in `extraction/README.md`; its results are intentionally kept
separate from the original quality rubric and normalized run set.
