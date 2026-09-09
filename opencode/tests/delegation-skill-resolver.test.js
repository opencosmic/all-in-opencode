import test from "node:test"
import assert from "node:assert/strict"

import { SkillResolver } from "../plugins/delegation/skill-resolver.js"

const entries = [
  { name: "foo", description: "Foo instructions", content: "FOO CONTENT" },
  { name: "bar", description: "Bar instructions", content: "BAR CONTENT" },
  { name: "unused", description: "Unused instructions", content: "UNSELECTED CONTENT" },
]

test("omitted skills resolve to an empty selection", () => {
  assert.deepEqual(new SkillResolver({ entries }).resolve(), [])
})

test("selected skills inject only the exact requested content", () => {
  const resolver = new SkillResolver({ entries })
  assert.deepEqual(resolver.resolve(["foo"]), [{
    name: "foo",
    description: "Foo instructions",
    content: "FOO CONTENT",
  }])
  assert.deepEqual(resolver.resolve(["foo", "bar", "foo"]).map((skill) => skill.content), [
    "FOO CONTENT",
    "BAR CONTENT",
  ])
  assert.equal(resolver.resolve(["foo"]).some((skill) => skill.content === "UNSELECTED CONTENT"), false)
})

test("unknown skills fail closed with available metadata", () => {
  assert.throws(
    () => new SkillResolver({ entries }).resolve(["misspelled"]),
    /unknown skill\(s\): misspelled.*foo, bar, unused/,
  )
})

test("skill presentation stays metadata-only", () => {
  const listed = new SkillResolver({ entries }).list()
  assert.deepEqual(listed, entries.map(({ name, description }) => ({ name, description })))
  assert.equal(Object.hasOwn(listed[0], "content"), false)
})
