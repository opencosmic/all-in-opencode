import test from "node:test"
import assert from "node:assert/strict"
import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { AgentDispatcher } from "../plugins/delegation/agent-dispatcher.js"
import { CategoryEngine, DEFAULT_CATEGORIES, DEFAULT_CATEGORY_CONFIG_PATH } from "../plugins/delegation/category-engine.js"

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
    assert.match(result.profile.prompt_append, new RegExp(`<Category_Context name="${name}">`))
  }
})

test("missing user-local category config keeps built-ins available without creating a file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "missing-category-config-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const missingPath = join(root, "missing", "categories.json")

  assert.equal(DEFAULT_CATEGORY_CONFIG_PATH, join(homedir(), ".config", "opencode", "categories.json"))
  assert.equal(DEFAULT_CATEGORY_CONFIG_PATH.includes("/opencode-workflow/opencode/categories.json"), false)
  const engine = new CategoryEngine(undefined, { configPath: missingPath })
  assert.equal(engine.has("quick"), true)
  assert.equal(engine.resolve("quick").agent, "Implementer")
  await assert.rejects(access(missingPath), { code: "ENOENT" })
})

test("category context meaningfully specializes the shared executor", () => {
  const engine = new CategoryEngine({})
  const expected = new Map([
    ["quick", /small, contained task/i],
    ["deep", /root-cause fix/i],
    ["visual-engineering", /design system/i],
    ["testing", /discriminating tests/i],
    ["git", /explicitly authorized Git operation/i],
    ["browser-automation", /fresh browser state/i],
    ["video-analysis", /actual video/i],
  ])
  for (const [name, pattern] of expected) assert.match(engine.resolve(name).profile.prompt_append, pattern)
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

test("custom categories load from explicit local configuration without editing JavaScript", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "category-config-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const configPath = join(root, "categories.json")
  await writeFile(configPath, JSON.stringify({ categories: {
    "backend-heavy": {
      description: "Complex backend implementation work",
      model: "provider/model",
      variant: "high",
    },
  }}))
  const engine = new CategoryEngine(undefined, { configPath })
  assert.deepEqual(engine.list().find((entry) => entry.name === "backend-heavy"), {
    name: "backend-heavy",
    description: "Complex backend implementation work",
    model: "provider/model",
    variant: "high",
  })
  assert.equal(engine.resolve("backend-heavy").profile.model, "provider/model")
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

test("invalid existing category config still fails clearly", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "invalid-category-config-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const configPath = join(root, "categories.json")
  await writeFile(configPath, JSON.stringify({ categories: { broken: { model: 42 } } }))

  assert.throws(
    () => new CategoryEngine(undefined, { configPath }),
    /invalid category config .*category "broken" field "model" must be a string/,
  )
})

test("dispatcher enforces category XOR named agent and allowlists specialists", () => {
  const dispatcher = new AgentDispatcher(new CategoryEngine({}))
  assert.throws(() => dispatcher.resolve({}), /exactly one/)
  assert.throws(() => dispatcher.resolve({ category: "quick", agent: "Reviewer" }), /exactly one/)
  assert.equal(dispatcher.resolve({ category: "quick" }).agent, "Implementer")
  for (const agent of [
    "Explorer",
    "Librarian",
    "Technical Advisor",
    "Plan Reviewer",
    "Researcher",
    "Validator",
    "Reviewer",
    "QA",
  ]) assert.equal(dispatcher.resolve({ agent }).agent, agent)
  assert.throws(() => dispatcher.resolve({ agent: "Executor" }), /not allowed/)
  assert.throws(() => dispatcher.resolve({ agent: "RandomAgent" }), /not allowed/)
})
