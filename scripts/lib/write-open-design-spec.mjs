import { access, constants, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"

function option(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : ""
}

const args = process.argv.slice(2)
const input = option(args, "--input")
const output = option(args, "--output")
const fallbackCli = option(args, "--fallback-cli")
const checkOnly = args.includes("--check")
const allowMinimalDirect = args.includes("--allow-minimal-direct")

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function isMinimalDirectFallback(spec) {
  if (spec.command !== "od" || Object.keys(spec.env).length !== 0 || spec.args[0] !== "mcp") return false
  const daemonUrl = spec.args.length === 3 && spec.args[1] === "--daemon-url"
    ? spec.args[2]
    : spec.args.length === 2 && spec.args[1].startsWith("--daemon-url=")
      ? spec.args[1].slice("--daemon-url=".length)
      : ""
  return /^https?:\/\//.test(daemonUrl)
}

function launchMode(spec) {
  if (spec.args.some((arg) => arg === "--daemon-url" || arg.startsWith("--daemon-url="))) return "direct-daemon"
  if (spec.env.OD_MCP_BOOTSTRAP_COMMAND && spec.env.OD_MCP_BOOTSTRAP_ARGS) return "headless-bootstrap"
  return "canonical"
}

function parseLaunchSpec(raw) {
  const spec = raw?.launchSpec && typeof raw.launchSpec === "object" ? raw.launchSpec : raw
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("launch spec must be a JSON object")
  if (typeof spec.command !== "string" || !spec.command) throw new Error("launch spec command is missing")
  if (!Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== "string")) throw new Error("launch spec args must be strings")
  if (!spec.env || typeof spec.env !== "object" || Array.isArray(spec.env)) throw new Error("launch spec env must be an object")
  if (Object.values(spec.env).some((value) => typeof value !== "string")) throw new Error("launch spec env values must be strings")
  if (isMinimalDirectFallback(spec) && !allowMinimalDirect) {
    throw new Error(
      "OpenDesign returned only its minimal direct-daemon fallback and no headless bootstrap metadata. Start a supported OpenDesign daemon/runtime once or provide OPEN_DESIGN_MCP_DAEMON_URL, then rerun setup.",
    )
  }

  let command = spec.command
  let commandArgs = [...spec.args]
  if (command === "od") {
    if (!fallbackCli) throw new Error("persisted launch spec uses bare od; rerun scripts/setup-open-design.sh")
    if (!isAbsolute(fallbackCli)) throw new Error("the fallback OpenDesign CLI must be an absolute path")
    command = fallbackCli
  }
  if (!isAbsolute(command)) throw new Error(`launch spec command must be absolute after provisioning: ${spec.command}`)
  return { version: 1, command, args: commandArgs, env: { ...spec.env }, source: "od mcp install opencode --print --json" }
}

async function main() {
  if (!input || (!checkOnly && (!output || !fallbackCli))) {
    fail("usage: write-open-design-spec.mjs --input FILE [--fallback-cli ABSOLUTE_PATH --output FILE | --check] [--allow-minimal-direct]")
  }
  let spec
  try {
    spec = parseLaunchSpec(JSON.parse(await readFile(input, "utf8")))
    await access(spec.command, constants.X_OK)
  } catch (error) {
    fail(`invalid OpenDesign launch spec: ${error.message}`)
  }
  if (checkOnly) {
    console.log(`OpenDesign launch spec: valid (${launchMode(spec)}; ${spec.command})`)
    return
  }

  const directory = dirname(output)
  await mkdir(directory, { recursive: true })
  const temporaryDirectory = await mkdtemp(join(directory, ".open-design-spec-"))
  const temporaryFile = join(temporaryDirectory, "launch.json")
  try {
    await writeFile(temporaryFile, `${JSON.stringify(spec, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryFile, output)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
  console.log(`OpenDesign launch spec provisioned: ${output} (${launchMode(spec)})`)
}

await main()
