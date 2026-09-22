import test from "node:test"
import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { AgentDispatcher } from "../plugins/delegation/agent-dispatcher.js"
import { CategoryEngine } from "../plugins/delegation/category-engine.js"

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const phases = {
  Director: ["blender-previs", "video-analysis"],
  Creator: ["media-generation", "video-analysis"],
  Editor: ["video-analysis"],
}

test("phase owners are dedicated subagents with bounded permissions", async () => {
  const producer = await readFile(join(repository, "opencode/agents/producer.md"), "utf8")
  assert.match(producer, /^mode: primary$/m)
  for (const name of Object.keys(phases)) {
    const source = await readFile(join(repository, `opencode/agents/${name.toLowerCase()}.md`), "utf8")
    assert.match(source, new RegExp(`^name: ${name}$`, "m"))
    assert.match(source, /^mode: subagent$/m)
    assert.match(source, /^  delegate_task: allow$/m)
    assert.match(source, /^  question: deny$/m)
    assert.match(source, /^  task: deny$/m)
    assert.doesNotMatch(source, /^  blender_[^:]+: allow$/m)
    assert.doesNotMatch(source, /^  media_(?:calculate|upload|generate_image|generate_video|prediction|wait_prediction): allow$/m)
  }
  const editor = await readFile(join(repository, "opencode/agents/editor.md"), "utf8")
  assert.match(editor, /^    "hyperframes": allow$/m)
  assert.match(editor, /^    "hyperframes-\*": allow$/m)
  assert.match(editor, /^    "npx hyperframes \*": allow$/m)
  assert.match(editor, /^    "git \*": deny$/m)
  assert.match(editor, /^    "npx skills \*": deny$/m)
  assert.match(editor, /^    "npx hyperframes init": ask$/m)
  assert.match(editor, /^  external_directory: ask$/m)
})

test("phase-owner hard ceilings survive user config union and forbid cross-phase delegation", () => {
  const delegation = Object.fromEntries(Object.keys(phases).map((caller) => [caller, {
    categories: ["quick", "standard", "git", "database", "browser-testing", "blender-previs", "media-generation", "video-analysis"],
    category_families: ["implementation", "media"],
    agents: ["Director", "Creator", "Editor", "Blender"],
  }]))
  delegation.Producer = { categories: [], category_families: [], agents: ["Blender"] }
  delegation.Assistant = { categories: [], category_families: [], agents: ["Director", "Creator", "Editor"] }
  const route = new AgentDispatcher(new CategoryEngine({}), { aioConfig: { version: 1, delegation } })

  for (const agent of Object.keys(phases)) {
    assert.equal(route.resolve({ agent, parentAgent: "Producer" }).agent, agent)
    assert.throws(() => route.resolve({ agent, parentAgent: "Assistant" }), /named agent is not allowed/)
    for (const category of ["blender-previs", "media-generation", "video-analysis", "quick", "standard", "git", "database", "browser-testing"]) {
      if (phases[agent].includes(category)) assert.equal(route.resolve({ category, parentAgent: agent }).category, category)
      else assert.throws(() => route.resolve({ category, parentAgent: agent }), /not allowed/)
    }
    for (const other of ["Director", "Creator", "Editor", "Blender"]) {
      assert.throws(() => route.resolve({ agent: other, parentAgent: agent }), /cannot delegate named agent/)
    }
  }
  assert.throws(() => route.resolve({ agent: "Blender", parentAgent: "Producer" }), /cannot delegate named agent Blender/)
  assert.equal(route.resolve({ agent: "Blender", parentAgent: "Executor" }).agent, "Blender")
})

test("phase-owner named routes alone retain bounded nested delegation", () => {
  const route = new AgentDispatcher(new CategoryEngine({}))
  for (const name of Object.keys(phases)) {
    const profile = route.resolve({ agent: name, parentAgent: "Producer" }).profile
    assert.equal(profile.tools.delegate_task, true)
    assert.equal(profile.tools.task_status, true)
    assert.equal(profile.tools.workspace_prepare, false)
    assert.equal(profile.tools.task, false)
  }
  for (const [caller, name] of [["Assistant", "Explorer"], ["Assistant", "Searcher"], ["Executor", "Reviewer"], ["Executor", "Blender"]]) {
    const profile = route.resolve({ agent: name, parentAgent: caller }).profile
    assert.equal(profile.tools.delegate_task, false)
    assert.equal(profile.tools.task_status, false)
  }
})

test("live commands stay on Producer and no composition category or HyperFrames agent appears", async () => {
  const commands = await readdir(join(repository, "opencode/commands"))
  const agents = await readdir(join(repository, "opencode/agents"))
  for (const name of ["director", "creator", "editor"]) assert.equal(commands.includes(`${name}.md`), false)
  assert.equal(agents.includes("hyperframes.md"), false)
  assert.equal(new CategoryEngine({}).list().some(({ name }) => name === "video-composition"), false)
  for (const command of ["video", "film"]) {
    assert.match(await readFile(join(repository, `opencode/commands/${command}.md`), "utf8"), /^agent: Producer$/m)
  }
})
