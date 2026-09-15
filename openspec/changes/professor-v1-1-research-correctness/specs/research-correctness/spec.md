## Purpose

This capability keeps single-controller Professor research bounded, auditable, source-bounded, and honest about the evidence and claim uncertainty that remains at completion.

## ADDED Requirements

### Requirement: Research stays within a bounded closure-aware execution budget

Professor research MUST expose a deterministic normal research bound and remaining capacity that leaves an explicit closure reserve for committing current work, verifying claims, and completing the report. The outer agent limit MUST act as an emergency ceiling rather than the expected normal stopping mechanism. When the safe research boundary is reached, the runtime MUST stop selecting additional retrieval work and move the run toward verification with the remaining gaps visible.

#### Scenario: Frontier reaches the safe research boundary

- **WHEN** the configured normal research capacity has been consumed while closure capacity remains reserved
- **THEN** the next scheduling call returns no research task, records the bounded stopping reason, and enters verification without claiming that unresolved questions are supported

#### Scenario: Capacity is visible before another task is selected

- **WHEN** a run has remaining controller capacity
- **THEN** the scheduling response and durable state expose enough remaining-capacity information for Professor to choose closure over an unnecessary deep retrieval branch

#### Scenario: Host outer-step usage is observable

- **WHEN** the OpenCode host emits a completed outer-step event for a bound Professor session
- **THEN** the runtime records that usage once, exposes observed and remaining outer-step capacity, and stops selecting new research when the completion reserve would otherwise be consumed

### Requirement: Sufficient questions supersede redundant pending tasks

When a question's required criteria are satisfied by same-question evidence, all redundant pending tasks linked to that question MUST become auditable `superseded` tasks. A task explicitly created to resolve a separate critical claim or contradiction MAY remain actionable until that blocker is resolved. Superseded tasks MUST NOT be returned as actionable work, counted as unresolved gaps, or treated as successful research completions.

#### Scenario: Evidence makes another pending task unnecessary

- **WHEN** a research commit makes a question sufficient and another task for that question is pending
- **THEN** the other task is persisted as `superseded`, a supersession event records why, and `research_next` skips it

#### Scenario: Superseded work remains auditable

- **WHEN** a caller reads the durable state or event history after supersession
- **THEN** the task and its terminal status remain visible without appearing in the actionable frontier

### Requirement: Completed tasks represent canonical research progress

A task MUST NOT be marked completed from a summary alone. A normal completed task MUST cause a genuine canonical ResearchState mutation, such as adding a new source, new evidence record, finding, contradiction, follow-up, or meaningful criterion/contradiction update. Duplicate or normalized no-op inputs MUST NOT count as progress. Already-sufficient no-result work MUST use supersession, and retrieval that genuinely yields no result MUST use the failure state with a failure summary.

#### Scenario: Meaningful task commit completes

- **WHEN** a running task commits a valid source, evidence, finding, contradiction, follow-up, or criterion update
- **THEN** the task becomes `completed` and the canonical result plus task event are durable

#### Scenario: Empty successful completion is rejected

- **WHEN** a running task submits only a summary and no canonical research result
- **THEN** the runtime rejects the commit and leaves the task running for a corrected commit or explicit failure

#### Scenario: Normalized duplicate input is rejected

- **WHEN** a running task submits only an already-canonical source or evidence record, unchanged coverage/contradiction state, or follow-up requests that cannot be created
- **THEN** the runtime records no successful completion and leaves the task running unless the linked question is already sufficient, in which case it uses supersession

#### Scenario: Observed URL alias is not task progress

- **WHEN** a running task submits only a raw URL alias that canonicalizes to an existing source and would add metadata to `observedUrls`
- **THEN** the alias may remain useful source metadata, but it does not count as a new canonical source and cannot by itself complete the task

#### Scenario: Failed no-result work is explicit

- **WHEN** retrieval or evidence collection genuinely cannot produce a result and the caller supplies a failure summary
- **THEN** the task becomes `failed`, remains auditable, and is not counted as completed research

### Requirement: Evidence is bounded to one source and one proposition

Each evidence record MUST contain one bounded proposition, an explicit canonical source identity, a citation URL identifying that source, and a non-empty supporting span or precise source-local context. A record MUST NOT combine independent propositions from multiple sources; claims MAY synthesize multiple evidence records.

#### Scenario: Source-bounded evidence is accepted

- **WHEN** an evidence record identifies one declared source and supplies a bounded fact plus supporting span/context
- **THEN** the runtime persists the source identity, citation URL, fact, supporting span/context, and relation as one evidence record

#### Scenario: Invalid source-bounded structure is rejected

- **WHEN** an evidence record omits its source identity or supporting span/context, or its citation URL identifies a different canonical document
- **THEN** the runtime rejects the commit without persisting the invalid evidence

### Requirement: Completion metadata accounts for every claim verification status

Completed ResearchState metrics MUST include deterministic counts for `SUPPORTED`, `PARTIAL`, `UNSUPPORTED`, and `CONTRADICTED` claims using the project's canonical machine-readable names. Remaining uncertainty MUST include reportable non-supported claims even when no critical blocker remains. Non-critical accepted uncertainty MAY still complete when the existing completion policy permits it, but metadata MUST NOT imply zero uncertainty while such claims exist.

#### Scenario: All claim statuses are counted

- **WHEN** verification records supported, partial, unsupported, and contradicted claims
- **THEN** completion metrics report the corresponding four counts and preserve the claims' statuses

#### Scenario: Allowed weak claim remains visible

- **WHEN** a non-critical partial, unsupported, or contradicted claim does not block completion
- **THEN** the run may complete according to the existing policy, but its claim status and uncertainty appear in durable completion metadata and the report limitations

#### Scenario: Older state remains loadable

- **WHEN** an older persisted state lacks the new claim-count or closure-capacity fields
- **THEN** the runtime supplies safe defaults, validates the state, and loads it without requiring a migration
