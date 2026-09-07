import test from "node:test"
import assert from "node:assert/strict"
import { access, readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repository = new URL("../../", import.meta.url)

async function filesBelow(relative) {
  const root = fileURLToPath(new URL(relative, repository))
  const output = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else output.push(path)
    }
  }
  await walk(root)
  return output
}

test("obsolete delegation and runtime-patch artifacts are absent", async () => {
  const obsolete = [
    "scripts/lib/lane-worktrees.mjs",
    "scripts/probes/executor-lane-runtime.mjs",
    "scripts/probes/worktree-isolation.mjs",
    "scripts/check-omo-update.sh",
    "docs/reference/private-omo-directory-patch.md",
    "docs/reference/omo-runtime-baseline.json",
    "docs/research/worktree-isolation-capability.md",
  ]
  for (const relative of obsolete) {
    await assert.rejects(access(new URL(relative, repository)), /ENOENT/, relative)
  }
})

test("production workflow has no legacy feature flag, artifact pin, or private runtime import", async () => {
  const files = [
    ...(await filesBelow("opencode/agents/")),
    ...(await filesBelow("opencode/commands/")),
    ...(await filesBelow("opencode/plugins/")),
    ...(await filesBelow("scripts/")),
  ]
  const forbidden = /LANE_WORKTREES|omo-artifacts|oh-my-openagent-.*\.tgz|@opencode-ai\/.*(?:internal|src)|oh-my-openagent\/src/
  for (const path of files) {
    assert.doesNotMatch(await readFile(path, "utf8"), forbidden, path)
  }
})
