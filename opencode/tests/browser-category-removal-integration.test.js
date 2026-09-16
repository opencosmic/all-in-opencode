import test from "node:test"
import assert from "node:assert/strict"

import { CategoryEngine } from "../plugins/delegation/category-engine.js"
import { categoryPermission, categorySessionPermission } from "../plugins/delegation/category-permissions.js"

test("browser-automation is not a registered Implementer category", () => {
  const engine = new CategoryEngine({})
  assert.equal(engine.has("browser-automation"), false)
  assert.equal(engine.list().some((entry) => entry.name === "browser-automation"), false)
  assert.throws(() => engine.resolve("browser-automation"), /unknown delegation category/)
})

test("removed browser category has no preserved session or backend permission path", () => {
  assert.equal(categorySessionPermission("browser-automation"), undefined)
  assert.equal(categoryPermission({ category: "quick" }, { type: "skill", pattern: "ego-browser" }), "deny")
  assert.equal(categoryPermission({ category: "quick" }, {
    type: "external_directory",
    pattern: "/Users/code/.agents/skills/ego-browser/SKILL.md",
  }), "deny")
})
