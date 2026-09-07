import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import DelegationRuntimePlugin from "../plugins/delegation-runtime.js"

function client() {
  return {
    session: {
      create: async () => ({ data: { id: "child" } }),
      promptAsync: async () => ({ data: undefined }),
      abort: async () => ({ data: true }),
      status: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
    },
  }
}

test("plugin exposes only the six workflow-owned delegation tools", async (t) => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "delegation-plugin-test-"))
  t.after(async () => rm(stateDirectory, { recursive: true }))
  const plugin = await DelegationRuntimePlugin({
    client: client(),
    directory: fileURLToPath(new URL("../..", import.meta.url)),
    serverUrl: new URL("http://127.0.0.1:40200"),
  }, { stateDirectory })
  assert.deepEqual(Object.keys(plugin.tool), [
    "workspace_prepare",
    "delegate_task",
    "task_status",
    "task_output",
    "task_cancel",
    "workspace_release",
  ])
  assert.equal(typeof plugin.event, "function")
  assert.equal(typeof plugin["chat.params"], "function")
})

test("new runtime has a stock public dependency boundary", async () => {
  const directory = new URL("../plugins/delegation/", import.meta.url)
  const files = (await readdir(directory)).filter((name) => name.endsWith(".js"))
  const forbidden = [
    /oh-my-openagent/i,
    /(?:^|[/@])opencode[/].*(?:internal|src)/i,
    /executor-lane|lane-worktrees|lane_delegate|private-omo|patch-overlay/i,
    /child_process.*opencode run|opencode run.*child_process/is,
  ]
  for (const file of files) {
    const source = await readFile(new URL(file, directory), "utf8")
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${file} crosses the public dependency boundary`)
    }
  }
  const entry = await readFile(new URL("../plugins/delegation-runtime.js", import.meta.url), "utf8")
  assert.match(entry, /from "@opencode-ai\/plugin"/)
  assert.doesNotMatch(entry, /oh-my-openagent|opencode.*(?:internal|src)/i)
})

test("OpenCode configuration uses stock OMO instead of a local source artifact", async () => {
  for (const path of ["../opencode.jsonc", "../tui.json"]) {
    const config = await readFile(new URL(path, import.meta.url), "utf8")
    assert.match(config, /"oh-my-openagent@4\.19\.4"/)
    assert.doesNotMatch(config, /omo-artifacts|file:\/\/|\.tgz/)
  }
})
