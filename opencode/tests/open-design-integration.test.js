import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { CategoryEngine } from "../plugins/delegation/category-engine.js"
import {
  categoryPermission,
  categorySessionPermission,
  hasOpenDesignCapability,
} from "../plugins/delegation/category-permissions.js"
import { DelegationRuntime } from "../plugins/delegation/runtime.js"
import { systemFor, toolsFor } from "../plugins/delegation/session-runner.js"
import { SkillResolver, discoverSkills } from "../plugins/delegation/skill-resolver.js"

const execFileAsync = promisify(execFile)
const repository = join(process.cwd())
const launcher = join(repository, "opencode", "open-design-mcp.sh")
const setup = join(repository, "scripts", "setup-open-design.sh")
const check = join(repository, "scripts", "check-open-design.sh")
const install = join(repository, "scripts", "install.sh")

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, { encoding: "utf8", ...options })
    return { code: 0, ...result }
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
    }
  }
}

test("OpenDesign is an explicit visual-engineering skill and resource boundary", async () => {
  const entries = await discoverSkills({ roots: [join(repository, "opencode", "skills")] })
  const resolver = new SkillResolver({ entries })
  const selected = resolver.resolve(["open-design"])
  assert.equal(selected.length, 1)
  assert.equal(selected[0].name, "open-design")
  assert.match(selected[0].content, /generic\s+[`']?list_mcp_resources/i)
  assert.deepEqual(resolver.resolve([]), [])
  assert.equal(hasOpenDesignCapability({ category: "visual-engineering", skill_names: ["open-design"] }), true)
  assert.equal(hasOpenDesignCapability({ category: "visual-engineering" }), false)
  assert.equal(hasOpenDesignCapability({ category: "standard", skill_names: ["open-design"] }), false)

  const visual = new CategoryEngine().resolve("visual-engineering")
  assert.equal(visual.profile.model, "opencode-go/kimi-k3")
  assert.match(systemFor("Implementer", "visual-engineering", visual.profile, selected), /Selected skill: open-design/)
  assert.doesNotMatch(systemFor("Implementer", "visual-engineering", visual.profile, []), /Selected skill: open-design/)
  assert.equal(toolsFor("Implementer", visual.profile.tools, "visual-engineering", selected), undefined)
  assert.ok(toolsFor("Implementer", visual.profile.tools, "visual-engineering", []).workspace_prepare === false)

  const description = DelegationRuntime.prototype.delegateTaskDescription.call({
    dispatcher: { categoryEngine: { list: () => [{ name: "visual-engineering", description: "UI" }] } },
    skills: { list: () => [{ name: "open-design", description: "references" }] },
  })
  assert.match(description, /category="visual-engineering" with load_skills=\["open-design"\]/)
})

test("OpenDesign resource reads require the exact category and selected skill", () => {
  const eligible = {
    category: "visual-engineering",
    agent: "Implementer",
    skill_names: ["open-design"],
    tools: { read: true },
  }
  const resource = "mcp:open-design:od://design-systems/example/DESIGN.md"
  assert.equal(categoryPermission(eligible, { type: "read", pattern: resource }), "allow")
  assert.equal(categoryPermission(eligible, { type: "read", pattern: "mcp:open-design:od://skills/example/SKILL.md" }), "allow")
  for (const profile of [
    undefined,
    { category: "visual-engineering", tools: { read: true } },
    { category: "standard", skill_names: ["open-design"], tools: { read: true } },
    { category: "visual-engineering", skill_names: ["open-design"], tools: { read: false } },
  ]) assert.equal(categoryPermission(profile, { type: "read", pattern: resource }), "deny")
  assert.equal(categoryPermission(eligible, { type: "read", pattern: "mcp:codegraph:od://design-systems/example/DESIGN.md" }), null)
  assert.equal(categoryPermission(eligible, { type: "read", pattern: "mcp:open-design:" }), null)

  for (const tool of ["start_run", "get_run", "cancel_run", "list_agents"]) {
    assert.equal(categoryPermission(eligible, { type: `open_design_${tool}`, pattern: "*" }), "deny", tool)
    assert.equal(categoryPermission(undefined, { type: `open_design_${tool}`, pattern: "*" }), "deny", tool)
  }
  assert.equal(categoryPermission(eligible, { type: "open_design_start_run_extra", pattern: "*" }), "deny")
  assert.equal(categoryPermission(eligible, { type: "other_design_start_run", pattern: "*" }), null)

  const rules = categorySessionPermission("visual-engineering", { read: true, open_design_start_run: true }, [{ name: "open-design" }])
  assert.ok(rules.some((rule) => rule.permission === "read" && rule.pattern === "mcp:open-design:*" && rule.action === "allow"))
  assert.ok(rules.some((rule) => rule.permission === "open_design_*" && rule.pattern === "*" && rule.action === "deny"))
  assert.equal(categorySessionPermission("visual-engineering", {}, []), undefined)
})

test("OpenDesign setup and headless resource checks use an existing supported CLI", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "open-design-integration-test-"))
  const home = join(root, "home")
  const cli = join(root, "od")
  const fakeCli = `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.join(" ") === "mcp install --open-design-cli-probe") {
  console.log("open-design-cli:mcp-install:v1")
  process.exit(0)
}
if (args[0] !== "mcp") process.exit(1)
let buffer = Buffer.alloc(0)
function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body)
}
function parse() {
  while (true) {
    const end = buffer.indexOf(Buffer.from("\\r\\n\\r\\n"))
    if (end < 0) return
    const length = Number(/^Content-Length:\\s*(\\d+)$/im.exec(buffer.subarray(0, end).toString())?.[1])
    if (!Number.isSafeInteger(length) || buffer.length < end + 4 + length) return
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
    buffer = buffer.subarray(end + 4 + length)
    if (message.id === undefined) continue
    if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { capabilities: { resources: {} }, serverInfo: { name: "fixture", version: "1" } } })
    else if (message.method === "resources/list") send({ jsonrpc: "2.0", id: message.id, result: { resources: [{ uri: "od://skills/example/SKILL.md" }, { uri: "od://design-systems/example/DESIGN.md" }] } })
    else if (message.method === "resources/read") send({ jsonrpc: "2.0", id: message.id, result: { contents: [{ uri: message.params.uri, text: "fixture reference" }] } })
    else send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown method" } })
  }
}
process.stdin.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); parse() })
`
  await writeFile(cli, fakeCli)
  await chmod(cli, 0o755)
  t.after(() => rm(root, { recursive: true, force: true }))

  const env = { ...process.env, HOME: home, OPEN_DESIGN_CLI: cli }
  const setupResult = await run(setup, [], { env })
  assert.equal(setupResult.code, 0, setupResult.stderr)
  assert.match(setupResult.stdout, /does not install software/i)
  const secondSetup = await run(setup, [], { env })
  assert.equal(secondSetup.code, 0, secondSetup.stderr)
  const installResult = await run(install, [], { env })
  assert.equal(installResult.code, 0, installResult.stderr)

  const checkResult = await run(check, [], { env })
  assert.equal(checkResult.code, 0, `${checkResult.stdout}\n${checkResult.stderr}`)
  assert.match(checkResult.stdout, /OpenDesign MCP probe: ready/)
  assert.match(checkResult.stdout, /Skill resources: 1/)
  assert.match(checkResult.stdout, /Design-system resources: 1/)
  assert.match(checkResult.stdout, /OpenDesign status: READY/)
})

test("OpenDesign provisioning rejects relative, missing, and unrelated od binaries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "open-design-launcher-test-"))
  const fakeBin = join(root, "bin")
  await mkdir(fakeBin, { recursive: true })
  const unrelated = join(fakeBin, "od")
  await writeFile(unrelated, "#!/bin/sh\nexit 0\n")
  await chmod(unrelated, 0o755)
  t.after(() => rm(root, { recursive: true, force: true }))

  const missing = await run(launcher, ["--resolve-cli"], { env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin`, OPEN_DESIGN_CLI: "relative/od" } })
  assert.notEqual(missing.code, 0)
  assert.match(`${missing.stdout}\n${missing.stderr}`, /absolute path/i)
  const notOpenDesign = await run(launcher, ["--resolve-cli"], { env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin`, OPEN_DESIGN_CLI: "" } })
  assert.notEqual(notOpenDesign.code, 0)
  assert.match(`${notOpenDesign.stdout}\n${notOpenDesign.stderr}`, /OpenDesign CLI not found/i)
  assert.match(`${notOpenDesign.stdout}\n${notOpenDesign.stderr}`, /\/usr\/bin\/od is not OpenDesign/i)
})

test("canonical OpenDesign configuration preserves CodeGraph and avoids machine paths", async () => {
  const config = await readFile(join(repository, "opencode", "opencode.jsonc"), "utf8")
  const manifest = await readFile(join(repository, "scripts", "links.tsv"), "utf8")
  assert.match(config, /"codegraph"/)
  assert.match(config, /"open-design"/)
  assert.match(config, /"open_design_\*": "deny"/)
  assert.doesNotMatch(config, /\/(?:Users|Applications)\//)
  assert.match(manifest, /opencode\/skills\/open-design\|\.config\/opencode\/skills\/open-design\|directory/)
  assert.match(manifest, /opencode\/open-design-mcp\.sh\|\.config\/opencode\/open-design-mcp\.sh\|file/)
})
