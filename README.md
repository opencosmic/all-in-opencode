# OpenCode Workflow

This repository is the canonical authored source for a custom OpenCode/OpenSpec workflow. It includes a workflow-owned Delegation Runtime built on stock OpenCode public APIs and Git worktrees. Stock Oh My OpenAgent (OMO) remains available for unrelated existing routes, but isolated delegation does not depend on it.

No software license has been selected for this repository.

## Workflow

The custom lifecycle is:

```text
/spec -> /plan -> /execute -> /verify -> /ship
```

`/omo` is a separate route from an approved product strategy to OMO's native Prometheus planner.

`/ego <task>` is a separate browser-automation route to the primary-only Ego Browser agent and the external `citrolabs/ego-lite` `ego-browser` skill/runtime. It does not enter OpenSpec, create implementation state, use OMO categories or CodeGraph, or modify project source code.

Completed `/ego` work keeps its goal-named ego-lite Space open by default, with only useful final tabs, so you can inspect the result or continue the same goal. While it works, open ego lite, click **Space** in the upper-right, and select the named Space to watch without taking control. If you choose to take over, the agent stops and waits for your explicit confirmation before resuming. Say “close the Space” or “clean up the Space” when you want explicit cleanup instead. See ego lite's [Space guide](https://lite.ego.app/document/en/docs/space) for the browser UI.

- Strategist owns product intent and creates the OpenSpec proposal and behavioral specs.
- Planner creates `design.md` and `tasks.md` from the approved contract.
- Plan Reviewer independently reviews those planning artifacts.
- Executor orchestrates implementation through the workflow-owned Delegation Runtime.
- Category-selected work routes to one reusable Implementer; Reviewer and QA can inspect the same isolated workspace.
- Reviewer, QA, and Verifier provide independent code, runtime, and final evidence.
- Researcher and Validator support product discovery and validation.

`tasks.md` is the only durable workflow-progress state. Lightweight task and workspace manifests are infrastructure provenance and recovery evidence only. OMO remains the owner of its native runtime state, and CodeGraph remains OMO-owned derived structural evidence.

## CodeGraph policy

The custom tool surface is deliberately limited to `codegraph_codegraph_explore`. Planner, Plan Reviewer, Executor, Reviewer, and Verifier may use it as bounded structural evidence. Strategist, Researcher, Validator, and QA do not receive a CodeGraph rollout. The workflow does not provision CodeGraph, own its indexes, or create another CodeGraph lifecycle.

## Repository layout

- `opencode/agents/`: custom agent definitions.
- `opencode/commands/`: `/ego`, `/omo`, `/spec`, `/plan`, `/execute`, `/verify`, and `/ship`.
- `opencode/plugins/`: the Delegation Runtime, workflow guard, and read-only workspace inspector.
- `opencode/tests/`: deterministic policy, fake-SDK, completion, background, permission, temporary-Git-worktree, and stock OpenCode no-model host tests.
- `opencode/opencode.jsonc` and `opencode/tui.json`: public-safe OpenCode configuration.
- `opencode/package.json` and `opencode/package-lock.json`: pinned plugin API dependency metadata.
- `omo/omo.jsonc`: public-safe authored OMO configuration only.
- `scripts/`: explicit, conservative link installation and verification.
- `docs/`: documentation index, user guides, architecture, reference, research, troubleshooting, and engineering decisions.

The global OpenSpec file at `~/.config/openspec/config.json` is not included: the current file contains local telemetry identity/state, not authored workflow policy. Project-specific OpenSpec artifacts continue to live in each target project. OpenCode's live package manifest, lockfile, and installed `node_modules` also remain local package-manager state; the repository's dependency metadata supports validation from a clone but is not linked over those live files.

## Local data ownership

Authored source belongs in this Git repository. Project-owned benchmark and backup data that must remain local belongs under `${OPENCODE_WORKFLOW_DATA_ROOT:-$HOME/Workspace/data/opencode-workflow}`:

- benchmark evidence: `${OPENCODE_WORKFLOW_DATA_ROOT:-$HOME/Workspace/data/opencode-workflow}/benchmarks/<experiment-id>`;
- configuration and migration backups: `${OPENCODE_WORKFLOW_DATA_ROOT:-$HOME/Workspace/data/opencode-workflow}/backups/`.

The environment variable is optional; without it, the default is `~/Workspace/data/opencode-workflow`. Future benchmark and backup work must use this data root directly and must not recreate `~/.config/opencode/benchmarks` or `~/.config/opencode/backups`.

