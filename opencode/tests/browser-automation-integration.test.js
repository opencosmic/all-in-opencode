import test from "node:test"
import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { CategoryEngine } from "../plugins/delegation/category-engine.js"
import { categoryPermission } from "../plugins/delegation/category-permissions.js"
import { systemFor, toolsFor } from "../plugins/delegation/session-runner.js"

const here = dirname(fileURLToPath(import.meta.url))
const repository = resolve(here, "../..")

test("browser automation is a neutral category routed to Implementer", () => {
  const route = new CategoryEngine().resolve("browser-automation")
  assert.equal(route.agent, "Implementer")
  assert.equal(route.category, "browser-automation")
  assert.equal(route.profile.tools.edit, false)
  assert.equal(route.profile.tools.write, false)
  assert.equal(route.profile.tools.skill, true)
  assert.match(route.profile.description, /browser/i)
  assert.doesNotMatch(route.profile.description, /ego/i)

  const tools = toolsFor(route.agent, route.profile.tools)
  assert.equal(tools.delegate_task, false)
  assert.equal(tools.task, false)
  const system = systemFor(route.agent, route.category, route.profile)
  assert.match(system, /<Category_Context name="browser-automation">/)
  assert.match(system, /fresh browser state/)
  assert.doesNotMatch(system, /operating under the browser-automation category/)
})

test("browser category permission hook exposes only the current backend", () => {
  const profile = { category: "browser-automation" }
  assert.equal(categoryPermission(profile, { type: "skill", pattern: "ego-browser" }), "allow")
  assert.equal(categoryPermission(profile, { type: "skill", pattern: "unrelated" }), "deny")
  assert.equal(categoryPermission(profile, { type: "bash", pattern: "ego-browser <<'EOF'" }), "allow")
  assert.equal(categoryPermission(profile, { type: "bash", pattern: "node script.js" }), "deny")
  assert.equal(
    categoryPermission(profile, { type: "external_directory", pattern: "/Users/code/.agents/skills/ego-browser/SKILL.md" }),
    "allow",
  )
  assert.equal(categoryPermission(profile, { type: "external_directory", pattern: "/tmp/secret" }), "deny")
  assert.equal(categoryPermission({ category: "quick" }, { type: "skill", pattern: "ego-browser" }), "deny")
  assert.equal(categoryPermission({ category: "quick" }, {
    type: "external_directory",
    pattern: "/Users/code/.agents/skills/ego-browser/SKILL.md",
  }), "deny")
})

test("dedicated Browser route coexists with the neutral category", async () => {
  const browser = await readFile(`${repository}/opencode/agents/browser.md`, "utf8")
  const command = await readFile(`${repository}/opencode/commands/browser.md`, "utf8")
  assert.match(browser, /^name: Browser$/m)
  assert.match(browser, /^mode: primary$/m)
  assert.match(command, /^agent: Browser$/m)
  assert.match(command, /^subtask: false$/m)
  assert.match(browser, /official upstream `ego-browser` skill/)
  assert.match(command, /one ego-lite Task Space/)
  assert.match(browser, /task\.finish\(\{ keep: \["p1"\] \}\)/)
  assert.match(command, /task\.finish\(\{ keep: \[\] \}\)/)
  assert.doesNotMatch(`${browser}\n${command}`, /oh-my-openagent|call_omo_agent|Sisyphus-Junior/i)
  await assert.rejects(access(`${repository}/opencode/skills/ego-browser/SKILL.md`))
  await assert.rejects(access(`${repository}/skills/ego-browser/SKILL.md`))

  const assistant = await readFile(`${repository}/opencode/agents/assistant.md`, "utf8")
  assert.match(assistant, /category="browser-automation"/)
  assert.match(assistant, /category="video-analysis".*load_skills=\["watch"\]/s)
  assert.match(assistant, /Prefer this over browser automation when the website is only the container for the video/)
  assert.doesNotMatch(assistant, /dedicated Browser route is unavailable/i)

  const setup = await readFile(`${repository}/scripts/setup-ego-browser.sh`, "utf8")
  const health = await readFile(`${repository}/scripts/check-ego-browser.sh`, "utf8")
  assert.match(setup, /skills add citrolabs\/ego-lite/)
  assert.match(health, /ego-browser-health-/)
})
