# Native OpenCode + Exa retrieval foundation evaluation

## Original decision before supplemental stress evaluation

**C — Add only `fetch_evidence` as the next shared-retrieval capability.**

Native OpenCode `websearch` plus `webfetch` is already good enough for the
current Searcher and for the first retrieval layer of a future Deep Research
agent. The benchmark found one concrete, repeated gap: long normative pages
are fetched as large page bodies rather than bounded, query-aware evidence
passages. In the representative ECMAScript case, two of three runs reached
Searcher’s six-step boundary and one also recorded a failed fetch.

This is not a reason to change Searcher V1 now. The smallest justified next
capability is a thin `fetch_evidence` helper for future Deep Research, with a
bounded passage/anchor request and normalized source metadata. It should not
own research planning, state, gap analysis, stopping, synthesis, or a
persistent knowledge store.

This section preserves the original 24-case evaluation conclusion. The targeted
supplemental extraction stress evaluation and its updated decision are recorded
below; it does not rewrite the original run evidence.

## Repository and baseline

- Base: `main` at `9e91fe032e7e48d4c440b0d7081c2a02f0819fac`.
- Evaluation branch: `eval/retrieval-foundation`.
- Evaluation worktree: `../opencode-workflow-retrieval-eval`.
- OpenCode CLI: `1.18.30`.
- Searcher production files, prompt, permissions, `steps: 6`, `/search`, and
  Exa configuration were not changed.

Searcher remains a read-only primary route using native `websearch`/
`websearch_*` and `webfetch`. Researcher and Librarian remain separate
specialists. No Deep Research agent or production Search Core was implemented.

## Runtime isolation

The installed CLI help verified `opencode run --format json`, including raw
JSON event output. `opencode debug paths` verified that `XDG_CONFIG_HOME`
changes the config root, and `OPENCODE_CONFIG` was verified by pointing it at
the worktree's `opencode/opencode.jsonc` and observing the resolved config.

Each run used:

```text
XDG_CONFIG_HOME=<temporary directory>
OPENCODE_CONFIG=<worktree>/opencode/opencode.jsonc
opencode run --agent Searcher --dir <worktree> --format json <query>
```

The temporary config contained symlinks to the worktree's agents, commands,
plugins, categories, and TUI files. The canonical `~/.config/opencode` links
were never repointed. The runtime smoke record exposed the native websearch
tool output with `metadata.provider: "exa"`, confirming the configured Exa
path. Authentication, cache, and OpenCode state remained outside Git.

## Methodology

`benchmarks/retrieval-foundation/cases.json` was frozen before live execution.
It contains 24 cases across ten categories:

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

Six representative cases were run three times total: simple, current,
comparison, multi-aspect, stale/conflicting, and fetch-heavy. The workload was
therefore 36 sequential Searcher runs. Cases were not edited after observing
failures. The benchmark crossed the local date boundary during execution;
each normalized record retains its run timestamps and the current/fresh cases
are evaluated against the dated source evidence returned during that run.

The harness parses OpenCode JSONL events and stores compact records containing
case/run identity, timestamps, duration, search and fetch inputs, URLs/domains,
source titles, citations, step finishes, token totals, answer text, and errors.
It does not commit raw page bodies or full session transcripts.

## Quality results

Scores use the pre-registered 0–5 rubric in `benchmarks/retrieval-foundation/
rubric.md`. The quality pass rule is correctness, coverage, and citation
grounding at least 4; source quality at least 3; and freshness at least 4 when
required. Subjective scores retain evidence notes in `results/scores.json`.

| Category | Passing cases | Baseline/runtime result |
|---|---:|---|
| Simple factual retrieval | 3/3 | 5/5 runs successful |
| Exact first-party detail | 3/3 | 3/3 successful |
| Current/fresh information | 3/3 | 5/5 successful |
| Comparison | 3/3 | 5/5 successful |
| Multi-aspect informational | 3/3 | 5/5 successful |
| Stale/conflicting information | 3/3 | 5/5 successful |
| Community/user experience | 2/2 | 2/2 successful |
| Fetch-heavy/document detail | 2/2 | 3/4 successful; one fetch error in a repeat |
| Ambiguous/context behavior | 1/1 | 1/1 successful |
| Retrieval robustness | 1/1 | 1/1 successful |
| **Total** | **24/24** | **35/36 clean runs** |

