import test from "node:test"
import assert from "node:assert/strict"
import { access, readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repository = fileURLToPath(new URL("../..", import.meta.url))

async function trackedFiles(relative) {
  const root = join(repository, relative)
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

test("OMO plugin, config, commands, and compatibility tools are absent", async () => {
  for (const path of ["omo/omo.jsonc", "opencode/commands/omo.md", "opencode/plugins/planner-delegation-guard.js"]) {
    await assert.rejects(access(join(repository, path)))
  }

  const files = [
    ...(await trackedFiles("opencode/agents")),
    ...(await trackedFiles("opencode/commands")),
    ...(await trackedFiles("opencode/plugins")),
  ]
  const forbidden = /oh-my-openagent|call_omo_agent|background_output|background_cancel|Sisyphus-Junior|todo-continuation-enforcer/i
  for (const file of files) assert.doesNotMatch(await readFile(file, "utf8"), forbidden, file)

  const config = await readFile(join(repository, "opencode/opencode.jsonc"), "utf8")
  const tui = await readFile(join(repository, "opencode/tui.json"), "utf8")
  assert.doesNotMatch(`${config}\n${tui}`, /oh-my-openagent/i)
})

test("installer removes only the exact obsolete repository-managed symlink", async () => {
  const install = await readFile(join(repository, "scripts/install.sh"), "utf8")
  const links = await readFile(join(repository, "scripts/links.tsv"), "utf8")
  assert.doesNotMatch(links, /\.omo\/omo\.jsonc/)
  assert.match(install, /\[ -L "\$LEGACY_OMO_DEST" \]/)
  assert.match(install, /readlink "\$LEGACY_OMO_DEST"/)
  assert.match(install, /"\$LEGACY_OMO_SOURCE"/)
  assert.match(install, /Preserving non-managed legacy OMO config/)
})
