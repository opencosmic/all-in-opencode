import test from "node:test"
import assert from "node:assert/strict"

import { assessExecutorAliasRoute, ownedLaneExternalDirectoryPermission } from "../../scripts/probes/executor-lane-runtime.mjs"

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