Mean evaluator scores across the 24 baseline cases were:

```text
correctness          4.88
coverage              5.00
citation grounding   4.83
source quality       4.79
freshness             4.86  (freshness-required cases)
retrieval efficiency  3.75  (reported separately, not a quality gate)
```

The quality pass rate is not the whole result: three case-level signals were
recorded. Two were search-orchestration overhead signals and one was the
fetch-extraction signal described below. No case was primarily classified as
search-provider, model-reasoning, freshness, citation, prompt-policy, or
invalid-case failure.

## Objective retrieval results

| Metric | Result |
|---|---:|
| Total runs | 36 |
| Clean runtime runs | 35 |
| Runs with a tool/runtime error | 1 |
| Total native websearch calls | 78 |
| Total native webfetch calls | 61 |
| Search calls per run | 1–5; 16 runs used 1, 5 used 2, 9 used 3, 5 used 4, 1 used 5 |
| Fetch calls per run | 0–5; 10 runs used 0 |
| Fetch/search ratio | 0.78 |
| Steps per run | 2–6; mean 3.22 |
| Runs at the six-step boundary | 2/36 (5.6%) |
| Unique retrieved URLs across runs | 1,810 |
| Unique retrieved domains across runs | 228 |
| Same-run duplicate search-result occurrences | 78 |
| Runs with same-run duplicate search URLs | 15/36 (41.7%) |
| Duplicate search URL occurrences / search-result URLs | 7.7% |

The cross-run duplicate count is 610, but it intentionally includes expected
repetition from the six three-run variance cases and is not used as the
architecture signal. The more relevant same-run duplicate signal was
concentrated in comparison and conflict cases: all three `comparison-01`
repeats had overlapping npm/pnpm URLs, and all three `conflict-01` repeats had
overlapping React/CRA URLs. This created measurable context overhead but no
quality failure or baseline step-cap failure.

Official-source questions legitimately concentrated domains: for example,
the GitHub matrix-limit case used one official domain, while broad comparison
and community cases reached roughly 15–18 unique search domains per run. Domain
concentration was therefore query-dependent, not evidence that Exa was
systematically unusable or biased toward one source.

## Failure matrix

The matrix reports the baseline run for each case. Repeat-only failures are
called out in the key issue column.

