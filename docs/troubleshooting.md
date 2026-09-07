# Troubleshooting

Start by inspecting ownership and the smallest affected surface. Prefer:

```text
inspect → identify owner → verify backup → repair smallest surface → re-run checks
```

Do not casually delete `~/.omo`, CodeGraph indexes/projects, benchmark evidence, backups, or package state.

## Links and discovery

### `scripts/verify.sh` reports a missing, broken, or wrong link

**Actionable failure.** Read [`scripts/links.tsv`](../scripts/links.tsv) to identify the intended source and live path. Confirm the repository source exists and inspect the live path without replacing it. Use `./scripts/install.sh --dry-run` to review the approved repair; the installer refuses unexpected symlinks and content drift rather than overwriting them.

If the live path was previously migrated, locate the corresponding backup under `${OPENCODE_WORKFLOW_DATA_ROOT:-$HOME/Workspace/data/opencode-workflow}/backups/migrations/` before changing anything. Then rerun `./scripts/verify.sh`.

### OpenCode does not discover a custom agent or command

**Actionable failure.** First run `./scripts/verify.sh`; the live `agents/` and `commands/` directories must be the expected links. Then compare the filename and front matter with [`workflow-discovery.test.js`](../opencode/tests/workflow-discovery.test.js): commands are exactly `ego`, `omo`, `spec`, `plan`, `execute`, `verify`, and `ship`, and their exact agent targets are tested. Run:

```sh
node --test ~/.config/opencode/tests/*.test.js
opencode agent list
```

Edit the canonical file in this repository, never a copied live file.

## Dependency and runtime availability

### `scripts/check-ego-browser.sh` reports `NOT READY`

**Actionable external-dependency status; not an authored-config failure.** Run the opt-in `./scripts/setup-ego-browser.sh`, complete the ego lite GUI onboarding, and rerun the check. A ready machine has a discoverable official skill plus a provisioned `ego-browser` command, normally under `~/.local/bin`.

If the skill is missing, reinstall it globally for OpenCode with `npx --yes skills add citrolabs/ego-lite --global --agent opencode --skill ego-browser -y`. If the command exists but the check says it is not provisioned, reopen ego lite and finish onboarding. If the command is absent after onboarding, confirm `~/.local/bin` is in the persistent PATH inherited by OpenCode, then restart OpenCode. Do not copy the skill into this repository or weaken Ego Browser's shell permissions.

### Plugin module resolution fails or `node_modules` is absent

**Actionable failure.** The repository intentionally keeps only dependency metadata; the ignored repository-local `opencode/node_modules` is a local validation bridge, not Git content and not a link over OpenCode's installed package state. Install it from the repository:

```sh
npm ci --prefix opencode
```

If installation is blocked by network/DNS or an unavailable package cache, that is an environment/dependency acquisition issue, not a reason to vendor `node_modules` or modify workflow policy. Restore connectivity/cache access, then retry the intended install.

### CodeGraph explore is unavailable, pending, stale, or reports a worktree mismatch

**Actionable limitation for structural retrieval; not a workflow bypass.** CodeGraph is OMO-owned. Inspect the current workspace and OMO runtime/index status; do not create a second custom index lifecycle. The enabled roles must fall back to ordinary repository tools for the concrete evidence gap. CodeGraph is not compiler, diff, test, or runtime truth, so complete those checks normally.

For experiment setup, require an exact-root, complete, zero-pending index and a successful infrastructure-only explore probe. Do not place disposable worktrees under sensitive configuration directories: historical experiment `20260827T155125Z` failed for that reason. See [CodeGraph research](research/codegraph-integration.md#invalid-infrastructure-attempt).

### OMO doctor warns about `agents.*.models` schema shape

**Context-dependent warning.** The authored OMO configuration contains `models` lists. Treat a doctor/schema warning as actionable when agent resolution or actual invocation fails; otherwise record it as environment feedback and do not rewrite configuration solely to silence it.

### `runtime-skills` reports a port-0 warning

**Known non-blocking warning in historical benchmark preflight.** The valid CodeGraph and cross-repository benchmark reports recorded the warning while agent resolution, explore probes, and index preflight passed. It did not affect those experiments. If it coincides with a current runtime failure, diagnose that failure independently rather than assuming the warning is harmless.

## External tools and recovery

### `/execute` preserves a managed workspace after failure or refused release

**Expected conservative behavior.** Use `task_status` to inspect persisted task state and surviving workspace manifests, then inspect `task_output`, Git status, branch/base relationship, and the actual diff. Cancellation never deletes a workspace. Dirty, active, mismatched, unintegrated, or Git-refused workspaces remain available for explicit reconciliation.

Do not force-remove the worktree, force-delete its branch, reset it, or clean it. A matching branch name or path alone is not ownership. Only `workspace_release` may normally remove a provenance-validated managed workspace, and it refuses unknown state.

### A task remains `running` after OpenCode or the plugin restarted

**Recovery evidence, not proof of completion.** The runtime deliberately does not guess that a child completed. Inspect the surviving workspace and child/task identifiers returned by `task_status`. Cancel the task if the child must be aborted, or reconcile its workspace explicitly. Keep `tasks.md` unchecked until the implementation is integrated and freshly validated.

### GitHub CLI is unauthenticated

**Actionable only for an operation that needs GitHub.** Local validation and local commits do not require GitHub CLI authentication. Authenticate through the user-approved GitHub CLI flow before a requested push/PR operation; do not put tokens in this repository or documentation.

### A prior migration needs recovery

**Actionable failure; proceed conservatively.** Identify the exact live path and canonical target from [`links.tsv`](../scripts/links.tsv), verify a matching migration backup exists, and inspect its contents. Restore or repair only that path using the installer/backed-up material, then rerun verification and deterministic tests. Never use a broad deletion to “start clean.”

## Workflow verdicts

`[REJECTED]`, `[CHANGES_REQUIRED]`, `QA_FAIL`, `VERIFIED_WITH_CONCERNS`, and `BLOCKED` are not tool crashes. They report an evidence or authority boundary. Return the issue to the owning role, provide the missing decision/evidence, or, only for `VERIFIED_WITH_CONCERNS`, explicitly accept the exact current named shipping concerns where `/ship` asks for that decision. Acceptance authorizes shipping despite those concerns; it does not change the verdict, bypass `BLOCKED`, or survive a relevant mutation. Do not force a handoff by editing task state, creating alternate ledgers, or treating past approval as current authority.
