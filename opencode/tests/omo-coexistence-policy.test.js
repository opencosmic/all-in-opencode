import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const testDirectory = dirname(fileURLToPath(import.meta.url))
const repository = join(testDirectory, "../..")

test("OMO todo continuation cannot wake workflow-owned Executor groups early", async () => {
  const config = await readFile(join(repository, "omo/omo.jsonc"), "utf8")

  assert.match(
    config,
    /"disabled_hooks"\s*:\s*\[\s*"todo-continuation-enforcer"\s*\]/,
    "the OMO todo continuation hook must stay disabled while Delegation Runtime owns grouped resume",
  )
})
