import test from "node:test"
import assert from "node:assert/strict"

import { AgentDispatcher } from "../plugins/delegation/agent-dispatcher.js"
import { CategoryEngine, DEFAULT_CATEGORIES } from "../plugins/delegation/category-engine.js"
import { ensurePromptBound } from "../plugins/delegation/session-runner.js"

test("category lookup resolves every implementation category to Implementer", () => {
  const engine = new CategoryEngine()
  for (const category of Object.keys(DEFAULT_CATEGORIES)) {
    const result = engine.resolve(category)
    assert.equal(result.agent, "Implementer")
    assert.equal(result.category, category)
  }
})

test("category model chains preserve deterministic order and prompt append", () => {
  const engine = new CategoryEngine({
    custom: {
      description: "fixture",
      models: [
        { model: "example/fast", reasoning: "low" },
        { model: "example/fallback", reasoning: "high" },
      ],
      variant: "focused",
      prompt_append: "Stay focused.",
    },
  })
  const { profile } = engine.resolve("custom")
  assert.deepEqual(profile.models, [
    { model: "example/fast", reasoning: "low" },
    { model: "example/fallback", reasoning: "high" },
  ])
  assert.equal(profile.prompt_append, "Stay focused.")
  assert.deepEqual(profile.unsupported_public_fields, ["reasoning", "variant"])
})

test("unknown and disabled categories fail closed", () => {
  const engine = new CategoryEngine({ off: { disable: true, models: [] } })
  assert.throws(() => engine.resolve("missing"), /unknown delegation category/)
  assert.throws(() => engine.resolve("off"), /disabled/)
})

test("dispatcher enforces category XOR named agent and allowlists specialists", () => {
  const dispatcher = new AgentDispatcher(new CategoryEngine())
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

test("required workflow categories resolve through the local engine", () => {
  const engine = new CategoryEngine()
  for (const category of [
    "quick",
    "deep",
    "ultrabrain",
    "visual-engineering",
    "writing",
    "artistry",
    "unspecified-low",
    "unspecified-high",
    "git",
    "browser-automation",
  ]) assert.equal(engine.resolve(category).agent, "Implementer")
})

test("unsupported category fields are rejected instead of ignored", () => {
  const engine = new CategoryEngine({ unsafe: { models: [], imaginary: true } })
  assert.throws(() => engine.resolve("unsafe"), /unsupported category field/)
})

test("max prompt tokens is enforced before session execution", () => {
  assert.doesNotThrow(() => ensurePromptBound("12345678", 2))
  assert.throws(() => ensurePromptBound("123456789", 2), /exceeds max_prompt_tokens/)
})