Delegation Runtime provenance and task-recovery metadata uses `$OPENCODE_WORKFLOW_DATA_ROOT/delegation` when that variable is set, otherwise `~/.local/share/opencode-workflow/delegation`. Managed worktrees live beneath that state root. This state never replaces OpenSpec `tasks.md`.

The live application roots remain `~/.config/opencode`, `~/.config/openspec`, and `~/.omo`. They contain only canonical source entrypoints and application-owned local state. OMO runtime and CodeGraph indexes remain under `~/.omo`; OpenSpec's private telemetry configuration remains under `~/.config/openspec`; runtime dependencies remain where OpenCode requires them. The external `ego-lite` and `codegraph` repositories remain independent benchmark targets under `~/Workspace/repo`.

## Prerequisites

The Delegation Runtime is validated against the stock OpenCode 1.18.29 public plugin/SDK surface and stock Oh My OpenAgent 4.19.4, plus OMO-owned CodeGraph 1.5.0, OpenSpec CLI, and Node.js 24. Install the JavaScript dependency without vendoring it:

```sh
npm ci --prefix opencode
```

Ego Browser additionally depends on the externally installed official [`citrolabs/ego-lite`](https://github.com/citrolabs/ego-lite) `ego-browser` skill and runtime. This repository authors the OpenCode agent and command only; it does not vendor `skills/ego-browser/**`, the browser application, Task Spaces, or browser state. The upstream skill command remains `npx skills add citrolabs/ego-lite`.

[OpenCode supports global skills](https://opencode.ai/v2/docs/skills#discovery) under `~/.config/opencode/skills`, `~/.agents/skills`, and `~/.claude/skills`. The setup and readiness scripts resolve one existing `ego-browser` installation in that deterministic precedence order, matching OpenCode's highest-priority global source first. They do not copy the skill between locations or install another copy when a supported installation already exists.

The official macOS installer selects `arm64` or `x64`, installs `ego lite.app` under `/Applications` (falling back to `~/Applications`), removes its quarantine attribute, and launches onboarding. Complete the GUI choice yourself. Onboarding normally registers `ego-browser` under `~/.local/bin`; add that directory to the persistent shell PATH only when it is not already present.

Use the repository's explicit, opt-in setup command. It installs the official skill only when none of the supported global locations contains it, resolves the actual installation, and runs the upstream application installer from that directory:

```sh
./scripts/setup-ego-browser.sh
```

This setup is never run by ordinary link installation or static verification. Check local readiness without changing repository validity:

```sh
./scripts/check-ego-browser.sh
```

Ready state requires both `ego-browser runtime: available and provisioned` and `ego-browser skill: discoverable`, followed by `optional runtime status: READY`. Restart OpenCode after installing or updating the agent/skill so a running process reloads discovery and permissions.

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

The `opencode/agents` and `opencode/commands` directory links also discover Ego Browser and `/ego`; no per-file link or external-skill lifecycle is added to `scripts/links.tsv`.

## Validate

```sh
./scripts/verify.sh
node --test ~/.config/opencode/tests/*.test.js
opencode debug info
opencode agent list
```

The deterministic suite covers command discovery, workflow state ownership, planning and execution gates, CodeGraph permissions, public plugin behavior, shared cross-worktree control-plane ownership, workspace provenance, completion correctness, grouped background resume, cancellation, Implementer Git enforcement, and conservative release. The host test starts stock OpenCode against a temporary repository and two linked worktrees; all completion payloads are deterministic and no test makes a model call.

## Make changes safely

After installation, edit files in this repository. The approved live OpenCode and OMO paths resolve directly to these files, so there is no second copy to synchronize. Run the verification script and deterministic tests, inspect the Git diff, and commit the coherent change here.

Do not copy local benchmarks, raw sessions, telemetry, provisioned runtimes, indexes, credentials, or the external `ego-lite` and `codegraph` benchmark repositories into this repository.

## Documentation

- [Documentation index](docs/README.md) is the navigation hub for users and future agents.
- [Using the workflow](docs/guides/using-the-workflow.md) is the daily operating guide.
- [Architecture](docs/architecture.md) explains ownership and lifecycle boundaries.
- [Project reference](docs/reference/project-map.md) maps source, agents, commands, and invariants.
- [Research](docs/research/README.md) preserves validated, rejected, and unproven R&D knowledge.
- [Maintaining the repository](MAINTAINING.md) covers safe development and research hygiene.
- [Troubleshooting](docs/troubleshooting.md) separates repairable failures from known warnings.
- [Decisions](docs/decisions/planner-optimization.md) records final engineering decisions.
