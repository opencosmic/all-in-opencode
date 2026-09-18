import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile, readdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { isolatedOpenCodeEnv } from "./support/isolated-opencode.js"

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const agentPath = join(repository, "opencode/agents/blender.md")
const coreTools = [
  "blender_get_addon_status",
  "blender_get_scene_info",
  "blender_get_object_info",
  "blender_get_viewport_screenshot",
  "blender_execute_blender_code",
]
const execFileAsync = promisify(execFile)

test("Blender is a dedicated primary agent with an explicit MCP boundary", async () => {
  const source = await readFile(agentPath, "utf8")

  assert.match(source, /^name: Blender$/m)
  assert.match(source, /^mode: primary$/m)
  assert.match(source, /permission:\n  "\*": deny/)
  assert.doesNotMatch(source, /blender_[^\s:]+\*: allow/)

  for (const tool of coreTools) assert.match(source, new RegExp(`^  ${tool}: allow$`, "m"))

  const allowed = [...source.matchAll(/^  ([A-Za-z0-9_*-]+): allow$/gm)].map((match) => match[1])
  assert.deepEqual(allowed.sort(), [...coreTools, "question", "delegate_task", "task_status", "task_output", "task_cancel"].sort())

  for (const denied of [
    "bash",
    "edit",
    "write",
    "task",
    "consult_agents",
    "workspace_prepare",
    "workspace_release",
    "skill",
    "external_directory",
  ]) {
    assert.match(source, new RegExp(`^  ${denied}: deny$`, "m"))
  }

  assert.match(source, /inspect the current scene before acting/i)
  assert.match(source, /fresh scene or viewport evidence after the change/i)
  assert.match(source, /verify the final state before reporting success/i)
  assert.match(source, /Safe Mode is an\s+additional guard, not a complete operating-system sandbox/i)
  assert.match(source, /must not modify\s+workflow source code, Git history, OpenSpec state/i)
  assert.match(source, /CategoryEngine state/i)
  assert.match(source, /Do not directly manipulate internal Delegation Runtime state/i)
  assert.match(source, /public AIO task tools/i)
  assert.match(source, /explicitly configured AIO support\s+categories or families/i)
  assert.match(source, /no default category capability/i)
  assert.match(source, /Do not use Blender Python\s+for generic filesystem, process, network, or shell\s+access/is)
  assert.doesNotMatch(source, /oh-my-openagent|call_omo_agent|Sisyphus-Junior/i)
})

test("Blender's effective route allows only its bounded delegation tool", async (t) => {
  const env = await isolatedOpenCodeEnv(t, repository)
  const { stdout } = await execFileAsync("opencode", ["debug", "agent", "Blender"], { env, encoding: "utf8" })
  const agent = JSON.parse(stdout)

  assert.equal(agent.name, "Blender")
  assert.equal(agent.mode, "primary")
  assert.equal(agent.tools.task, false)
  assert.equal(agent.tools.edit, false)
  for (const tool of ["delegate_task", "task_status", "task_output", "task_cancel"]) {
    assert.equal(agent.tools[tool], true, `${tool} must remain available`)
  }
  assert.equal(effectivePermission(agent, "delegate_task"), "allow")
  assert.equal(effectivePermission(agent, "task_status"), "allow")
  assert.equal(effectivePermission(agent, "task_output"), "allow")
  assert.equal(effectivePermission(agent, "task_cancel"), "allow")
})

function effectivePermission(agent, type) {
  let action
  for (const rule of agent.permission ?? []) {
    if (rule.permission === type && rule.pattern === "*") action = rule.action
  }
  return action
}

test("Blender command targets the standalone primary route", async () => {
  const source = await readFile(join(repository, "opencode/commands/blender.md"), "utf8")
  assert.match(source, /^agent: Blender$/m)
  assert.match(source, /^subtask: false$/m)
  assert.match(source, /\$ARGUMENTS/)
  assert.match(source, /standalone Blender goal/i)
  assert.match(source, /Do not enter OpenSpec, CategoryEngine, Implementer, Git/i)
})

test("ordinary agents do not receive Blender MCP permissions", async () => {
  const directory = join(repository, "opencode/agents")
  const agents = (await readdir(directory)).filter((name) => name.endsWith(".md") && name !== "blender.md")
  for (const name of agents) {
    const source = await readFile(join(directory, name), "utf8")
    assert.doesNotMatch(source, /^  blender_[A-Za-z0-9_*-]+: allow$/m, `${name} must not allow Blender MCP tools`)
  }
})
