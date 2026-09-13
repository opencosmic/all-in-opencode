import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import * as DelegationRuntimeEntrypoint from "../plugins/delegation-runtime.js"
import DelegationRuntimePlugin from "../plugins/delegation-runtime.js"
import { clearDelegationControlPlanesForTest } from "../plugins/delegation/control-plane.js"

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

test("plugin entrypoint is default-only and exposes the seven project-owned delegation tools", async (t) => {
  assert.deepEqual(Object.keys(DelegationRuntimeEntrypoint), ["default"])
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
    "consult_agents",
    "task_status",
    "task_output",
    "task_cancel",
    "workspace_release",
  ])
  assert.match(plugin.tool.delegate_task.description, /Available categories:/)
  assert.match(plugin.tool.delegate_task.description, /browser-automation/)
  assert.ok(plugin.tool.delegate_task.args.load_skills)
  assert.match(plugin.tool.consult_agents.description, /Explorer or Librarian/)
  assert.ok(plugin.tool.consult_agents.args.requests)
  assert.equal(plugin.tool.consult_agents.args.run_in_background, undefined)
  assert.equal(plugin.tool.consult_agents.args.category, undefined)
  assert.equal(plugin.tool.consult_agents.args.load_skills, undefined)
  assert.equal(plugin.tool.consult_agents.args.workspace_id, undefined)
  assert.equal(typeof plugin.event, "function")
  assert.equal(typeof plugin["chat.params"], "function")
  assert.equal(typeof plugin["permission.ask"], "function")
})

test("plugin entrypoint initializes with the full tool set outside Git", async (t) => {
  clearDelegationControlPlanesForTest()
  const directory = await mkdtemp(join(tmpdir(), "delegation-plugin-non-git-directory-"))
  const stateDirectory = await mkdtemp(join(tmpdir(), "delegation-plugin-non-git-state-"))
  t.after(async () => {
    clearDelegationControlPlanesForTest()
    await Promise.all([
      rm(directory, { recursive: true }),
      rm(stateDirectory, { recursive: true }),
    ])
  })

  const plugin = await DelegationRuntimePlugin({
    client: client(),
    directory,
    serverUrl: new URL("http://127.0.0.1:40201"),
  }, { stateDirectory, skillRoots: [] })

  assert.deepEqual(Object.keys(plugin.tool), [
    "workspace_prepare",
    "delegate_task",
    "consult_agents",
    "task_status",
    "task_output",
    "task_cancel",
    "workspace_release",
  ])
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
  assert.doesNotMatch(entry, /oh-my-openagent|opencode.*(?:internal|src)/i)
  const hooks = await readFile(new URL("../plugins/delegation/plugin-hooks.js", import.meta.url), "utf8")
  assert.match(hooks, /from "@opencode-ai\/plugin"/)
  assert.doesNotMatch(hooks, /oh-my-openagent|opencode.*(?:internal|src)/i)
})

test("OpenCode configuration is OMO-free and owns the public CodeGraph MCP entry", async () => {
  const config = await readFile(new URL("../opencode.jsonc", import.meta.url), "utf8")
  const tui = await readFile(new URL("../tui.json", import.meta.url), "utf8")
  assert.doesNotMatch(`${config}\n${tui}`, /oh-my-openagent|call_omo_agent/)
  assert.match(config, /"codegraph"/)
  assert.match(config, /"codegraph",\s*"serve",\s*"--mcp"/s)
  assert.match(config, /"enabled": true/)
})
