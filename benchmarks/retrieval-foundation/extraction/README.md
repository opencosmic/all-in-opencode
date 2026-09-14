# Supplemental extraction stress evaluation

This is a separate benchmark from the original 24-case retrieval-foundation
evaluation. It tests whether native OpenCode `webfetch` repeatedly struggles to
locate precise evidence inside long documents after the correct source has been
found. It does not remeasure generic Searcher quality and does not change
Searcher, OpenCode configuration, Exa, or the six-step limit.

## Frozen workload

`cases.json` contains eight independent extraction-sensitive cases. Every case
runs three times for 24 supplemental runs:

| Source class | Case |
|---|---|
| Standard/specification | RFC 9110 range-error rule |
| Official API documentation | Node.js `server.maxRequestsPerSocket` |
| Versioned technical manual | PostgreSQL 17 `CREATE INDEX CONCURRENTLY` |
| Long table | IANA HTTP status registry row 425 |
| Research paper | *Attention Is All You Need* |
| Government/regulatory policy | GDPR Article 17(3)(b) |
| Long changelog/release history | Node.js v22 `node:sqlite` entry |
| Negative control | Git `rebase --onto` documentation example |

The cases, expected document URLs, target evidence, and evidence matchers were
frozen before the live runs. A source may be found through a URL variant or
anchor, but the expected source document must still be identifiable.

## Pre-registered decision rule

A meaningful `FETCH_EXTRACTION` failure requires all of the following:

1. the expected source was found;
2. native `webfetch` retrieved that source;
3. the target evidence was present in the retrieved document; and
4. the workflow materially struggled to isolate or use it, such as repeated
   fetches, extra searches after fetching the target, wrong-section evidence,
   unsupported precise citation, incomplete synthesis, or six-step pressure.

Wrong search results, a source that genuinely lacks the answer, model reasoning
errors, and tool/runtime errors are not classified as extraction failures.
Browser-required access is tracked separately as `BROWSER_ACCESS`.

`fetch_evidence` is justified only when at least two valid cases (the
pre-registered 20% signal, which is two of eight) have reproducible material
extraction failures in at least two independent source classes. A reproducible
case has extraction issues in at least two of its three runs. The case-level
threshold is primary; run-level prevalence is reported separately.

Decision meanings:

- **A — keep native `webfetch`** when no material reproducible extraction issue
  is observed.
- **B — keep native `webfetch` for Deep Research V1 and revisit later** when a
  limited or mild issue remains but the independent-case threshold is not met.
- **C — add bounded `fetch_evidence`** only when the threshold above is met.

## Run and analysis

Run the frozen supplemental workload in its own result file:

```sh
node benchmarks/retrieval-foundation/run.mjs \
  --cases extraction/cases.json \
  --out extraction/results/runs.jsonl \
  --label retrieval-extraction-stress \
  --fresh
```

The runner detects the installed OpenCode version once with
`opencode --version`, records it in every run, and `--fresh` truncates only the
selected `--out` file. It never clears the original `results/runs.jsonl`.

After manual case scoring:

```sh
node benchmarks/retrieval-foundation/extraction/analyze.mjs
```

The supplemental records retain compact target-matching excerpts from fetch
outputs, capped per tool event; they do not store raw page bodies or session
transcripts. Objective metrics include fetch output sizes, target-source
acquisition, target evidence matches, searches after target fetch, repeated
fetches, citations, token totals, and step pressure.

No `fetch_evidence`, Deep Research, `search_batch`, browser fallback, vector
store, provider router, or persistent evidence database is implemented by this
benchmark.