| Case | Category | Pass | Root cause | Search | Fetch | Step cap | Key issue |
|---|---|---:|---|---:|---:|---:|---|
| simple-01 | simple | Yes | — | 1 | 0 | No | Direct Tokyo answer; one citation |
| simple-02 | simple | Yes | — | 1 | 0 | No | MDN-backed 404 explanation |
| simple-03 | simple | Yes | — | 1 | 0 | No | 1991 public-release answer |
| first-party-01 | exact | Yes | — | 1 | 1 | No | Official TypeScript detail isolated |
| first-party-02 | exact | Yes | — | 1 | 1 | No | GitHub 256-job limit plus caveat |
| first-party-03 | exact | Yes | — | 1 | 2 | No | npm lockfile/node_modules distinction |
| current-01 | current | Yes | — | 1 | 1 | No | Node v26 date/current-vs-LTS distinction |
| current-02 | current | Yes | — | 1 | 3 | No | TypeScript version triangulation |
| current-03 | current | Yes | — | 1 | 2 | No | Python release-line distinction |
| comparison-01 | comparison | Yes | SEARCH_ORCHESTRATION | 4 | 3 | No | Repeated npm/pnpm URLs across all repeats |
| comparison-02 | comparison | Yes | — | 3 | 5 | No | Complete GitHub/GitLab comparison |
| comparison-03 | comparison | Yes | SEARCH_ORCHESTRATION | 5 | 2 | No | High fan-out and one malformed citation |
| multi-01 | multi-aspect | Yes | — | 4 | 3 | No | Complete Node 24 three-dimensional answer |
| multi-02 | multi-aspect | Yes | — | 3 | 3 | No | Pricing/concurrency/retention covered |
| multi-03 | multi-aspect | Yes | — | 3 | 5 | No | PostgreSQL 17 versioned evidence |
| conflict-01 | stale/conflict | Yes | — | 2 | 0 | No | CRA legacy guidance resolved |
| conflict-02 | stale/conflict | Yes | — | 2 | 2 | No | Node 22 watch status resolved |
| conflict-03 | stale/conflict | Yes | — | 1 | 0 | No | GitHub main/master caveat resolved |
| community-01 | community | Yes | — | 3 | 0 | No | Official migration facts separated from anecdotes |
| community-02 | community | Yes | — | 3 | 1 | No | Supabase requirements separated from user reports |
| fetch-01 | fetch-heavy | Yes | FETCH_EXTRACTION | 1 | 3 | No | Baseline good; 2/3 repeats hit six-step boundary |
| fetch-02 | fetch-heavy | Yes | — | 1 | 1 | No | Git rebase graph extracted successfully |
| ambiguous-01 | context | Yes | — | 3 | 1 | No | Node 22 context honored and bounded |
| robustness-01 | robustness | Yes | — | 1 | 1 | No | Official Astral fallback methods returned; inaccessible branch not exercised |

## Variance

| Representative case | Classification | Evidence |
|---|---|---|
| simple-01 | Stable | 3/3 used one search and two steps; same direct answer/citation. |
| current-01 | Minor variance | 1, 3, and 1 searches; all three preserved current-vs-LTS/date distinctions. |
| comparison-01 | Stable quality, structural overhead | 4 searches in every run; duplicate npm/pnpm URLs in all three. |
| multi-01 | Stable | 3–4 searches and 3 fetches; all three covered all dimensions with official sources. |
| conflict-01 | Stable | Two searches in every run; all three resolved current React guidance over CRA tutorials. |
| fetch-01 | Material variance | Baseline used 1 search/3 fetches and was complete; repeats used 3/3 and 2/4 search/fetch calls, both hit 6 steps, and the latter had a fetch error plus an incomplete answer. |

The last row is the important variance finding. It is systematic within the
same fetch-heavy case, not a one-off isolated bad answer, while the other five
representative cases remained quality-stable.

## Root-cause analysis

### Retrieval provider

Native Exa-backed search returned relevant, varied sources across official
documentation, release pages, specifications, GitHub, Reddit, and community
discussion. There were no empty-search or websearch provider failures in the
36 records. Search-provider replacement is not justified.

### Search orchestration

Search fan-out and repeated URLs are real optimization signals. Complex cases
used up to five search calls, and 15/36 runs had at least one same-run duplicate
search URL. However, the answer quality remained high, no baseline case hit the
step cap, and duplicate results were usually predictable overlap between
related official queries. This does not justify a production `search_batch`
API yet. It is worth reevaluating when Deep Research needs parallel query
planning at larger scale.

### Fetch/extraction

This is the only material retrieval-foundation gap. The ECMAScript case's
normative page produced an approximately 51K-character native fetch output.
The baseline run eventually used the official anchor/proposal evidence and
answered correctly. Two of three repeats reached all six steps; one recorded
an error fetching an alternate 262.ecma-international.org URL and stopped with
an incomplete summary. The problem is not that the provider could not find the
specification. It is that native fetch did not reliably return a bounded,
query-relevant passage, which increased model work and exposed the step cap.

### Model, source, citation, and freshness behavior

Minor source/citation looseness in `comparison-03` is a model/output quality
issue, not proof that native retrieval is insufficient. Current and stale
cases consistently selected dated/versioned first-party pages and explained
conflicts. Community cases used community evidence without treating it as
official fact. No recurring model-reasoning, freshness, or citation failure
justifies retrieval infrastructure.

