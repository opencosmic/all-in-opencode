# Changelog

Notable changes to All-in OpenCode (`aio`) are documented here. Entries are
curated from the repository's implemented source and verified history rather
than generated from every commit.

## [Unreleased]

### Added

- Preserved the retrieval-foundation benchmark evidence and added deterministic
  benchmark validation.

### Changed

- Hardened benchmark reruns against inherited aio/OpenCode configuration and
  data-root overrides.

### Fixed

## [0.1.0] - 2026-09-14

The first stable private baseline for the current aio architecture and
verification workflow.

### Added

- A repository-owned agent, command, category, and skill workflow built around
  Assistant, Implementer, Planner, Executor, Verifier, and bounded specialist
  roles.
- A project-owned Delegation Runtime with category routing, bounded
  consultations, durable task state, conservative workspace preparation and
  release, and linked-worktree coordination.
- OpenSpec lifecycle integration with durable planning, execution, review,
  verification, and integration gates.
- Dedicated Browser, Blender, Producer, Searcher, and Professor routes,
  including video-analysis/watch provisioning and stateful research with
  evidence and report persistence.
- An optional OpenDesign capability using the public MCP resource boundary,
  plus public CodeGraph integration with scoped configuration and indexing.
- Narrow live-configuration installation, migration backups, frozen
  verification hashes, and a deterministic default-parallel integration suite.
- GitHub Actions CI for the hosted Node 24 environment, pinned OpenCode
  verification, CodeGraph setup, committed-patch checking, tests, and
  repository verification.

### Changed

- Established the All-in OpenCode (`aio`) namespace and canonical local
  repository layout while retaining explicit legacy compatibility contracts.
- Kept user-local category configuration, runtime data, credentials, and
  external tool state outside the tracked repository.

### Fixed

- Hardened test isolation and parallel OpenCode host coordination across
  linked worktrees.
- Hardened delegation completion, cancellation, workspace provenance, and
  safe cleanup behavior.
- Added portability checks for the GitHub-hosted runner and corrected CI to
  inspect committed patch formatting.
