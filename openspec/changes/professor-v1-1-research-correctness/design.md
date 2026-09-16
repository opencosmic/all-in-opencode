## Context

See `proposal.md` and `specs/research-correctness/spec.md` for the motivation
and observable contract. The current implementation has one persistent
ResearchState per run, a deterministic priority/FIFO frontier, one running
task, native retrieval hooks, JSON state plus JSONL events, and a canonical
Markdown report. Professor's agent definition currently has a 32-step outer
ceiling while the default state allows 30 controller rounds, so the runtime
does not provide a credible closure boundary for a research run.

## Goals / Non-Goals

**Goals:**

- Keep the single Professor controller and native `websearch`/`webfetch`
  boundary while making normal research capacity closure-aware.
- Make sufficient-question supersession and task terminal states durable and
  visible without treating skipped work as successful research.
- Make a non-failed task completion represent a canonical state change.
- Preserve source identity, citation identity, and source-local supporting span
  in bounded evidence records, with structural validation where possible.
- Make all four claim verdicts visible in completion metrics and uncertainty
  reporting, including non-critical reportable uncertainty.
- Load older state safely by filling new optional fields from deterministic
  defaults.

**Non-Goals:**

- No retrieval provider abstraction, batching, browser fallback, cache, vector
  store, embeddings, RAG, research sandbox, semantic entailment engine, worker
  agents, parallelism, model routing, or persistence migration.
- No attempt to decide natural-language atomicity with regexes or a second
  model. Atomicity is a prompt/contract requirement plus source/span and
  identity invariants.

## Decisions

### Use a small derived closure boundary

The existing 32-step Professor ceiling remains an emergency ceiling. State
normalization uses a deliberately conservative controller-round ceiling as the
fallback for hosts that do not expose outer-step events. When the OpenCode
host emits completed step parts, the plugin durably observes those parts and
the runtime gates further research from the actual outer-step count, retaining
the explicit completion reserve. Each budget exposes the outer limit, observed
usage, reserve, and remaining normal/closure capacity in the digest and
`research_next` response. When normal research capacity is consumed,
`research_next` records a bounded stopping reason and transitions to
verification. The runtime does not count web requests as controller rounds;
the Professor contract instead requires selective retrieval and early commits
so the reserve remains useful.

An explicit user-supplied controller budget is clamped to the same safe
ceiling for new runs, while old persisted budgets are normalized on load. This
keeps the advertised state budget from exceeding the execution model without
introducing a cost optimizer or changing native retrieval semantics.

### Make supersession a first-class terminal task state

`superseded` is added beside `pending`, `running`, `completed`, and `failed`.
Whenever a question becomes sufficient, pending tasks for it are marked
superseded with a timestamp and reason. The same sweep runs before frontier
selection and verification, and newly created work linked to an already
sufficient question is immediately superseded. Tasks created specifically to
resolve an independent critical claim or contradiction carry an internal
preserve marker and remain actionable even when their linked question is
sufficient. Superseded tasks remain in `state.json` and receive
`task.superseded` events, but the frontier and gap calculations only consider
actionable `pending` tasks.

### Gate commits on canonical result categories

`research_commit` validates whether the input causes a genuine canonical state
mutation: a new source or evidence record, finding, contradiction, follow-up,
criterion satisfaction, or contradiction update. Source and evidence inputs
are normalized against existing canonical records, so duplicate source/evidence
inputs, observed-URL-alias-only metadata updates, and unchanged updates do not
count. Question status bookkeeping alone is not criterion progress. A
summary-only commit is rejected unless the linked question is already
sufficient, in which case the running task is durably superseded. A caller that
genuinely has no result uses `failed: true` with a failure summary. The check is
based on canonical state changes, not text heuristics. Completion events record
the count of meaningful criterion mutations so lifecycle audits preserve that
dimension.

### Keep evidence structural and source-bounded

The persisted evidence shape remains intentionally small: one `fact`, one
`sourceId`/canonical `citationUrl`, one `supportingSpan`, a relation, and
qualifiers for scope such as date or version. Validation will require and
re-check the fact, span, qualifiers, source identity, and citation identity.
Digest and verification projections will include bounded fact/span/source
context so claims can bind to individual evidence records. The Professor
prompt will require one proposition per record and direct source-local support;
claims remain the place where multiple records can be synthesized.

### Derive claim accounting from canonical state

Claim counts are derived from the canonical claim array in benchmark state
snapshots, rather than trusting potentially stale completion metrics. A nested
`claimStatusCounts` object is added to metrics with lower-case keys matching
the four upper-case verdict values. Critical weak claims remain blockers under
the existing policy; non-critical weak claims remain completable but are added
to `remainingUncertainties` and the report limitations. Old metrics without
the nested object receive zeroed defaults and are safely recomputed on a later
completion.

## Risks / Trade-offs

- [Risk] A conservative controller ceiling can stop a legitimate large query
  early. → [Mitigation] Keep the bound explicit in state, preserve all pending
  work and uncertainty, and use a focused follow-up run; do not pretend the
  run is certain.
- [Risk] A host may not emit a usable outer-step event for every model step. →
  [Mitigation] Use the conservative controller fallback, expose observed
  capacity when available, and reinforce selective-retrieval/early-commit
  instructions; the 32-step ceiling remains an emergency stop.
- [Risk] Prompt compliance cannot prove natural-language evidence entailment.
  → [Mitigation] Enforce source identity/span structure, expose bounded
  records to verification, and leave semantic checking for a future
  evidence-backed change.
- [Risk] Existing callers that used summary-only completion will fail. →
  [Mitigation] Preserve the explicit failure path and add focused migration
  guidance in the tool description/tests; old persisted state still loads.

## Migration Plan

New runs write the additional budget, task, counter, and metrics fields. On
load, missing fields are filled in memory and validated without a database or
file migration. The next normal state save persists the normalized shape.
Existing completed reports remain readable through `research_report`. Rollback
is a feature-branch revert; no external schema or dependency needs rollback.