### Tool runtime and browser fallback

There was one fetch error in a repeat, but the alternate official TC39 proposal
and current spec paths were available. No recurring JS-only or inaccessible
source class was demonstrated. Ego Browser/browser fallback is not justified.

## Future Deep Research requirements

Deep Research will still need a planner, research state, iterative gap
analysis, verification, stop criteria, and report synthesis. Those are
orchestration/state responsibilities and should not be put into Search Core.

Shared retrieval responsibilities should remain narrow:

| Capability | Evidence | Decision |
|---|---|---|
| Multi-query batching | Up to five native searches and 15/36 runs with duplicate result URLs, but no quality or baseline step failure | Defer `search_batch`; remeasure at larger Deep Research scale |
| Result normalization | JSON events expose inputs, output, URLs, domains, titles, and provider metadata | Deep Research can normalize at its state boundary initially |
| URL/domain deduplication | 7.7% same-run duplicate URL occurrence rate; concentrated in predictable multi-query cases | Do not build a dedicated dedup service yet |
| Domain diversity | Broad cases used many domains; official cases concentrated appropriately | Native retrieval is sufficient |
| Fetch/evidence extraction | 2/3 repeated fetch-heavy spec runs hit six steps; large 51K-character page output and one fetch error | **Add only `fetch_evidence` next** |
| Stable evidence IDs | Useful for claim/evidence/citation relationships over many rounds | Assign in Deep Research `ResearchState`; not a persistent Search Core database |
| Browser fallback | No recurring high-value inaccessible/JS-only class | Do not add |

## Minimal recommended capability

The next implementation should be a small `fetch_evidence` operation, not a
new agent or crawler. Its minimum contract should accept:

```text
url
optional query/anchor/section hint
bounded output limit
```

and return:

```text
canonical URL
title/domain/provider/date when observable
bounded relevant passage(s)
extraction status and uncertainty
session-local evidence ID
```

It should preserve the source URL for citation, avoid pretending that an
extracted passage is the whole page, and fail with useful evidence when the
requested section cannot be isolated. It should not own search planning,
multi-round research state, citation graph persistence, or synthesis.

## Explicitly rejected complexity

This evaluation does not justify:

- a `search_batch` production API yet;
- a vector database, knowledge graph, or persistent search database;
- a multi-provider router, crawler farm, or agent swarm;
- browser automation as a default retrieval fallback;
- Deep Research planner/state/gap-analysis logic inside Search Core;
- changing Searcher prompts, permissions, steps, or `/search` behavior.

## Verification

The deterministic harness test passed 4/4 tests. The focused production
contract checks also passed from this clean evaluation worktree:

```sh
node --test opencode/tests/searcher-agent-integration.test.js
OPENCODE_DISCOVERY_ROOT="$PWD/opencode" node --test opencode/tests/workflow-discovery.test.js
node --test opencode/tests/workflow-agent-policy.test.js
node --test opencode/tests/zero-omo-policy.test.js
```

The wider `node --test opencode/tests/*.test.js` sweep was attempted but is not
an evaluation result: this fresh worktree has no `opencode/node_modules`, so
delegation tests that import `@opencode-ai/plugin` fail to load, and one host
integration test waits on that missing runtime. The sweep also includes
workflow-discovery assertions for files that exist only on the user's dirty
consultation branch, not on the committed `main` baseline evaluated here.

The committed normalized artifacts are:

```text
benchmarks/retrieval-foundation/cases.json
benchmarks/retrieval-foundation/rubric.md
benchmarks/retrieval-foundation/lib.mjs
benchmarks/retrieval-foundation/run.mjs
benchmarks/retrieval-foundation/analyze.mjs
benchmarks/retrieval-foundation/harness.test.mjs
benchmarks/retrieval-foundation/results/runs.jsonl
benchmarks/retrieval-foundation/results/scores.json
benchmarks/retrieval-foundation/results/summary.json
```

No raw web pages, credentials, node_modules, or OpenCode session caches are
committed.

