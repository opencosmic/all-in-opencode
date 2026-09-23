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

test("plugin entrypoint is default-only and exposes the project-owned delegation tools", async (t) => {
  assert.deepEqual(Object.keys(DelegationRuntimeEntrypoint), ["default"])
  const stateDirectory = await mkdtemp(join(tmpdir(), "delegation-plugin-test-"))
  t.after(async () => rm(stateDirectory, { recursive: true }))
  const plugin = await DelegationRuntimePlugin({
    client: client(),
    directory: fileURLToPath(new URL("../..", import.meta.url)),
    serverUrl: new URL("http://127.0.0.1:40200"),
  }, { stateDirectory, aioConfig: { version: 1 } })
  assert.deepEqual(Object.keys(plugin.tool), [
    "execution_preflight",
    "workspace_prepare",
    "workspace_checkpoint_update",
    "production_preflight",
    "production_prepare_artifacts",
    "production_checkpoint",
    "delegate_task",
    "consult_agents",
    "task_status",
    "task_output",
    "task_cancel",
    "workspace_release",
    "media_calculate",
    "media_upload",
    "media_generate_image",
    "media_generate_video",
    "media_prediction",
    "media_wait_prediction",
  ])
  assert.match(plugin.tool.execution_preflight.description, /current Git.*persisted task.*source-overlap/i)
  assert.ok(plugin.tool.execution_preflight.args.change_id)
  assert.ok(plugin.tool.workspace_release.args.finalize_in_place)
  assert.ok(plugin.tool.workspace_release.args.integration_branch)
  assert.ok(plugin.tool.workspace_checkpoint_update.args.status)
  assert.ok(plugin.tool.production_preflight.args.project_id)
  assert.ok(plugin.tool.production_prepare_artifacts.args.paths)
  assert.equal(plugin.tool.production_checkpoint.args.phase, undefined)
  assert.equal(plugin.tool.production_checkpoint.args.updated_at, undefined)
  assert.equal(plugin.tool.workspace_checkpoint_update.args.head_sha, undefined)
  assert.equal(plugin.tool.workspace_checkpoint_update.args.updated_at, undefined)
  assert.doesNotMatch(plugin.tool.delegate_task.description, /Available categories:/)
  assert.match(plugin.tool.delegate_task.description, /exactly one of category or agent/)
  assert.match(plugin.tool.delegate_task.description, /caller-specific AIO delegation context/)
  assert.match(plugin.tool.delegate_task.description, /children created by this parent session/)
  assert.doesNotMatch(plugin.tool.delegate_task.description, /browser-automation/)
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
  }, { stateDirectory, skillRoots: [], aioConfig: { version: 1 } })

  assert.deepEqual(Object.keys(plugin.tool), [
    "execution_preflight",
    "workspace_prepare",
    "workspace_checkpoint_update",
    "production_preflight",
    "production_prepare_artifacts",
    "production_checkpoint",
    "delegate_task",
    "consult_agents",
    "task_status",
    "task_output",
    "task_cancel",
    "workspace_release",
    "media_calculate",
    "media_upload",
    "media_generate_image",
    "media_generate_video",
    "media_prediction",
    "media_wait_prediction",
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
