import test from "node:test"
import assert from "node:assert/strict"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const pluginsDirectory = fileURLToPath(new URL("../plugins/", import.meta.url))

test("direct plugin-root JavaScript files expose only plugin entrypoint exports", async () => {
  const files = (await readdir(pluginsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort()

  assert.ok(files.length > 0, "the plugin root must contain at least one entrypoint")

  for (const file of files) {
    const entrypoint = await import(pathToFileURL(join(pluginsDirectory, file)).href)
    assert.deepEqual(Object.keys(entrypoint), ["default"], `${file} must expose only its default plugin export`)
    assert.equal(typeof entrypoint.default, "function", `${file} default export must be a plugin factory`)
  }
})