Based on the measured evidence, the next recommended implementation is:

> Add only a thin, bounded `fetch_evidence` capability for future Deep
> Research; keep Searcher on native OpenCode + Exa and defer all other shared
> retrieval infrastructure until a larger benchmark demonstrates a separate
> need.

## Supplemental Extraction Stress Evaluation

### Purpose and scope

The original evaluation found a reproducible long-ECMAScript-document problem,
but its evidence did not establish the pre-registered prevalence signal for a
new shared retrieval capability. This supplemental benchmark tests that narrow
hypothesis across eight independent document/source patterns. It does not
remeasure generic Searcher quality, change the Searcher prompt or six-step
limit, add `search_batch`, or implement `fetch_evidence`.

The frozen cases are in
`benchmarks/retrieval-foundation/extraction/cases.json`; their result set is
separate from the original `results/runs.jsonl`, `scores.json`, and
`summary.json`.

### Harness corrections made before the live run

- `--fresh` now truncates only the selected `--out` JSONL result file. The
  original baseline output is not touched when the supplemental output is
  selected.
- The runner resolves the installed runtime once with `opencode --version`,
  fails if the version cannot be parsed, and records it per run. The 24-run
  supplemental set used OpenCode `1.18.30`.
- Citation and source URLs now remove presentation punctuation such as
  backticks, unmatched Markdown delimiters, commas, periods, semicolons, and
  colons without changing balanced URL characters. Source matching also
  recognizes equivalent format/version/anchor variants for extraction metrics.
- Score validation now requires exactly one score for every expected case and
  rejects missing, duplicate, or unknown case IDs.
- Normalized supplemental records preserve bounded matcher-based evidence
  excerpts and tool sequence numbers, not raw page bodies or transcripts.

The deterministic harness passed 9/9 tests, including version parsing,
scoped fresh output, URL normalization, score completeness, supplemental case
loading, extraction aggregation, and the case-level decision rule. Re-running
the original analyzer against the preserved 36-run result set produced the
same summary semantics; only its generated timestamp differed.

### Frozen workload and decision rule

The supplemental workload contains 8 cases × 3 runs = 24 runs:

| Case | Source class | Extraction target |
|---|---|---|
| `standard-rfc-01` | Standard/specification | RFC 9110 §15.5.17 416/Content-Range rule |
| `api-node-http-01` | Official API documentation | Node.js `server.maxRequestsPerSocket` |
| `manual-postgres-17-01` | Versioned technical manual | PostgreSQL 17 concurrent-index restrictions |
| `table-iana-status-01` | Long table | IANA status-code row 425 |
| `paper-attention-01` | Research paper | *Attention Is All You Need* Section 4/Table 1 |
| `policy-gdpr-17-01` | Government/regulatory policy | GDPR Article 17(3)(b) |
| `changelog-node-22-01` | Long release history | Node.js v22.5.0 `node:sqlite` entry |
| `negative-git-rebase-01` | Long-document negative control | Git `rebase --onto` graph example |

The pre-registered rule counts a `FETCH_EXTRACTION` failure only when the
expected source was found, native fetch retrieved it, the target evidence was
present, and the workflow materially struggled to isolate or use it. Model
reasoning mistakes, wrong search results, genuinely missing source content,
and tool/runtime anomalies are kept separate. A case is reproducible when at
least two of its three runs show the material extraction issue.

`fetch_evidence` is justified only when at least 2 of 8 valid cases (the
20%-or-more case-level signal) show reproducible material extraction failures
from at least 2 independent source classes. Case-level prevalence is primary;
run-level prevalence is reported separately.

### Supplemental results

All 24 runs exited cleanly with no recorded tool error. Objective extraction
observations were:

