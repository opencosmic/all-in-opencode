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
import { delegationPluginHooks } from "../plugins/delegation/plugin-hooks.js"
import { DelegationRuntime } from "../plugins/delegation/runtime.js"
import { systemFor, toolsFor } from "../plugins/delegation/session-runner.js"
import { SkillResolver, discoverSkills } from "../plugins/delegation/skill-resolver.js"

const execFileAsync = promisify(execFile)
const repository = join(process.cwd())
const launcher = join(repository, "opencode", "open-design-mcp.sh")
const launchRunner = join(repository, "scripts", "lib", "run-open-design-mcp.mjs")
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
  assert.equal(hasOpenDesignCapability({ agent: "Implementer", category: "visual-engineering", skill_names: ["open-design"] }), true)
  assert.equal(hasOpenDesignCapability({ category: "visual-engineering" }), false)
  assert.equal(hasOpenDesignCapability({ category: "standard", skill_names: ["open-design"] }), false)

  const visual = new CategoryEngine({}).resolve("visual-engineering")
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

test("the registered tool-execution hook gates real MCP resource operations", async () => {
  const profiles = new Map([
    ["eligible", { agent: "Implementer", category: "visual-engineering", skill_names: ["open-design"], tools: {} }],
    ["visual", { agent: "Implementer", category: "visual-engineering", skill_names: [], tools: {} }],
    ["standard", { agent: "Implementer", category: "standard", skill_names: ["open-design"], tools: {} }],
  ])
  const runtime = new DelegationRuntime({
    profiles,
    dispatcher: { categoryEngine: { list: () => [] } },
    skills: { list: () => [] },
  })
  const hooks = delegationPluginHooks(runtime)
  const before = (sessionID, tool, args) => hooks["tool.execute.before"](
    { sessionID, tool, callID: `${sessionID}-${tool}` },
    { args },
  )

  await before("eligible", "read_mcp_resource", { server: "open-design", uri: "od://skills/example/SKILL.md" })
  await before("eligible", "list_mcp_resources", { server: "open-design" })
  await before("eligible", "list_mcp_resources", {})
  await before("eligible", "list_mcp_resources", { server: "codegraph" })
  for (const [sessionID, args] of [
    ["visual", { server: "open-design", uri: "od://skills/example/SKILL.md" }],
    ["standard", { server: "open-design", uri: "od://skills/example/SKILL.md" }],
    ["missing", { server: "open-design", uri: "od://skills/example/SKILL.md" }],
    ["visual", {}],
    ["missing", {}],
  ]) await assert.rejects(
    before(sessionID, "read_mcp_resource", args),
    /OpenDesign MCP resources require an Implementer child/,
  )
  await assert.rejects(
    before("visual", "list_mcp_resources", {}),
    /OpenDesign MCP resources require an Implementer child/,
  )

  const permission = { status: "ask" }
  await hooks["permission.ask"]({
    sessionID: "eligible",
    permission: "open_design_start_run",
    patterns: ["*"],
    metadata: {},
  }, permission)
  assert.equal(permission.status, "deny")
})

