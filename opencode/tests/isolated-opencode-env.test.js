import test from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"

import { isolatedOpenCodeEnv } from "./support/isolated-opencode.js"

test("isolated OpenCode environments discard inherited persistent overrides", async (t) => {
  const repository = fileURLToPath(new URL("../..", import.meta.url))
  const env = await isolatedOpenCodeEnv(t, repository, {
    ...process.env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: ["external-plugin"] }),
    AIO_DATA_ROOT: "/some/persistent/aio-data",
    OPENCODE_WORKFLOW_DATA_ROOT: "/some/persistent/legacy-data",
  })

  assert.equal(env.OPENCODE_CONFIG_CONTENT, undefined)
  assert.equal(env.AIO_DATA_ROOT, undefined)
  assert.equal(env.OPENCODE_WORKFLOW_DATA_ROOT, undefined)
  assert.match(env.XDG_DATA_HOME, /aio-opencode-test-/)
  assert.match(env.XDG_DATA_HOME, /\/home\/\.local\/share$/)
  assert.match(env.XDG_CONFIG_HOME, /\/home\/\.config$/)
})