| Metric | Result |
|---|---:|
| Runs | 24 |
| Clean/tool-error-free runs | 24 |
| Native search calls | 30 |
| Native fetch calls | 47 |
| Fetch output characters | 1,667,312 |
| Fetch output size (min / median / p90 / max) | 0 / 40,801 / 51,401 / 51,469 |
| Searches after target fetch | 8 |
| Repeated fetches of the same canonical document | 5 |
| Six-step boundary runs | 3/24 (12.5%) |
| Run-level extraction issues | 2/24 (8.3%) |
| Case-level extraction issues | 1/8 (12.5%) |
| Reproducible failing source classes | 1 |

Mean extraction-specific scores were passage localization **4.50**, evidence
precision **4.63**, and extraction efficiency **3.50**.

| Case | Runs | Extraction issue | Reproducible | Key observation |
|---|---:|---|---|---|
| `standard-rfc-01` | 3 | Yes, 2/3 | Yes | 40–51K-character RFC fetches; repeated navigation; 2/3 step-boundary runs; one weakened `SHOULD` to `MUST`. |
| `api-node-http-01` | 3 | No | No | Exact API entry recovered every run; equivalent-page refetches but no step pressure or answer harm. |
| `manual-postgres-17-01` | 3 | No | No | One 31K-character versioned manual fetch per run; complete precise answers. |
| `table-iana-status-01` | 3 | No | No | Exact table row recovered from XHTML/TXT variants in one fetch per run. |
| `paper-attention-01` | 3 | No | No | Exact Section 4/Table 1 evidence recovered; one equivalent-paper refetch. |
| `policy-gdpr-17-01` | 3 | No | No | Two runs had completed fetches with zero output characters, but final clauses remained exact; tracked as tool reliability, not extraction failure. |
| `changelog-node-22-01` | 3 | No | No | Three searches/four fetches each; one step-boundary run, but alternate official release/API pages supplied the exact answer. |
| `negative-git-rebase-01` | 3 | No | No | 51K-character page handled in 2–3 steps with one fetch and precise graph evidence each run. |

The RFC result is a real, reproducible extraction problem, but it is one valid
case from one source class. The changelog case demonstrates structural
overhead and one step-boundary run without material answer failure. The GDPR
empty-output runs are a separate tool-reliability observation. The negative
control remained stable despite a similarly long page.

### Root causes

- `FETCH_EXTRACTION`: `standard-rfc-01` only. The correct source was found and
  fetched, but large unbounded document output caused repeated fetch/navigation
  work and step-boundary pressure in 2/3 runs.
- `SEARCH_ORCHESTRATION`: observed overhead in the Node API, research-paper,
  and changelog cases; it did not cause a qualifying case-level extraction
  failure. The changelog used 3 searches and 4 fetches in each run.
- `MODEL_REASONING`: one RFC repeat changed the normative `SHOULD` to `MUST`
  after step pressure. This is recorded as a secondary observation, not as a
  provider or new retrieval capability failure.
- `TOOL_RUNTIME`: two GDPR runs returned zero-character completed fetches.
  Because the final answers still quoted the exact clause and no process/tool
  error was reported, this did not qualify as `FETCH_EXTRACTION`.
- `BROWSER_ACCESS`: none observed.
- `CASE_INVALID`: none observed.

### Decision update

The original **Decision C** is **downgraded** by this supplemental evidence;
it is no longer a recommendation to implement the helper now.

**Updated decision: B — keep native `webfetch` for Deep Research V1 and revisit
later.**

The measured case-level extraction failure rate was **1/8 = 12.5%**, below the
pre-registered 20% threshold, and only **one independent source class** showed
a reproducible material failure. The original ECMAScript result and this RFC
result justify continued monitoring of long normative documents, but the API,
versioned manual, table, research paper, policy, changelog, and negative-control
cases do not establish a cross-source-class need for shared extraction
infrastructure.

Therefore no `fetch_evidence` implementation is justified yet. Revisit after a
larger benchmark or when Deep Research produces a second independent source
class with reproducible material extraction failures.

No evidence from this supplemental run justifies `search_batch`, provider
replacement, browser fallback, vector/embedding retrieval, persistent
evidence storage, or multi-agent retrieval. Searcher production behavior and
the original benchmark evidence remain unchanged.
