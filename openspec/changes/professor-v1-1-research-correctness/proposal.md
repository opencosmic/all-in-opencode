## Why

The frozen Professor V1 blind benchmark confirmed a real boundedness failure: a contradiction/version research run reached verification only after a large number of fetches and timed out before a report was completed. The runtime also permits redundant pending work, summary-only completed tasks, broad evidence records, and completion metadata that can hide reportable weak claims, so V1.1 is needed before adding deeper research capabilities.

## What Changes

- Coordinate the normal ResearchState research budget with Professor's outer execution capacity, expose remaining/closure capacity, and preserve room for evidence commits, verification, and report completion.
- Mark pending tasks whose linked questions are already sufficient as `superseded`, persist the transition in events, and exclude them from actionable frontier selection and gap calculations.
- Require a meaningful canonical research result for a completed task; route already-sufficient work to supersession and genuine no-result retrieval failures to failure.
- Tighten the source-bounded evidence contract and validation so each evidence record remains a bounded proposition tied to one canonical source and supporting span/context.
- Add deterministic claim-status counts and include reportable partial, unsupported, and contradicted claims in completion uncertainty accounting without forcing allowed uncertainty to become a blocker.
- Update Professor's research contract and benchmark infrastructure while preserving native retrieval, durable files, deny-by-default permissions, and single-controller orchestration.

## Capabilities

### New Capabilities

- `research-correctness`: bounded, auditable, source-bounded Professor research with honest completion accounting

### Modified Capabilities

None. The repository has no existing OpenSpec capability specifications; this change introduces the first behavior contract for the Professor research correctness boundary.

## Impact

Affected implementation includes the Professor agent contract, Professor runtime entrypoint, ResearchState validation/defaults/frontier and persistence behavior, runtime scheduling/commit/verification/completion metrics, focused tests, and the new Professor quality benchmark. No new runtime dependency, retrieval abstraction, worker agent, browser capability, database, or persistence migration is introduced.
