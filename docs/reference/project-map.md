# Project map

This reference maps canonical source to the behavior it controls. The [link manifest](../../scripts/links.tsv) is the executable source-to-live topology; this document does not replace it.

## Source roots

| Path | Purpose and ownership | Related / guarded by | Runtime effect |
|---|---|---|---|
| [`opencode/agents/`](../../opencode/agents/) | Nine custom role definitions, including permissions and role contracts. | [agent reference](agents-and-commands.md); `codegraph-integration.test.js`, `openspec-hardening-policy.test.js` | Linked to `~/.config/opencode/agents/` for discovery. |
| [`opencode/commands/`](../../opencode/commands/) | The six user-invoked workflow entrypoints. | `workflow-discovery.test.js`, agent files | Linked to `~/.config/opencode/commands/`. |
| [`opencode/plugins/`](../../opencode/plugins/) | Runtime guard and read-only workspace inspection tool. | Matching plugin tests | Linked to `~/.config/opencode/plugins/`. |
| [`opencode/tests/`](../../opencode/tests/) | Deterministic policy, discovery, plugin, and workspace safety tests. | `node --test ~/.config/opencode/tests/*.test.js` | Test-only; linked to the live OpenCode test path. |
| [`opencode/opencode.jsonc`](../../opencode/opencode.jsonc), [`opencode/tui.json`](../../opencode/tui.json) | Public-safe OpenCode plugin configuration. | `package.json`, OMO integration | Linked individual files; installed packages remain local. |
| [`opencode/package.json`](../../opencode/package.json), `package-lock.json` | Pinned validation dependency metadata for the workspace-inspector plugin API. | `npm ci --prefix opencode` | Not linked over OpenCode's live package state. |
| [`omo/omo.jsonc`](../../omo/omo.jsonc) | Public-safe authored OMO configuration and custom role display names. | [architecture](../architecture.md) | Linked to `~/.omo/omo.jsonc`; OMO runtime remains local. |
| [`scripts/`](../../scripts/) | Conservative install/verification plus pure lifecycle/probe helpers; no daemon or durable task state. | [MAINTAINING.md](../../MAINTAINING.md), [invariants](invariants.md) | Installs/verifies individual live symlinks and supplies deterministic policy decisions. |
| [`docs/`](../) | Human/agent-readable operation, architecture, reference, research, decisions, and recovery knowledge. | This documentation index | No runtime effect. |

## Agents

| Path | Purpose | Owns / controls | Related tests |
|---|---|---|---|
| [`strategist.md`](../../opencode/agents/strategist.md) | Product direction and approved strategy. | `.product/strategy/`; product half of OpenSpec contract. | `openspec-hardening-policy.test.js` |
| [`researcher.md`](../../opencode/agents/researcher.md), [`validator.md`](../../opencode/agents/validator.md) | Bounded supporting product evidence and adversarial validation. | Read-only reports only. | Role policy tests |
| [`planner.md`](../../opencode/agents/planner.md) | Engineering design and executable tasks. | `design.md`, `tasks.md`, planning-only boundaries. | `planner-delegation-guard.test.js`, policy tests |
| [`plan-reviewer.md`](../../opencode/agents/plan-reviewer.md) | Independent read-only plan gate. | `[APPROVED]` / `[REJECTED]` assessment. | Policy tests |
| [`executor.md`](../../opencode/agents/executor.md) | Implementation orchestration, workspace resolution, task state. | Custom task-checkbox transitions only. | Policy and workspace tests |
| [`reviewer.md`](../../opencode/agents/reviewer.md), [`qa.md`](../../opencode/agents/qa.md) | Independent code and runtime/user-surface evidence. | Findings only, never repairs. | Policy tests |
| [`verifier.md`](../../opencode/agents/verifier.md) | Independent final proof against the current change. | `VERIFIED` / `VERIFIED_WITH_CONCERNS` / `BLOCKED`. | Policy tests |

## Commands and plugins

| Path | Purpose | Owns / controls | Related tests |
|---|---|---|---|
| [`commands/spec.md`](../../opencode/commands/spec.md) | Strategy to OpenSpec product contract. | Placement gate before persistent artifacts. | `workflow-discovery.test.js`, policy tests |
| [`commands/plan.md`](../../opencode/commands/plan.md) | Contract to reviewed engineering plan. | Planner/Plan Reviewer handoff. | Discovery and policy tests |
| [`commands/execute.md`](../../opencode/commands/execute.md) | Reviewed plan to controlled implementation. | Fresh planning review and Executor handoff. | Policy tests |
| [`commands/verify.md`](../../opencode/commands/verify.md) | Current-state independent verification. | Verifier outcome. | Policy tests |
| [`commands/ship.md`](../../opencode/commands/ship.md) | Explicit post-verification delivery choice. | Safe archive/integration gates. | Policy tests |
| [`commands/omo.md`](../../opencode/commands/omo.md) | Separate native OMO planning route. | Prometheus/Momus native state only. | Discovery tests |
| [`plugins/planner-delegation-guard.js`](../../opencode/plugins/planner-delegation-guard.js) | Enforces Planner's bounded consultations. | Blocks category workers and continuations. | `planner-delegation-guard.test.js` |
| [`plugins/workspace-inspector.js`](../../opencode/plugins/workspace-inspector.js) | Read-only repository/worktree preflight. | Workspace facts and strategy-base availability. | `workspace-inspector.test.js` |
| [`scripts/lib/lane-worktrees.mjs`](../../scripts/lib/lane-worktrees.mjs) | Pure Executor lane-policy decisions. | Exact capability gate, ready-wave independence, lane provenance/dispatch, integration, completion, cleanup, and resume classification. | `lane-worktrees-policy.test.js`, `lane-worktrees-git-lifecycle.test.js` |

## Installation and data boundaries

- [`scripts/links.tsv`](../../scripts/links.tsv) lists exactly what becomes a live link. Source directories are linked individually; OpenCode package state and all OMO runtime data are excluded.
- [`scripts/install.sh`](../../scripts/install.sh) validates source/live content, moves matching real paths to a timestamped project-data backup, creates links, and rolls back its own partial migration if needed.
- [`scripts/verify.sh`](../../scripts/verify.sh) checks live targets and frozen hashes for Planner, Plan Reviewer, Executor, and Reviewer.
- Local benchmark evidence and migration backups belong under `${OPENCODE_WORKFLOW_DATA_ROOT:-$HOME/Workspace/data/opencode-workflow}`, not in this Git repository or application configuration roots.
