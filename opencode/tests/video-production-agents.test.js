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
    for (const tool of [
      "production_preflight", "production_prepare_artifacts", "production_checkpoint",
      "production_approve_generation", "production_record_output", "production_approve_final_render",
      "production_set_shots", "production_transition",
    ]) {
      assert.match(source, new RegExp(`^  ${tool}: deny$`, "m"))
    }
    assert.match(source, /^  question: deny$/m)
    assert.match(source, /^  task: deny$/m)
    assert.doesNotMatch(source, /^  blender_[^:]+: allow$/m)
    assert.doesNotMatch(source, /^  media_(?:calculate|upload|generate_image|generate_video|prediction|wait_prediction): allow$/m)
  }
  const editor = await readFile(join(repository, "opencode/agents/editor.md"), "utf8")
  const director = await readFile(join(repository, "opencode/agents/director.md"), "utf8")
  assert.match(director, /^  edit: deny$/m)
  assert.match(director, /^  write: deny$/m)
  assert.match(director, /PLAN assignment[\s\S]*complete\s+canonical ShotSpec objects/)
  assert.match(director, /Before authoring or revising any canonical ShotSpec,\s+read `film-production\/references\/shot-spec\.md`/s)
  assert.match(director, /Canonical `ShotSpec\.output` describes final delivery intent.*Preview resolution,\s+preview FPS, and preview frame count are transient `blender-previs` execution\s+parameters.*unless the user explicitly\s+requested those values for final delivery/s)
  assert.doesNotMatch(director, /production_(?:preflight|prepare_artifacts|checkpoint|set_shots|transition): allow/)
  assert.match(director, /PREVIS assignment[\s\S]*absolute runtime\s+destinations prepared by Producer/)
  assert.match(director, /DIRECTOR_NEEDS_USER_INPUT[\s\S]*Producer asks/)
  assert.match(director, /DIRECTOR_NEEDS_ARTIFACT_PREPARATION[\s\S]*Producer prepares/)
  assert.match(director, /Director PREVIS|PREVIS assignment/)
  assert.match(director, /video-analysis.*load_skills=\["watch"\]/s)
  assert.match(director, /PASS.*REVISION_REQUIRED.*BLOCKED/s)
  assert.match(director, /Do not blindly repeat an artifact-producing operation/)
  assert.match(editor, /^    "hyperframes": allow$/m)
  assert.match(editor, /^    "hyperframes-\*": allow$/m)
  assert.match(editor, /^    "npx hyperframes \*": deny$/m)
  assert.match(editor, /^    "git \*": deny$/m)
  assert.match(editor, /^    "npx skills \*": deny$/m)
  assert.match(editor, /^    "npx hyperframes init": ask$/m)
  assert.match(editor, /Producer obtains the user's approval and records it for that rough-cut digest, project path, and final output path/s)
  assert.match(editor, /You may delegate only `video-analysis`/)
  assert.match(editor, /^  production_record_output: deny$/m)
  assert.match(editor, /^  production_approve_final_render: deny$/m)
  assert.match(editor, /^  external_directory: ask$/m)
})

test("only the live M3 phase owners use GPT-6 Sol high", async () => {
  const agents = Object.fromEntries(await Promise.all(
    ["producer", "director", "creator", "editor"].map(async (name) => [
      name,
      await readFile(join(repository, `opencode/agents/${name}.md`), "utf8"),
    ]),
  ))

  for (const name of ["producer", "director"]) {
    assert.match(agents[name], /^model: openai\/gpt-6-sol$/m, name)
    assert.match(agents[name], /^variant: high$/m, name)
  }
  for (const name of ["creator", "editor"]) {
    assert.match(agents[name], /^model: openai\/gpt-6\.1-sol$/m, name)
    assert.match(agents[name], /^variant: high$/m, name)
  }

  const creator = agents.creator
  for (const permission of ["bash", "edit", "write", "question"]) {
    assert.match(creator, new RegExp(`^  ${permission}: deny$`, "m"), permission)
  }
  assert.match(creator, /Stop for Producer's explicit user\s+approval/)
  assert.match(creator, /^  production_approve_generation: deny$/m)
  assert.match(creator, /^  production_record_output: deny$/m)
  assert.match(creator, /^  production_approve_final_render: deny$/m)
  assert.match(agents.producer, /^  production_approve_generation: allow$/m)
  assert.match(agents.producer, /^  production_record_output: allow$/m)
  assert.match(agents.producer, /^  production_approve_final_render: allow$/m)
  assert.match(creator, /Allow at most two revision rounds after the first generated result/)
  assert.match(creator, /`media-generation` and\s+`video-analysis`/)
  assert.doesNotMatch(creator, /production_(?:preflight|prepare_artifacts|checkpoint|set_shots|transition): allow/)
  assert.doesNotMatch(agents.producer, /GPT Image 2\.5 Sunburst|Seedream 5 Pro|MiniMax H3|Seedance 2\.5/)
  assert.match(agents.producer, /must not delegate\s+`media-generation` directly/)
  assert.match(agents.producer, /Producer registers the rough cut with\s+`production_record_output`.*`production_approve_final_render`/s)
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
  assert.throws(() => route.resolve({ category: "blender-previs", parentAgent: "Producer" }), /not allowed/)
  assert.throws(() => route.resolve({ category: "media-generation", parentAgent: "Producer" }), /not allowed/)
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
    for (const tool of [
      "production_preflight", "production_prepare_artifacts", "production_checkpoint",
      "production_approve_generation", "production_record_output", "production_approve_final_render", "production_set_shots", "production_transition",
    ]) assert.equal(profile.tools[tool], false)
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
