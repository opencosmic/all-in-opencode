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

Run `./scripts/install.sh --dry-run` and inspect the live links. Commands are exactly `spec`, `plan`, `execute`, `verify`, `ship`, `browser`, `video`, `search`, and `research`. Restart OpenCode after authored agent, command, plugin, skill, or MCP changes.

For `/research`, confirm the Professor plugin is discovered and that the configured workflow data root is writable. Research runs live under `<data-root>/professor/runs/<run-id>/`; they do not write state into the repository. Resume with the durable run ID through Professor's state tools rather than reconstructing the task from chat history.

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

## HyperFrames video production is unavailable

Run `./scripts/check-hyperframes.sh` for a read-only report. It distinguishes missing Node.js 22+, `npx`, FFmpeg, `ffprobe`, the external `hyperframes` skill, OpenCode discovery, and upstream skill freshness. Run `./scripts/setup-hyperframes.sh` when you want to refresh the external HyperFrames core skills and workflows already installed; it uses the official CLI path and does not copy HyperFrames into this repository. It does not eagerly install every creation workflow. If the upstream router selects a missing or stale workflow, approve its named `npx hyperframes skills update <workflow-name>` refresh or rerun the explicit setup flow.

If a `/video` request stops at a skill-update requirement, do not patch the installed `SKILL.md` or allow an implicit global refresh. Follow the upstream confirmation prompt or run the explicit setup script, then restart OpenCode so its skill index sees the installation. Project initialization can use the upstream-supported `HYPERFRAMES_SKIP_SKILLS=1` opt-out when a project operation must not check or mutate global skills; the current `--skip-skills` flag is not a substitute.

If frame workers are unavailable, let the current HyperFrames workflow use its serial fallback. The route intentionally does not expose the workflow-owned Delegation Runtime or a broad native task channel, and this repository does not add a scheduler or worker pool.

## Video analysis is unavailable

Run `./scripts/setup-watch.sh` and `./scripts/check-watch.sh`. The first script installs the upstream `bradautomates/claude-video` `watch` skill into a supported global skill directory and does not copy it into this repository. The upstream `scripts/setup.py` preflight reports or installs `ffmpeg`, `ffprobe`, and `yt-dlp` as appropriate for the platform, and optional Whisper keys remain in `~/.config/watch/.env`. Ask Assistant to use `category="video-analysis", load_skills=["watch"]` when the evidence must come from the video itself.

## Old managed config remains

Run `./scripts/install.sh --dry-run`. The installer removes the former `~/.omo/omo.jsonc` only when it is a symlink to this repository's retired path. It preserves any user-owned file or other symlink and reports it for manual review.
