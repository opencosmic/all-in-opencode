# Maintaining the private OMO directory patch

This runbook keeps the caller-selected child-session directory patch usable if
upstream review is delayed or never results in a merge. It does not authorize
production lane worktrees or worker sandboxes. The current candidate, patch
statuses, and validation outcome are recorded in
[`omo-runtime-baseline.json`](omo-runtime-baseline.json); the no-AI update
procedure is [`updating-omo-manually.md`](../guides/updating-omo-manually.md).

## Validated patch identity

| Item | Validated value |
|---|---|
| Upstream repository | `code-yeongyu/oh-my-openagent` |
| Upstream base | `d50518d45e9eb03dbb25b436886bfc6ef9b5fa11` (`dev`) |
| Patched commit | `314e8d70415dd7daf9eddf6b49837fbffbe23fef` |
| Patched source version | `5.0.0-beta.30` |
| Installed production OMO observed during validation | `4.19.4` |
| OpenCode version validated | `1.18.25` |
| Patch overlay | Not used; the Git commit is the maintained patch identity. |

The commit adds one optional `directory` input to normal task/category
delegation and carries the effective directory through sync, background, forced
background, persisted task, and retry paths. When omitted, existing parent/default
directory behavior is unchanged. It does not manage worktrees or prove complete
runtime isolation.

## Upgrade procedure

Maintain the feature as one small commit in a personal fork:

```text
new upstream OMO dev
  -> fetch upstream
  -> create a disposable branch/worktree at the new upstream commit
  -> rebase or cherry-pick the directory commit
  -> inspect every delegation/session conflict and the complete diff
  -> install dependencies
  -> run focused and broad tests, typecheck, and build
  -> run the canonical worktree capability probe against that checkout
  -> decide whether to adopt the exact validated commit
```

Do not resolve a delegation conflict mechanically. Reconstruct the public
argument, effective-directory precedence, every session creation path, persisted
background state, and every retry path before accepting the refreshed patch.

From an OMO source checkout, the validation sequence is:

```sh
bun test packages/omo-opencode/src/tools/delegate-task packages/omo-opencode/src/features/background-agent
bun run --cwd packages/omo-opencode typecheck
OMO_SKIP_MATERIALIZE=1 bun run build
git diff --check
```

Then run the no-LLM canonical probe from this repository:

```sh
node scripts/probes/worktree-isolation.mjs --omo-package-root /absolute/path/to/oh-my-openagent
```

Record the refreshed upstream base SHA, patched commit SHA, source version,
OpenCode version, commands, and results in the change that updates this table.
The aggregate runtime verdict remains `UNPROVEN` until the probe has complete
mechanical evidence for the remaining sync, concurrent, temporal, nested, and
parent-bookkeeping capabilities.

## Private installation, rollback, and cache policy

If private adoption becomes necessary, build the pinned fork commit in a
versioned checkout and load its built plugin through an absolute `file://` plugin
entry supported by OpenCode. Record the checkout path and exact commit beside the
local deployment change. Do not use a floating branch or `latest` reference.

Before adoption, keep the current production plugin entry unchanged. For a
controlled adoption, preserve the previous entry, switch only the OMO plugin
source to the pinned built artifact, rerun canonical verification and the
capability probe, and roll back by restoring that preserved entry. This keeps
source, build, deployment, and rollback identities explicit.

Never maintain this patch by editing `~/.cache/opencode/...`. Cache contents are
resolver-owned, may disappear on reinstall, do not provide a reviewable patch
base, and create hidden state that cannot be reproduced or rolled back safely.

Production policy remains:

```text
LANE_WORKTREES = DISABLED (fresh OpenCode 1.18.27 lane E2E failed at parent/child completion)
EPHEMERAL_SANDBOX = DISABLED
```
