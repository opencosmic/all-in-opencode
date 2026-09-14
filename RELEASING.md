# Releasing All-in OpenCode

This repository uses a small, manual release process. It is a private,
single-maintainer project; the Git tag is the release identifier and there is
no separate runtime version file.

## Version policy

aio follows Semantic Versioning during pre-1.0 development:

- `0.x.y` is the active development line. A PATCH bump (`0.x.Y`) is for a
  narrowly compatible bug fix, test-reliability improvement, CI fix, or small
  documentation correction.
- A MINOR bump (`0.X.0`) is for a meaningful capability or significant
  behavior change. During `0.x`, breaking internal, configuration, or workflow
  changes may also require a MINOR bump.
- `1.0.0` is reserved for the point at which aio's user-facing contracts are
  stable and backward compatibility becomes an explicit commitment. The `0.x`
  line does not provide the same compatibility guarantee as `1.x`.

Canonical tags use the annotated form `vMAJOR.MINOR.PATCH`, for example
`v0.1.0`, `v0.2.0`, and `v0.2.1`.

Prerelease tags such as `v0.2.0-alpha.1`, `v0.2.0-beta.1`, and
`v0.2.0-rc.1` are available for milestones that genuinely need stabilization
or testing. They are not required for ordinary feature development.

## Release checklist

From the canonical checkout:

1. Confirm `main` is clean and matches `origin/main`.
2. Confirm the intended change is merged to `main`; do not release from a
   feature or evaluation branch.
3. Confirm hosted CI is green, including the default-parallel test suite.
4. Run `git diff --check`, `node --test opencode/tests/*.test.js`, and
   `./scripts/verify.sh` locally.
5. Curate the matching `CHANGELOG.md` entry and decide the target version.
6. Record the baseline commit and create an annotated tag:

   ```sh
   git tag -a vX.Y.Z -m "All-in OpenCode vX.Y.Z"
   ```

7. Verify the tag object and commit before publishing:

   ```sh
   git show vX.Y.Z --no-patch
   git rev-parse vX.Y.Z^{commit}
   git rev-parse main
   ```

   The tag's resolved commit must equal `main`.

8. Push only the specific tag, never all tags or a force-updated tag:

   ```sh
   git push origin vX.Y.Z
   git ls-remote origin refs/tags/vX.Y.Z
   git ls-remote origin 'refs/tags/vX.Y.Z^{}'
   ```

9. Confirm the repository remains private. A GitHub Release object, package
   publication, license publication, and public-release audit are not part of
   the private baseline process.

Do not move or overwrite an existing release tag. If a tag conflict exists,
stop and investigate it.

## Changelog maintenance

Keep an `[Unreleased]` section at the top. Before a release, move its curated
entries into a dated version section and leave a fresh empty `[Unreleased]`
section. Summarize capabilities and user-relevant behavior; do not copy the
complete Git history into the changelog.

## Hotfixes

Normal development continues on `main`. A compatible fix for `v0.1.0` becomes
`v0.1.1` after the same checklist. A temporary maintenance branch is justified
only when an actual released baseline needs a targeted fix while `main` has
advanced substantially; permanent release branches are not part of this
policy.

This process intentionally does not add release automation, automatic version
bumping, automatic changelog generation, registry publishing, or release
branches.
