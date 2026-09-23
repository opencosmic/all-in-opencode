import test from "node:test"
import assert from "node:assert/strict"

import { AgentDispatcher } from "../plugins/delegation/agent-dispatcher.js"
import { CategoryEngine, DEFAULT_CATEGORIES } from "../plugins/delegation/category-engine.js"

test("built-in categories resolve to Implementer with model, variant, description, and prompt append", () => {
  const engine = new CategoryEngine({})
  for (const [name, expected] of Object.entries(DEFAULT_CATEGORIES)) {
    const result = engine.resolve(name)
    assert.equal(result.agent, "Implementer")
    assert.equal(result.category, name)
    assert.equal(result.profile.model, expected.model)
    assert.equal(result.profile.variant, expected.variant)
    assert.equal(result.profile.description, expected.description)
    assert.equal(result.profile.prompt_append, expected.prompt_append ?? "")
    assert.equal(result.profile.family, expected.family)
    assert.match(result.profile.prompt_append, new RegExp(`<Category_Context name="${name}">`))
  }
})

test("category engine consumes injected categories and does not read a config file", () => {
  const engine = new CategoryEngine({ userCategories: {} })
  assert.equal(engine.has("quick"), true)
  assert.equal(engine.resolve("quick").agent, "Implementer")
})

