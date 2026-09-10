import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SkillResolver, discoverSkills } from "../plugins/delegation/skill-resolver.js"

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

test("selected skill locations survive resolution for bundled runtimes", () => {
  const resolver = new SkillResolver({ entries: [{
    name: "watch",
    description: "Watch videos",
    path: "/Users/example/.agents/skills/watch/SKILL.md",
    content: "WATCH CONTENT",
  }] })
  assert.deepEqual(resolver.resolve(["watch"]), [{
    name: "watch",
    description: "Watch videos",
    path: "/Users/example/.agents/skills/watch/SKILL.md",
    content: "WATCH CONTENT",
  }])
  assert.deepEqual(resolver.list(), [{
    name: "watch",
    description: "Watch videos",
    path: "/Users/example/.agents/skills/watch/SKILL.md",
  }])
  assert.deepEqual(new SkillResolver({ entries: [{
    name: "location-skill",
    description: "Location fixture",
    location: "/Users/example/.agents/skills/location-skill/SKILL.md",
    content: "LOCATION CONTENT",
  }] }).resolve(["location-skill"]), [{
    name: "location-skill",
    description: "Location fixture",
    location: "/Users/example/.agents/skills/location-skill/SKILL.md",
    content: "LOCATION CONTENT",
  }])
})

test("supported skill discovery keeps the watch directory alongside its skill", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "skill-discovery-test-"))
  const skill = join(root, "watch")
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(skill, "scripts"), { recursive: true })
  await writeFile(join(skill, "SKILL.md"), "---\nname: watch\ndescription: Watch videos\n---\nWATCH CONTENT\n")
  await writeFile(join(skill, "scripts", "watch.py"), "")

  const discovered = await discoverSkills({ roots: [root] })
  assert.deepEqual(discovered, [{
    name: "watch",
    description: "Watch videos",
    path: join(skill, "SKILL.md"),
    content: "WATCH CONTENT",
  }])
})
