# Updating OMO manually

Do not update production OMO casually while lane worktrees are in use. The
authoritative record is [`omo-runtime-baseline.json`](../reference/omo-runtime-baseline.json).

Production is pinned to the immutable artifact recorded in the baseline, and
`LANE_WORKTREES` is currently disabled after the fresh OpenCode 1.18.27 lane
E2E exposed a parent/child completion failure. Do not replace that pin with
`@latest`. The artifact was built from the historical post-beta.30 research
source that passed the isolation probes.

## Safe candidate workflow

```text
new OMO source → isolated exact tag/commit → build and static P01/P02/P03 checks
→ runtime probes and Executor lane E2E → verify resolved artifact → promote
```

```sh
git clone https://github.com/code-yeongyu/oh-my-openagent.git ~/src/omo-candidate
cd ~/src/omo-candidate
git fetch --tags origin
git checkout -b integration/omo-<version> <upstream-tag-or-commit>
bun install --frozen-lockfile
bun run build
cd ~/Workspace/repo/opencode-workflow
./scripts/check-omo-update.sh --candidate ~/src/omo-candidate
```

`STATIC_RESULT: PASS` is not promotion approval. Run every check listed in the
baseline, including focused tests, typecheck, build, runtime probes, and the
Executor lane E2E. Runtime requests must use only an allowed OpenAI model with
reasoning `high` or lower and constrained fallback.

## Patches and history

Apply only patches marked `STILL_REQUIRED` in the baseline. Do not reapply a
patch replaced by equivalent upstream behavior. The historical proof runtime
was `5.0.0-beta.30` at source commit
`5c699bc74830864eac0cd27ae7e453a3faf5a3df`; it is not a production pin.

If a patch conflicts or any check fails, stop and retain the current runtime.
Never guess at semantic conflict resolution.

## Promotion and rollback

Promotion is a separate reviewed step. Pin the exact immutable artifact that
passed all checks, record the previous plugin specification, and update the
baseline in the same change. If smoke validation fails, restore the previous
specification and verify the resolved plugin identity.

Do not edit `~/.cache/opencode/...` manually. Cache contents are not reviewable,
reproducible, or a dependable rollback mechanism.
