# OpenCode Workflow

This repository is the canonical authored source for a custom OpenCode workflow built on Oh My OpenAgent (OMO) and OpenSpec. It keeps workflow policy, agent definitions, commands, plugins, deterministic tests, and public-safe configuration reviewable in Git while leaving credentials, caches, sessions, benchmarks, and provisioned runtimes local.

No software license has been selected for this repository.

## Workflow

The custom lifecycle is:

```text
/spec -> /plan -> /execute -> /verify -> /ship
```

`/omo` is a separate route from an approved product strategy to OMO's native Prometheus planner.

- Strategist owns product intent and creates the OpenSpec proposal and behavioral specs.
- Planner creates `design.md` and `tasks.md` from the approved contract.
- Plan Reviewer independently reviews those planning artifacts.
- Executor orchestrates implementation through OMO workers.
- Reviewer, QA, and Verifier provide independent code, runtime, and final evidence.
- Researcher and Validator support product discovery and validation.

`tasks.md` is the only durable custom execution-progress state. OMO remains the owner of its native runtime state, and CodeGraph remains OMO-owned derived structural evidence.

## CodeGraph policy

The custom tool surface is deliberately limited to `codegraph_codegraph_explore`. Planner, Plan Reviewer, Executor, Reviewer, and Verifier may use it as bounded structural evidence. Strategist, Researcher, Validator, and QA do not receive a CodeGraph rollout. The workflow does not provision CodeGraph, own its indexes, or create another CodeGraph lifecycle.

## Repository layout

- `opencode/agents/`: custom agent definitions.
- `opencode/commands/`: `/omo`, `/spec`, `/plan`, `/execute`, `/verify`, and `/ship`.
- `opencode/plugins/`: workflow guard and read-only workspace inspection plugins.
- `opencode/tests/`: deterministic policy and integration tests.
- `opencode/opencode.jsonc` and `opencode/tui.json`: public-safe OpenCode configuration.
- `opencode/package.json` and `opencode/package-lock.json`: pinned plugin API dependency metadata.
- `omo/omo.jsonc`: public-safe authored OMO configuration only.
- `scripts/`: explicit, conservative link installation and verification.
- `docs/`: architecture and durable engineering decisions.

The global OpenSpec file at `~/.config/openspec/config.json` is not included: the current file contains local telemetry identity/state, not authored workflow policy. Project-specific OpenSpec artifacts continue to live in each target project. OpenCode's live package manifest, lockfile, and installed `node_modules` also remain local package-manager state; the repository's dependency metadata supports validation from a clone but is not linked over those live files.

## Local data ownership

Authored source belongs in this Git repository. Project-owned data that must remain local belongs under `${OPENCODE_WORKFLOW_DATA_ROOT:-$HOME/Workspace/data/opencode-workflow}`:

- benchmark evidence: `${OPENCODE_WORKFLOW_DATA_ROOT:-$HOME/Workspace/data/opencode-workflow}/benchmarks/<experiment-id>`;
- configuration and migration backups: `${OPENCODE_WORKFLOW_DATA_ROOT:-$HOME/Workspace/data/opencode-workflow}/backups/`.

The environment variable is optional; without it, the default is `~/Workspace/data/opencode-workflow`. Future benchmark and backup work must use this data root directly and must not recreate `~/.config/opencode/benchmarks` or `~/.config/opencode/backups`.

The live application roots remain `~/.config/opencode`, `~/.config/openspec`, and `~/.omo`. They contain only canonical source entrypoints and application-owned local state. OMO runtime and CodeGraph indexes remain under `~/.omo`; OpenSpec's private telemetry configuration remains under `~/.config/openspec`; runtime dependencies remain where OpenCode requires them. The external `ego-lite` and `codegraph` repositories remain independent benchmark targets under `~/Workspace/repo`.

## Prerequisites

The migrated configuration was validated with OpenCode 1.18.23, Oh My OpenAgent 4.19.4, OMO-owned CodeGraph 1.5.0, OpenSpec CLI, and Node.js 24. Install the JavaScript dependency without vendoring it:

```sh
npm ci --prefix opencode
```

## Install the live links

Review the manifest at `scripts/links.tsv`, then preview the operation:

```sh
./scripts/install.sh --dry-run
```

Install creates only the approved links. Existing real files are moved into a timestamped backup under the project data root; unexpected symlinks or content drift stop the operation before replacement.

```sh
./scripts/install.sh
./scripts/verify.sh
```

The installer links individual public-safe files and source-only directories. It never links all of `~/.config/opencode` or `~/.omo` and does not touch OpenSpec telemetry, benchmarks, OMO runtime files, CodeGraph indexes, sessions, caches, or credentials.

## Validate

```sh
./scripts/verify.sh
node --test ~/.config/opencode/tests/*.test.js
opencode debug info
opencode agent list
```

The deterministic suite covers command discovery, workflow state ownership, planning and execution gates, CodeGraph permissions, plugin behavior, and worktree safety.

## Make changes safely

After installation, edit files in this repository. The approved live OpenCode and OMO paths resolve directly to these files, so there is no second copy to synchronize. Run the verification script and deterministic tests, inspect the Git diff, and commit the coherent change here.

Do not copy local benchmarks, raw sessions, telemetry, provisioned runtimes, indexes, credentials, or the external `ego-lite` and `codegraph` benchmark repositories into this repository.
