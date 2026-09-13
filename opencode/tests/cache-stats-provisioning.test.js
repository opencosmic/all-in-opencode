import test from "node:test"
import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repository = fileURLToPath(new URL("../..", import.meta.url))
const setup = join(repository, "scripts/setup-cache-stats.sh")
const check = join(repository, "scripts/check-cache-stats.sh")
const pluginCommit = "6cd5d12363a6cb49020b44325007c6154ea62cba"
const pluginSha256 = "0ac44613233beb66c91e10af8187c61664b3a358447c9d5fa86e3e70e7ca446f"

test("cache-stats is registered in the canonical TUI configuration", async () => {
  const tui = await readFile(join(repository, "opencode/tui.json"), "utf8")
  assert.match(tui, /"\$schema":\s*"https:\/\/opencode\.ai\/tui\.json"/)
  assert.match(tui, /"\.\/tui-plugins\/cache-stats\.tsx"/)
})

test("cache-stats provisioning stays external and verifies a pinned upstream source", async () => {
  const setupSource = await readFile(setup, "utf8")
  const checkSource = await readFile(check, "utf8")

  await access(setup)
  await access(check)
  assert.match(setupSource, new RegExp(`PLUGIN_COMMIT="${pluginCommit}"`))
  assert.match(setupSource, new RegExp(`PLUGIN_SHA256="${pluginSha256}"`))
  assert.match(
    setupSource,
    /PLUGIN_URL="https:\/\/raw\.githubusercontent\.com\/nmdra\/opencode-cache-stats\/\$PLUGIN_COMMIT\/tui-plugins\/cache-stats\.tsx"/,
  )
  assert.match(setupSource, /shasum -a 256/)
  assert.doesNotMatch(setupSource, /git clone|opencode-cache-stats\.git/)
  assert.doesNotMatch(setupSource, /opencode\/tui-plugins/)
  assert.match(checkSource, new RegExp(`PLUGIN_COMMIT="${pluginCommit}"`))
  assert.match(checkSource, new RegExp(`PLUGIN_SHA256="${pluginSha256}"`))
  assert.match(checkSource, /command -v shasum/)
  assert.match(checkSource, /hash mismatch/)
  assert.doesNotMatch(checkSource, /curl|mkdir|mv|rm -rf/)
})
