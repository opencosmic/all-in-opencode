# Maintaining OpenCode Workflow

This guide is for anyone changing the canonical repository at `~/Workspace/repo/opencode-workflow`. It describes safe development of the configuration, not operation of a target project's workflow; for that, read [the user guide](docs/guides/using-the-workflow.md).

## Ownership and source model

- This repository is the canonical authored source for public-safe OpenCode agents, commands, plugins, tests, selected configuration, scripts, and documentation.
- [`scripts/links.tsv`](scripts/links.tsv) is the executable manifest for narrow live symlinks. Never maintain a second authored copy under `~/.config/opencode`.
- Local project data belongs under `${OPENCODE_WORKFLOW_DATA_ROOT:-$HOME/Workspace/data/opencode-workflow}`: `benchmarks/` for raw evidence and `backups/` for migration/configuration backups.
- `~/Workspace/repo/ego-lite` and `~/Workspace/repo/codegraph` are independent external benchmark targets. Do not copy them into this repository.
- OpenCode packages, sessions, caches, credentials, independent CodeGraph indexes, browser state, and global OpenSpec telemetry remain application- or user-owned local state.

## Normal maintenance sequence

```text
cd ~/Workspace/repo/opencode-workflow
  ↓
inspect Git state and read the relevant architecture/reference/research/decision docs
  ↓
make one coherent source change
  ↓
verify links/configuration and run deterministic tests
  ↓
inspect the complete diff
  ↓
commit the logical unit
```

Use the smallest relevant checks first, then the normal full validation:

```sh
./scripts/verify.sh
node --test ~/.config/opencode/tests/*.test.js
git diff --check
git diff
```

`scripts/verify.sh` validates live symlink targets and frozen production hashes. Deterministic tests exercise discovery, policy, plugin behavior, CodeGraph permissions, and workspace safety. Do not “fix” a verification mismatch by editing a live copy; inspect the manifest, source ownership, and backup first.

Keep commits atomic and descriptive. Review staged and unstaged diffs for unrelated local changes before committing. Do not rewrite history or push unless separately asked.

## Change-specific reading and validation

| Change type | Read first | Minimum extra care |
|---|---|---|
| Agent policy or permissions | [agents/commands reference](docs/reference/agents-and-commands.md), [invariants](docs/reference/invariants.md), relevant tests | Preserve role authority, read/write boundaries, and CodeGraph scope; update policy tests. |
| Command handoff/gate | [user guide](docs/guides/using-the-workflow.md), [invariants](docs/reference/invariants.md) | Preserve exact discovery names and fresh-review/verification gates. |
| Plugin/guard | [project map](docs/reference/project-map.md), plugin tests | Treat a plugin as runtime policy; test both permitted and denied paths. |
| Workspace/worktree logic | [architecture](docs/architecture.md), [invariants](docs/reference/invariants.md) | Preserve one canonical OpenSpec artifact directory and conservative cleanup. |
| CodeGraph policy/tool access | [CodeGraph research](docs/research/codegraph-integration.md), [decision](docs/decisions/planner-optimization.md) | Do not expand tools, indexes, or worker access from inference; new evidence is required. |
| OpenCode/CodeGraph version change | README prerequisites, architecture, research | Separate observed validation versions from hard requirements; revalidate actual runtime behavior. |
| Delegation Runtime or OpenCode public API change | [architecture](docs/architecture.md), delegation tests, installed public SDK types | Preserve the public-only boundary, completion invariant, one-shot resume, and conservative workspace ownership. |
| Documentation only | [docs index](docs/README.md) | Keep one responsibility per document; link to source instead of duplicating it. |

## When documentation changes

Update documentation in the same logical change when you alter a user-visible workflow route, ownership boundary, invariant, setup/recovery procedure, or final engineering decision. Prefer the document whose responsibility already matches the fact:

- daily operation → `docs/guides/`;
- source ownership/navigation → `docs/reference/`;
- architecture rationale → `docs/architecture.md`;
- durable experiment summary → `docs/research/`;
- final engineering choice → `docs/decisions/`;
- maintenance and recovery → this file or `docs/troubleshooting.md`.

## When benchmarking is justified

Benchmark when a change could materially affect retrieval behavior, token/context economics, model/tool policy, role boundaries, CodeGraph use, correctness/coverage trade-offs, or orchestration behavior that deterministic tests cannot establish.

Do not benchmark routine documentation corrections, formatting-only edits, or deterministic changes already adequately covered by tests unless the actual risk warrants it. A benchmark is evidence—not a new runtime state machine or a reason to weaken safety boundaries.

## Research hygiene

```text
raw evidence        -> $OPENCODE_WORKFLOW_DATA_ROOT/benchmarks/
summarized learning -> docs/research/
final decisions     -> docs/decisions/
```

Keep raw sessions, telemetry, indexes, benchmark worktrees, and checksums local. Do not commit them, use them as runtime workflow state, or recreate `~/.config/opencode/benchmarks`. Use a frozen protocol/manifest/report/decision/checksum to summarize a result, classify invalid experiments as invalid, and preserve uncertainty. Create a decision record only for a final engineering choice that should constrain future work; otherwise record validated or rejected results in research.

## Recovery and upgrades

Before a live-link repair, inspect the manifest, target, source, and relevant backup. `scripts/install.sh --dry-run` shows intended links; a real installation creates timestamped backups under `$OPENCODE_WORKFLOW_DATA_ROOT/backups/migrations`. Repair the smallest affected surface and rerun verification—do not delete broad runtime directories, package state, indexes, or backups casually.

For dependency upgrades, update only the intended canonical metadata/configuration, install validation dependencies as needed with `npm ci --prefix opencode`, then verify actual discovery and deterministic policy behavior. Treat OpenCode and CodeGraph version changes as behavior-sensitive: record what was validated and benchmark only if deterministic checks cannot answer a material trade-off.
