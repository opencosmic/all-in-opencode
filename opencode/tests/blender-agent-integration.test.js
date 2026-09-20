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

test("Blender is a reusable all-mode leaf with an explicit MCP boundary", async () => {
  const source = await readFile(agentPath, "utf8")

  assert.match(source, /^name: Blender$/m)
  assert.match(source, /^mode: all$/m)
  assert.match(source, /permission:\n  "\*": deny/)
  assert.doesNotMatch(source, /blender_[^\s:]+\*: allow/)

  for (const tool of coreTools) assert.match(source, new RegExp(`^  ${tool}: allow$`, "m"))

  const allowed = [...source.matchAll(/^  ([A-Za-z0-9_*-]+): allow$/gm)].map((match) => match[1])
  assert.deepEqual(allowed.sort(), [...coreTools, "question"].sort())

  for (const denied of [
    "bash",
    "edit",
    "write",
    "task",
    "delegate_task",
    "consult_agents",
    "workspace_prepare",
    "workspace_release",
    "task_status",
    "task_output",
    "task_cancel",
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
  assert.match(source, /reusable 3D leaf specialist/i)
  assert.match(source, /never create or\s+manage child AIO tasks/i)
  assert.match(source, /If external work is needed, return the\s+requirement to the parent/i)
  assert.match(source, /GLB\/glTF\/FBX/i)
  assert.match(source, /animation names, material slots, constraints/i)
  assert.match(source, /fast, rough validation/i)
  assert.match(source, /4K beauty render/i)
  assert.match(source, /Do not use Blender Python\s+for generic filesystem, process, network, or shell\s+access/is)
  assert.doesNotMatch(source, /oh-my-openagent|call_omo_agent|Sisyphus-Junior/i)
})

test("Blender's effective route denies child-task controls", async (t) => {
  const env = await isolatedOpenCodeEnv(t, repository)
  const { stdout } = await execFileAsync("opencode", ["debug", "agent", "Blender"], { env, encoding: "utf8" })
  const agent = JSON.parse(stdout)

  assert.equal(agent.name, "Blender")
  assert.equal(agent.mode, "all")
  for (const tool of ["task", "edit", "delegate_task", "task_status", "task_output", "task_cancel"]) {
    assert.notEqual(agent.tools[tool], true, `${tool} must remain unavailable`)
    assert.equal(effectivePermission(agent, tool), "deny", `${tool} must remain denied`)
  }
})

function effectivePermission(agent, type) {
  let action
  for (const rule of agent.permission ?? []) {
    if (rule.permission === type && rule.pattern === "*") action = rule.action
  }
  return action
}

test("Blender command targets the standalone direct route", async () => {
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
