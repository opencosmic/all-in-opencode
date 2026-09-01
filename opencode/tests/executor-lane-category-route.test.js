import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import {
  assessMeasuredOmoCategoryRoute,
  LANE_E2E_CATEGORY_ROUTE_INVALID,
} from "../../scripts/lib/executor-lane-category-route.mjs"

const measuredSource = await readFile(
  "/Users/code/Workspace/repo/oh-my-openagent-concurrent-isolation-worktree/packages/omo-opencode/src/plugin-config/omo-config-chain.ts",
  "utf8",
)
const model = "openai/gpt-5.6-luna"
const validCategory = { model, fallback_models: [], reasoningEffort: "high" }

test("measured category projection retains the lane E2E single-model route", () => {
  const route = assessMeasuredOmoCategoryRoute({ category: validCategory, model, projectionSource: measuredSource })
  assert.deepEqual(route, {
    valid: true, category: "lane-e2e", provider: "openai", model: "gpt-5.6-luna", reasoning: "high",
    fallbackModels: [], source: "measured-omo-category-projection", projected: validCategory,
  })
})

test("old models-only category configuration fails closed before execution", () => {
  const route = assessMeasuredOmoCategoryRoute({ category: { models: [model], fallback_models: [], reasoning: "high" }, model, projectionSource: measuredSource })
  assert.equal(route.valid, false)
  assert.equal(route.code, LANE_E2E_CATEGORY_ROUTE_INVALID)
})

test("wrong model and nonempty fallback are rejected", () => {
  assert.equal(assessMeasuredOmoCategoryRoute({ category: { ...validCategory, model: "openai/gpt-5.6-terra" }, model, projectionSource: measuredSource }).valid, false)
  assert.equal(assessMeasuredOmoCategoryRoute({ category: { ...validCategory, model: "other/gpt-5.6-luna" }, model, projectionSource: measuredSource }).valid, false)
  assert.equal(assessMeasuredOmoCategoryRoute({ category: { ...validCategory, fallback_models: ["openai/gpt-5.6-terra"] }, model, projectionSource: measuredSource }).valid, false)
})
