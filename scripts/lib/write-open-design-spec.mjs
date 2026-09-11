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

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function parseLaunchSpec(raw) {
  const spec = raw?.launchSpec && typeof raw.launchSpec === "object" ? raw.launchSpec : raw
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("launch spec must be a JSON object")
  if (typeof spec.command !== "string" || !spec.command) throw new Error("launch spec command is missing")
  if (!Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== "string")) throw new Error("launch spec args must be strings")
  if (!spec.env || typeof spec.env !== "object" || Array.isArray(spec.env)) throw new Error("launch spec env must be an object")
  if (Object.values(spec.env).some((value) => typeof value !== "string")) throw new Error("launch spec env values must be strings")

  let command = spec.command
  let commandArgs = [...spec.args]
  if (command === "od") {
    if (!fallbackCli || !isAbsolute(fallbackCli)) throw new Error("the fallback OpenDesign CLI must be an absolute path")
    command = fallbackCli
    // Upstream's unreachable-daemon dry-run fallback contains an explicit
    // daemon URL. Prefer the official CLI's no-URL mode so its own headless
    // bootstrap/resolution path remains available at MCP startup.
    if (commandArgs.length === 3 && commandArgs[0] === "mcp" && commandArgs[1] === "--daemon-url" && !Object.keys(spec.env).length) {
      commandArgs = ["mcp"]
    }
  }
  if (!isAbsolute(command)) throw new Error(`launch spec command must be absolute after provisioning: ${spec.command}`)
  return { version: 1, command, args: commandArgs, env: { ...spec.env }, source: "od mcp install opencode --print --json" }
}

async function main() {
  if (!input || !fallbackCli || (!checkOnly && !output)) {
    fail("usage: write-open-design-spec.mjs --input FILE --fallback-cli ABSOLUTE_PATH [--output FILE | --check]")
  }
  let spec
  try {
    spec = parseLaunchSpec(JSON.parse(await readFile(input, "utf8")))
    await access(spec.command, constants.X_OK)
  } catch (error) {
    fail(`invalid OpenDesign launch spec: ${error.message}`)
  }
  if (checkOnly) {
    console.log(`OpenDesign launch spec: valid (${spec.command})`)
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
  console.log(`OpenDesign launch spec provisioned: ${output}`)
}

await main()
