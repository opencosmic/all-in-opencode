import test from "node:test"
import assert from "node:assert/strict"

import { assessExecutorAliasRoute, assessObservedAgentLookup, ownedLaneExternalDirectoryPermission } from "../../scripts/probes/executor-lane-runtime.mjs"

test("runtime permits only roots and descendants of provenance-owned lane worktrees", () => {
  const lanes = { T1: "/fixture/lanes/T1", T2: "/fixture/lanes/T2" }

  assert.deepEqual(ownedLaneExternalDirectoryPermission(lanes), {
    "*": "deny",
    "/fixture/lanes/T1": "allow",
    "/fixture/lanes/T1/*": "allow",
    "/fixture/lanes/T2": "allow",
    "/fixture/lanes/T2/*": "allow",
  })
})

test("lowercase execute alias requires the canonical prompt and exact Luna/high route", () => {
  const expected = "a".repeat(64)
  const config = { model: { providerID: "openai", modelID: "gpt-5.6-luna" }, variant: "high" }
  const fallback = { model: false, runtime: false }
  assert.equal(assessExecutorAliasRoute({ config, model: "openai/gpt-5.6-luna", promptSha256: expected, expectedPromptSha256: expected, fallback }), true)
  assert.equal(assessExecutorAliasRoute({ config, model: "openai/gpt-5.6-luna", promptSha256: "b".repeat(64), expectedPromptSha256: expected, fallback }), false)
  assert.equal(assessExecutorAliasRoute({ config: { ...config, model: { providerID: "openai", modelID: "gpt-5.6-terra" } }, model: "openai/gpt-5.6-luna", promptSha256: expected, expectedPromptSha256: expected, fallback }), false)
  assert.equal(assessExecutorAliasRoute({ config: { ...config, variant: "medium" }, model: "openai/gpt-5.6-luna", promptSha256: expected, expectedPromptSha256: expected, fallback }), false)
  assert.equal(assessExecutorAliasRoute({ config, model: "openai/gpt-5.6-luna", promptSha256: expected, expectedPromptSha256: expected, fallback: { model: true, runtime: false } }), false)
})

test("bounded native lookup proves only the resolved lowercase Executor route", () => {
  const expected = "a".repeat(64)
  const fallback = { model: false, runtime: false }
  const observation = { processExited: true, exitCode: 0, timedOut: false, jsonComplete: true }
  const config = { name: "executor", model: { providerID: "openai", modelID: "gpt-5.6-luna" }, variant: "high" }
  const input = { role: "executor", observation, config, model: "openai/gpt-5.6-luna", promptSha256: expected, expectedPromptSha256: expected, fallback }

  assert.equal(assessObservedAgentLookup(input), true)
  assert.equal(assessObservedAgentLookup({ ...input, config: { ...config, name: "wrong-route" } }), false)
  assert.equal(assessObservedAgentLookup({ ...input, config: null }), false)
  assert.equal(assessObservedAgentLookup({ ...input, observation: { ...observation, timedOut: true } }), false)
})

test("Executor route proof and Plan Reviewer approval remain separate dimensions", () => {
  const observation = { processExited: true, exitCode: 0, timedOut: false, jsonComplete: true }
  const reviewer = { name: "Plan Reviewer", model: { providerID: "openai", modelID: "gpt-5.6-luna" }, variant: "high" }
  assert.equal(assessObservedAgentLookup({
    role: "Plan Reviewer", observation, config: reviewer, model: "openai/gpt-5.6-luna", reasoning: "high",
  }), true)
  assert.equal(assessObservedAgentLookup({
    role: "executor", observation, config: reviewer, model: "openai/gpt-5.6-luna",
    promptSha256: "a".repeat(64), expectedPromptSha256: "a".repeat(64), fallback: { model: false, runtime: false },
  }), false)
})

test("bounded lookup accepts a category-derived high reasoning route", () => {
  const observation = { processExited: true, exitCode: 0, timedOut: false, jsonComplete: true }
  const config = { name: "Sisyphus-Junior", model: { providerID: "openai", modelID: "gpt-5.6-luna" } }
  assert.equal(assessObservedAgentLookup({
    role: "Sisyphus-Junior", observation, config, model: "openai/gpt-5.6-luna", reasoning: "high",
  }), true)
  assert.equal(assessObservedAgentLookup({
    role: "Sisyphus-Junior", observation, config, model: "openai/gpt-5.6-luna", reasoning: "medium",
  }), false)
})
