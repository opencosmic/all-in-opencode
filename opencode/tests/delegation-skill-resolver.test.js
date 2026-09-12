import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

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

test("discovers a project-owned skill through the installed symlink topology", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "skill-discovery-symlink-test-"))
  const canonicalSkill = join(root, "canonical", "open-design")
  const installedRoot = join(root, "home", ".config", "opencode", "skills")
  const installedSkill = join(installedRoot, "open-design")
  t.after(() => rm(root, { recursive: true, force: true }))

  await mkdir(canonicalSkill, { recursive: true })
  await mkdir(installedRoot, { recursive: true })
  await writeFile(join(canonicalSkill, "SKILL.md"), "---\nname: open-design\ndescription: Design references\n---\nOPEN DESIGN CONTENT\n")
  await symlink(relative(installedRoot, canonicalSkill), installedSkill, "dir")

  const discovered = await discoverSkills({ roots: [installedRoot] })
  assert.deepEqual(discovered, [{
    name: "open-design",
    description: "Design references",
    path: join(installedSkill, "SKILL.md"),
    content: "OPEN DESIGN CONTENT",
  }])
})

test("preserves direct SKILL.md discovery through a file symlink", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "skill-discovery-file-link-test-"))
  const canonical = join(root, "canonical", "SKILL.md")
  const linked = join(root, "SKILL.md")
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "canonical"), { recursive: true })
  await writeFile(canonical, "---\nname: linked-skill\ndescription: Linked instructions\n---\nLINKED CONTENT\n")
  await symlink(canonical, linked, "file")

  assert.deepEqual(await discoverSkills({ roots: [root] }), [{
    name: "linked-skill",
    description: "Linked instructions",
    path: linked,
    content: "LINKED CONTENT",
  }])
})

test("ignores broken skill symlinks without failing discovery", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "skill-discovery-broken-link-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await symlink(join(root, "missing-skill"), join(root, "broken-skill"), "dir")

  await assert.doesNotReject(discoverSkills({ roots: [root] }))
  assert.deepEqual(await discoverSkills({ roots: [root] }), [])
})

test("terminates safely on symlink cycles", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "skill-discovery-cycle-test-"))
  const directory = join(root, "a")
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(directory)
  await symlink("../a", join(directory, "cycle"), "dir")

  await assert.doesNotReject(discoverSkills({ roots: [root] }))
  assert.deepEqual(await discoverSkills({ roots: [root] }), [])
})

test("deduplicates a canonical skill reached through direct and symlinked paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "skill-discovery-duplicate-test-"))
  const canonicalSkill = join(root, "canonical", "open-design")
  const linkedRoot = join(root, "linked")
  t.after(() => rm(root, { recursive: true, force: true }))

  await mkdir(canonicalSkill, { recursive: true })
  await mkdir(linkedRoot)
  await writeFile(join(canonicalSkill, "SKILL.md"), "---\nname: open-design\ndescription: Design references\n---\nOPEN DESIGN CONTENT\n")
  await symlink(canonicalSkill, join(linkedRoot, "open-design"), "dir")

  const discovered = await discoverSkills({ roots: [join(root, "canonical"), linkedRoot] })
  assert.equal(discovered.length, 1)
  assert.equal(discovered[0].name, "open-design")
  assert.equal(discovered[0].path, join(canonicalSkill, "SKILL.md"))
})