test("the launch runner preserves canonical daemon URLs and replaces only explicit overrides", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "open-design-runner-test-"))
  const capture = join(root, "capture")
  const specPath = join(root, "launch.json")
  await writeFile(capture, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs")
writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({
  args: process.argv.slice(2),
  env: { CAPTURE_MARKER: process.env.CAPTURE_MARKER, OD_DATA_DIR: process.env.OD_DATA_DIR },
}))
`)
  await chmod(capture, 0o755)
  const specEnv = {
    CAPTURE_MARKER: "preserve-this-env",
    CAPTURE_PATH: join(root, "captured.json"),
    OD_DATA_DIR: join(root, "open-design-data"),
  }
  const canonicalArgs = [
    "/runtime/open-design-cli.js",
    "mcp",
    "--daemon-url",
    "http://127.0.0.1:4567",
    "--sidecar-flag",
    "value",
  ]
  const writeSpec = (specArgs) => writeFile(specPath, `${JSON.stringify({ command: capture, args: specArgs, env: specEnv })}\n`)
  const runRunner = (extra = []) => run(process.execPath, [launchRunner, "--spec", specPath, ...extra])
  const captured = async () => JSON.parse(await readFile(specEnv.CAPTURE_PATH, "utf8"))
  t.after(() => rm(root, { recursive: true, force: true }))

  await writeSpec(canonicalArgs)
  let result = await runRunner()
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual((await captured()).args, canonicalArgs)
  assert.deepEqual((await captured()).env, {
    CAPTURE_MARKER: "preserve-this-env",
    OD_DATA_DIR: join(root, "open-design-data"),
  })

  result = await runRunner(["--daemon-url", "http://127.0.0.1:9999"])
  assert.equal(result.code, 0, result.stderr)
  const overridden = await captured()
  assert.deepEqual(overridden.args, [
    "/runtime/open-design-cli.js",
    "mcp",
    "--sidecar-flag",
    "value",
    "--daemon-url",
    "http://127.0.0.1:9999",
  ])
  assert.equal(overridden.args.filter((arg) => arg === "--daemon-url").length, 1)
  assert.deepEqual(overridden.env, {
    CAPTURE_MARKER: "preserve-this-env",
    OD_DATA_DIR: join(root, "open-design-data"),
  })

  const equalsArgs = [
    "/runtime/open-design-cli.js",
    "mcp",
    "--daemon-url=http://127.0.0.1:4567",
    "--sidecar-flag",
    "value",
  ]
  await writeSpec(equalsArgs)
  result = await runRunner()
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual((await captured()).args, equalsArgs)
  result = await runRunner(["--daemon-url", "http://127.0.0.1:9999"])
  assert.equal(result.code, 0, result.stderr)
  const equalsOverridden = await captured()
  assert.deepEqual(equalsOverridden.args, [
    "/runtime/open-design-cli.js",
    "mcp",
    "--sidecar-flag",
    "value",
    "--daemon-url",
    "http://127.0.0.1:9999",
  ])
  assert.equal(equalsOverridden.args.filter((arg) => arg === "--daemon-url" || arg.startsWith("--daemon-url=")).length, 1)
})

test("OpenDesign setup and headless resource checks use an existing supported CLI", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "open-design-integration-test-"))
  const home = join(root, "home")
  const cli = join(root, "od")
  const dataDirectory = join(root, "open-design-data")
  const launchEnv = {
    OD_DATA_DIR: dataDirectory,
    OD_MCP_BOOTSTRAP_COMMAND: cli,
    OD_MCP_BOOTSTRAP_ARGS: JSON.stringify(["mcp", "--headless"]),
  }
  const fakeCli = `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.join(" ") === "mcp install --open-design-cli-probe") {
  console.log("open-design-cli:mcp-install:v1")
  process.exit(0)
}
if (args[0] === "mcp" && args[1] === "install" && args.includes("opencode") && args.includes("--print") && args.includes("--json")) {
  if (process.env.FAKE_INSTALL_MODE === "minimal") {
    console.log(JSON.stringify({ ok: true, agent: "opencode", kind: "json", launchSpec: {
      command: "od",
      args: ["mcp", "--daemon-url", "http://127.0.0.1:7456"],
      env: {},
    } }))
    process.exit(0)
  }
  if (process.env.FAKE_INSTALL_MODE === "direct") {
    console.log(JSON.stringify({ ok: true, agent: "opencode", kind: "json", launchSpec: {
      command: ${JSON.stringify(cli)},
      args: ["mcp", "--daemon-url", "http://127.0.0.1:4567", "--direct-flag", "value"],
      env: ${JSON.stringify(launchEnv)},
    } }))
    process.exit(0)
  }
  console.log(JSON.stringify({ ok: true, agent: "opencode", kind: "json", launchSpec: {
    command: ${JSON.stringify(cli)},
    args: ["mcp", "--fixture-mcp"],
    env: ${JSON.stringify(launchEnv)},
  } }))
  process.exit(0)
}
if (args[0] !== "mcp" || (!args.includes("--fixture-mcp") && !process.env.FAKE_MCP_MODE)) process.exit(1)
if (args.includes("--fixture-mcp") && (process.env.OD_DATA_DIR !== ${JSON.stringify(dataDirectory)} || process.env.OD_MCP_BOOTSTRAP_COMMAND !== ${JSON.stringify(cli)} || process.env.OD_MCP_BOOTSTRAP_ARGS !== ${JSON.stringify(launchEnv.OD_MCP_BOOTSTRAP_ARGS)})) process.exit(11)
if (process.env.EXPECTED_DAEMON_URL && (args[args.indexOf("--daemon-url") + 1] !== process.env.EXPECTED_DAEMON_URL)) process.exit(12)
if (process.env.FAKE_MCP_MODE === "malformed") {
  process.stdout.write("{not-json}\\n")
  setTimeout(() => process.exit(0), 20)
}
if (process.env.FAKE_MCP_MODE === "exit") process.exit(0)
if (process.env.FAKE_MCP_MODE === "timeout") process.stdin.resume()
let buffer = ""
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n")
}
function parse() {
  while (true) {
    const newline = buffer.indexOf("\\n")
    if (newline < 0) return
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    const message = JSON.parse(line)
    if (message.id === undefined) continue
    if (message.method === "initialize") {
      const response = JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { capabilities: { resources: {} }, serverInfo: { name: "fixture", version: "1" } } }) + "\\n"
      const split = Math.ceil(response.length / 2)
      process.stdout.write(response.slice(0, split))
      setTimeout(() => process.stdout.write(response.slice(split)), 5)
    } else if (message.method === "resources/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/fixture" }) + "\\n" + JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { resources: [{ uri: "od://skills/example/SKILL.md" }, { uri: "od://design-systems/example/DESIGN.md" }] } }) + "\\n")
    else if (message.method === "resources/read") send({ jsonrpc: "2.0", id: message.id, result: { contents: [{ uri: message.params.uri, text: "fixture reference" }] } })
    else send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown method" } })
  }
}
if (process.env.FAKE_MCP_MODE !== "malformed" && process.env.FAKE_MCP_MODE !== "timeout") process.stdin.on("data", (chunk) => { buffer += chunk.toString(); parse() })
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
  const specPath = join(home, ".config", "opencode", "open-design-mcp.json")
  const spec = JSON.parse(await readFile(specPath, "utf8"))
  assert.equal(spec.command, cli)
  assert.deepEqual(spec.args, ["mcp", "--fixture-mcp"])
  assert.deepEqual(spec.env, launchEnv)
  assert.match(setupResult.stdout, /headless-bootstrap/)

  const directHome = join(root, "direct-home")
  const directSetup = await run(setup, [], {
    env: { ...env, HOME: directHome, FAKE_INSTALL_MODE: "direct" },
  })
  assert.equal(directSetup.code, 0, directSetup.stderr)
  assert.match(directSetup.stdout, /direct-daemon/)
  const directSpec = JSON.parse(await readFile(join(directHome, ".config", "opencode", "open-design-mcp.json"), "utf8"))
  assert.equal(directSpec.command, cli)
  assert.deepEqual(directSpec.args, ["mcp", "--daemon-url", "http://127.0.0.1:4567", "--direct-flag", "value"])
  assert.deepEqual(directSpec.env, launchEnv)

  const installResult = await run(install, [], { env })
  assert.equal(installResult.code, 0, installResult.stderr)

  const runtimeEnv = { ...env }
  delete runtimeEnv.OPEN_DESIGN_CLI
  const checkResult = await run(check, [], { env })
  assert.equal(checkResult.code, 0, `${checkResult.stdout}\n${checkResult.stderr}`)
  assert.match(checkResult.stdout, /OpenDesign MCP probe: ready/)
  assert.match(checkResult.stdout, /Skill resources: 1/)
  assert.match(checkResult.stdout, /Design-system resources: 1/)
  assert.match(checkResult.stdout, /OpenDesign status: READY/)

  const runtimeCheck = await run(check, [], { env: runtimeEnv })
  assert.equal(runtimeCheck.code, 0, `${runtimeCheck.stdout}\n${runtimeCheck.stderr}`)
  assert.match(runtimeCheck.stdout, /OpenDesign setup CLI: not currently discoverable/)
  assert.match(runtimeCheck.stdout, /OpenDesign MCP probe: ready/)
  assert.match(runtimeCheck.stdout, /OpenDesign status: READY/)

  const overrideUrl = "http://127.0.0.1:43123"
  const overrideCheck = await run(check, [], {
    env: { ...runtimeEnv, OPEN_DESIGN_MCP_DAEMON_URL: overrideUrl, EXPECTED_DAEMON_URL: overrideUrl },
  })
  assert.equal(overrideCheck.code, 0, `${overrideCheck.stdout}\n${overrideCheck.stderr}`)

  const malformed = await run(process.execPath, [join(repository, "scripts/lib/check-open-design-mcp.mjs"), "--cli", cli, "--timeout-ms", "200"], {
    env: { ...env, FAKE_MCP_MODE: "malformed" },
  })
  assert.notEqual(malformed.code, 0)
  assert.match(`${malformed.stdout}\n${malformed.stderr}`, /newline-delimited JSON/)
  const timeout = await run(process.execPath, [join(repository, "scripts/lib/check-open-design-mcp.mjs"), "--cli", cli, "--timeout-ms", "50"], {
    env: { ...env, FAKE_MCP_MODE: "timeout" },
  })
  assert.notEqual(timeout.code, 0)
  assert.match(`${timeout.stdout}\n${timeout.stderr}`, /timed out/)
  const prematureExit = await run(process.execPath, [join(repository, "scripts/lib/check-open-design-mcp.mjs"), "--cli", cli, "--timeout-ms", "200"], {
    env: { ...env, FAKE_MCP_MODE: "exit" },
  })
  assert.notEqual(prematureExit.code, 0)
  assert.match(`${prematureExit.stdout}\n${prematureExit.stderr}`, /process exited before responding/)

  await rm(specPath)
  const stale = await run(check, [], { env: runtimeEnv })
  assert.notEqual(stale.code, 0)
  assert.match(stale.stdout, /launch spec: missing or invalid/)
  const refreshed = await run(setup, [], { env })
  assert.equal(refreshed.code, 0, refreshed.stderr)

  const brokenSpec = JSON.parse(await readFile(specPath, "utf8"))
  brokenSpec.command = join(root, "removed-open-design-runtime")
  await writeFile(specPath, `${JSON.stringify(brokenSpec)}\n`)
  const brokenCheck = await run(check, [], { env: runtimeEnv })
  assert.notEqual(brokenCheck.code, 0)
  assert.match(brokenCheck.stdout, /launch spec: missing or invalid/)
  const brokenLaunch = await run(launcher, [], { env: runtimeEnv })
  assert.notEqual(brokenLaunch.code, 0)
  assert.match(`${brokenLaunch.stdout}\n${brokenLaunch.stderr}`, /launch command is unavailable|Rerun scripts\/setup-open-design\.sh/)
  const restored = await run(setup, [], { env })
  assert.equal(restored.code, 0, restored.stderr)

  const fallbackHome = join(root, "fallback-home")
  const fallbackEnv = { ...env, HOME: fallbackHome, FAKE_INSTALL_MODE: "minimal" }
  const fallback = await run(setup, [], { env: fallbackEnv })
  assert.notEqual(fallback.code, 0)
  assert.match(`${fallback.stdout}\n${fallback.stderr}`, /minimal direct-daemon fallback/)
  assert.match(`${fallback.stdout}\n${fallback.stderr}`, /OPEN_DESIGN_MCP_DAEMON_URL/)
  await assert.rejects(readFile(join(fallbackHome, ".config", "opencode", "open-design-mcp.json")))

  const explicitDaemonUrl = "http://127.0.0.1:7456"
  const acceptedFallback = await run(setup, [], {
    env: { ...fallbackEnv, OPEN_DESIGN_MCP_DAEMON_URL: explicitDaemonUrl },
  })
  assert.equal(acceptedFallback.code, 0, acceptedFallback.stderr)
  const fallbackSpec = JSON.parse(await readFile(join(fallbackHome, ".config", "opencode", "open-design-mcp.json"), "utf8"))
  assert.equal(fallbackSpec.command, cli)
  assert.deepEqual(fallbackSpec.args, ["mcp", "--daemon-url", explicitDaemonUrl])
  assert.deepEqual(fallbackSpec.env, {})
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
