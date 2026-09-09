# Troubleshooting

Start with:

```sh
git status --short
git diff --check
node --test opencode/tests/*.test.js
./scripts/verify.sh
```

Do not reset, clean, stash, force-remove worktrees, or delete broad runtime/index directories to make a check pass.

## Agent or command is missing

Run `./scripts/install.sh --dry-run` and inspect the live links. Commands are exactly `spec`, `plan`, `execute`, `verify`, `ship`, and `browser`. Restart OpenCode after authored agent, command, plugin, skill, or MCP changes.

## Delegation tool is missing

Run `opencode debug config` and confirm the local Delegation Runtime plugin is discovered. Run the loader and host integration tests. Executor must stop if a required workflow-owned tool is unavailable; manual worktree or alternate delegation fallback is not valid.

## Background group does not resume

Inspect deterministic task status, the task registry, child session status/events, and parent idle evidence. Do not add a polling loop. Busy/running/retry parents are intentionally not resumed. A missing status is accepted only with a current-process idle witness.

## Workspace release refuses

Treat refusal as preservation. Inspect task terminal state, worktree identity, status, unique commits, and integration evidence. Never force-remove, reset, or clean the workspace.

## CodeGraph is unavailable or stale

Run `./scripts/check-codegraph.sh`. If the CLI is absent or the project is unindexed, run `./scripts/setup-codegraph.sh`. Restart OpenCode after MCP changes. Agents should fall back to source tools immediately; CodeGraph must not block correctness work.

## Browser backend is not ready

Run `./scripts/setup-ego-browser.sh`, finish the Ego Lite GUI onboarding, then run `./scripts/check-ego-browser.sh`. Ensure `~/.local/bin` is in the PATH inherited by OpenCode and restart it. Do not copy the external skill into this repository or broaden ordinary Implementer permissions.

Use `/browser` for the dedicated Browser route, or ask Assistant to use `category="browser-automation"`; both routes require the same external backend health.

## Old managed config remains

Run `./scripts/install.sh --dry-run`. The installer removes the former `~/.omo/omo.jsonc` only when it is a symlink to this repository's retired path. It preserves any user-owned file or other symlink and reports it for manual review.