test("category context meaningfully specializes the shared executor", () => {
  const engine = new CategoryEngine({})
  const expected = new Map([
    ["quick", /small, contained task/i],
    ["deep", /root-cause fix/i],
    ["visual-engineering", /design system/i],
    ["testing", /discriminating tests/i],
    ["git", /explicitly authorized Git operation/i],
    ["video-analysis", /actual video/i],
    ["blender-previs", /already defined ShotSpec|Producer request/i],
  ])
  for (const [name, pattern] of expected) assert.match(engine.resolve(name).profile.prompt_append, pattern)
  const previs = engine.resolve("blender-previs")
  assert.equal(previs.profile.family, "implementation")
  assert.match(previs.profile.description, /Lightweight Blender previs/i)
  assert.match(previs.profile.prompt_append, /calling Director or transitional Producer must supply explicit absolute runtime artifact destinations inside the active production workspace/i)
  assert.match(previs.profile.prompt_append, /production\/previs\/<shot-or-group>\//i)
  assert.match(previs.profile.prompt_append, /only the separately labeled absolute runtime destinations are usable for Blender I\/O/i)
  assert.match(previs.profile.prompt_append, /never pass a workspace-relative destination to Blender/i)
  assert.match(previs.profile.prompt_append, /never.*reinterpret or rebase a supplied path.*rely on Blender's working directory/i)
  assert.match(previs.profile.prompt_append, /Do not discover the workspace root or create parent directories/i)
  assert.match(previs.profile.prompt_append, /If a supplied runtime destination is not absolute.*stop/i)
  assert.match(previs.profile.prompt_append, /Use exactly those supplied absolute paths.*invent a path/i)
  assert.match(previs.profile.prompt_append, /Producer uses production_prepare_artifacts to prepare and verify the exact parent directories.*before delegation/i)
  assert.match(previs.profile.prompt_append, /Assume those parent directories already exist/i)
  assert.match(previs.profile.prompt_append, /If a required parent is missing, fail clearly and report the supplied destination and missing parent/i)
  assert.match(previs.profile.prompt_append, /do not create directories from Blender.*invent paths.*list or explore the filesystem/i)
  assert.doesNotMatch(previs.profile.prompt_append, /create only the exact parent director(?:y|ies)/i)
  assert.match(previs.profile.prompt_append, /Blender Python is not an operating-system sandbox/i)
  assert.match(previs.profile.prompt_append, /filesystem.*process.*shell.*network.*bypass denied OpenCode capabilities/i)
  assert.match(previs.profile.prompt_append, /cheapest reliable viewport\/OpenGL\/playblast path, then Workbench.*lightweight Eevee only/i)
  assert.match(previs.profile.prompt_append, /ordinary previs must not use Cycles, high sample counts, expensive denoising/i)
  assert.match(previs.profile.prompt_append, /480×270.*320×180.*should not exceed 720p/s)
  assert.match(previs.profile.prompt_append, /8–12 fps.*instead of inheriting the final ShotSpec frame rate/i)
  assert.match(previs.profile.prompt_append, /Preserve the ShotSpec's real duration.*about 50 frames, not a shortened/i)
  assert.match(previs.profile.prompt_append, /MCP timeout.*completion ambiguous/i)
  assert.match(previs.profile.prompt_append, /Do not claim success without evidence.*automatically repeat the same render\/playblast/i)
  assert.match(previs.profile.prompt_append, /verify only those exact supplied paths/i)
  for (const tool of [
    "blender_get_addon_status",
    "blender_get_scene_info",
    "blender_get_object_info",
    "blender_get_viewport_screenshot",
    "blender_execute_blender_code",
  ]) assert.equal(previs.profile.tools[tool], true, tool)
})

test("blender-previs verifies requested motion before rendering and preserves Watch review", () => {
  const prompt = new CategoryEngine({}).resolve("blender-previs").profile.prompt_append
  const gateStart = prompt.indexOf("Before generating any moving preview MP4")
  const mp4Allowed = prompt.indexOf("Only after every requested moving target passes may the MP4 be generated")
  assert.ok(gateStart >= 0, "moving shots require a pre-render motion gate")
  assert.ok(mp4Allowed > gateStart, "the MP4 is authorized only after verification")

  const gateEnd = prompt.indexOf("The calling Director or transitional Producer must supply", gateStart)
  const gate = prompt.slice(gateStart, gateEnd)
  assert.match(gate, /frame_start.*floor\(\(frame_start \+ frame_end\) \/ 2\).*frame_end/s)
  assert.match(gate, /Blender-native scene evaluation.*evaluated dependency graph.*evaluated world transform/i)
  assert.match(gate, /requested camera motion.*world-space location and rotation.*all three samples/s)
  assert.match(gate, /meaningful and consistent with the intent/s)
  assert.match(gate, /pan\/tilt may pass through orientation change with fixed location/i)
  assert.match(gate, /Do not apply one universal numeric threshold/i)
  assert.match(gate, /requested subject\/object motion.*relevant proxy.*evaluated world transform or relevant animation state/s)
  assert.match(gate, /If both camera and subject motion are requested, verify both/i)
  assert.match(gate, /locked\/static camera must not fail.*genuinely static shot does not need a motion gate/s)
  assert.match(gate, /If any requested motion is absent.*do not generate the preview MP4.*Correct the animation first/s)
  assert.match(gate, /MOTION_NOT_IMPLEMENTED.*MOTION_VERIFICATION_FAILED/s)
  assert.match(gate, /transient start\/middle\/end transform evidence/i)
  assert.match(gate, /after MP4 generation, Watch review remains required and authoritative/i)
})

test("retired browser category is absent even when user config tries to add it", () => {
  const engine = new CategoryEngine({
    "browser-automation": { model: "provider/model", description: "retired" },
  })
  assert.equal(engine.has("browser-automation"), false)
  assert.equal(engine.list().some((entry) => entry.name === "browser-automation"), false)
  assert.throws(() => engine.resolve("browser-automation"), /unknown delegation category.*Available/)
})

test("user category fields override built-ins without recursive merging", () => {
  const engine = new CategoryEngine({
    deep: {
      model: "example/replacement",
      variant: "max",
      prompt_append: "Use the replacement mindset.",
      tools: { bash: false },
    },
  })
  const { profile } = engine.resolve("deep")
  assert.equal(profile.model, "example/replacement")
  assert.equal(profile.variant, "max")
  assert.equal(profile.prompt_append, "Use the replacement mindset.")
  assert.deepEqual(profile.tools, { bash: false })
  assert.equal(profile.description, DEFAULT_CATEGORIES.deep.description)
})

test("built-in family labels are canonical while other fields remain overridable", () => {
  const engine = new CategoryEngine({
    deep: {
      family: " implementation ",
      model: "example/replacement",
      variant: "max",
    },
  })
  const result = engine.resolve("deep")
  assert.equal(result.category, "deep")
  assert.equal(result.agent, "Implementer")
  assert.equal(result.profile.family, "implementation")
  assert.equal(result.profile.model, "example/replacement")
  assert.equal(result.profile.variant, "max")
})

test("conflicting built-in family overrides fail at the CategoryEngine boundary", () => {
  assert.throws(
    () => new CategoryEngine({ standard: { family: "media" } }),
    /Built-in category "standard" has immutable family "implementation"; received "media"/,
  )
  assert.throws(
    () => new CategoryEngine({ "media-generation": { family: "implementation" } }),
    /Built-in category "media-generation" has immutable family "media"; received "implementation"/,
  )
})

test("custom categories and families are accepted through injected AIO config", () => {
  const engine = new CategoryEngine({
    "backend-heavy": {
      family: " backend ",
      description: "Complex backend implementation work",
      model: "provider/model",
      variant: "high",
    },
  })
  assert.deepEqual(engine.list().find((entry) => entry.name === "backend-heavy"), {
    name: "backend-heavy",
    description: "Complex backend implementation work",
    model: "provider/model",
    variant: "high",
    family: "backend",
  })
  assert.equal(engine.resolve("backend-heavy").profile.model, "provider/model")
  assert.equal(engine.resolve("backend-heavy").profile.family, "backend")
})

test("disabled categories are absent from presentation and fail when explicitly selected", () => {
  const engine = new CategoryEngine({
    deep: { disable: true },
    "unused-category": { disable: true },
  })
  assert.equal(engine.has("deep"), false)
  assert.equal(engine.has("unused-category"), false)
  assert.equal(engine.list().some((entry) => ["deep", "unused-category"].includes(entry.name)), false)
  assert.throws(() => engine.resolve("deep"), /disabled/)
})

test("unknown and invalid categories fail closed with useful errors", () => {
  const engine = new CategoryEngine({
    "missing-model": { description: "fixture" },
  })
  assert.throws(() => engine.resolve("missing"), /unknown delegation category.*Available/)
  assert.throws(() => engine.resolve("missing-model"), /Category "missing-model" has no configured model/)
  assert.throws(() => new CategoryEngine({ bad: { reasoning: "high" } }), /unsupported field "reasoning"/)
})

test("category schema has one model and variant, with no fallback or reasoning fields", () => {
  for (const source of Object.values(DEFAULT_CATEGORIES)) {
    assert.equal(Object.hasOwn(source, "models"), false)
    assert.equal(Object.hasOwn(source, "fallback_models"), false)
    assert.equal(Object.hasOwn(source, "reasoning"), false)
  }
  assert.throws(() => new CategoryEngine({ bad: { models: [{ model: "provider/model" }] } }), /unsupported field "models"/)
  assert.throws(() => new CategoryEngine({ bad: { fallback_models: [] } }), /unsupported field "fallback_models"/)
})

test("dispatcher enforces category XOR named agent and allowlists specialists", () => {
  const dispatcher = new AgentDispatcher(new CategoryEngine({}))
  assert.throws(() => dispatcher.resolve({}), /exactly one/)
  assert.throws(() => dispatcher.resolve({ category: "quick", agent: "Reviewer" }), /exactly one/)
  assert.equal(dispatcher.resolve({ category: "quick", parentAgent: "Assistant" }).agent, "Implementer")
  for (const agent of [
    "Explorer",
    "Librarian",
    "Technical Advisor",
    "Plan Reviewer",
    "Researcher",
    "Validator",
    "Reviewer",
    "QA",
    "Searcher",
  ]) assert.equal(dispatcher.resolve({ agent, parentAgent: "Assistant" }).agent, agent)
  assert.throws(() => dispatcher.resolve({ agent: "Browser", parentAgent: "Assistant" }), /not allowed/)
  assert.throws(() => dispatcher.resolve({ agent: "Executor", parentAgent: "Assistant" }), /not allowed/)
  assert.throws(() => dispatcher.resolve({ agent: "RandomAgent", parentAgent: "Assistant" }), /not (?:allowed|available)/)
  assert.throws(() => dispatcher.resolve({ agent: "Verifier" }), /only be delegated by Executor/)
})

test("dispatcher enforces stage-specific named delegation boundaries", () => {
  const dispatcher = new AgentDispatcher(new CategoryEngine({}))

  assert.throws(
    () => dispatcher.resolve({ category: "quick", parentAgent: "Strategist" }),
    /Strategist.*category routes are not allowed/,
  )
  assert.throws(
    () => dispatcher.resolve({ category: "quick", parentAgent: "Planner" }),
    /Planner.*category routes are not allowed/,
  )
  assert.equal(dispatcher.resolve({ agent: "Researcher", parentAgent: "Strategist" }).agent, "Researcher")
  assert.equal(dispatcher.resolve({ agent: "Technical Advisor", parentAgent: "Planner" }).agent, "Technical Advisor")
  assert.equal(dispatcher.resolve({ agent: "Verifier", parentAgent: "Executor" }).agent, "Verifier")
  assert.equal(dispatcher.resolve({ category: "quick", parentAgent: "Executor" }).agent, "Implementer")
  assert.throws(
    () => dispatcher.resolve({ agent: "Verifier", parentAgent: "Strategist" }),
    /Strategist cannot delegate named agent Verifier/,
  )
})
