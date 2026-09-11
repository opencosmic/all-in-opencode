import { access, constants, readFile } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { spawn } from "node:child_process"

function option(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : ""
}

const args = process.argv.slice(2)
const passthroughIndex = args.indexOf("--")
const options = passthroughIndex >= 0 ? args.slice(0, passthroughIndex) : args
const passthrough = passthroughIndex >= 0 ? args.slice(passthroughIndex + 1) : []
const specPath = option(options, "--spec")
const daemonUrl = option(options, "--daemon-url")

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exitCode = 1
}

function parseSpec(raw) {
  const spec = raw?.launchSpec && typeof raw.launchSpec === "object" ? raw.launchSpec : raw
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("launch spec must be a JSON object")
  if (typeof spec.command !== "string" || !spec.command) throw new Error("launch spec command is missing")
  if (!Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== "string")) throw new Error("launch spec args must be strings")
  if (!spec.env || typeof spec.env !== "object" || Array.isArray(spec.env)) throw new Error("launch spec env must be an object")
  if (Object.values(spec.env).some((value) => typeof value !== "string")) throw new Error("launch spec env values must be strings")
  return { command: spec.command, args: [...spec.args], env: { ...spec.env } }
}

async function main() {
  if (!specPath) {
    fail("usage: run-open-design-mcp.mjs --spec ABSOLUTE_PATH [--daemon-url URL] -- [ARGS]")
    return
  }
  let spec
  try {
    spec = parseSpec(JSON.parse(await readFile(specPath, "utf8")))
  } catch (error) {
    fail(`invalid OpenDesign launch spec ${specPath}: ${error.message}`)
    return
  }

  if (!isAbsolute(spec.command)) {
    fail(`OpenDesign launch spec must use an absolute command path: ${spec.command}. Rerun scripts/setup-open-design.sh.`)
    return
  }
  try {
    await access(spec.command, constants.X_OK)
  } catch {
    fail(`OpenDesign launch command is unavailable: ${spec.command}. Rerun scripts/setup-open-design.sh to refresh it.`)
    return
  }

  const commandArgs = daemonUrl
    ? replaceDaemonUrl(spec.args, daemonUrl)
    : [...spec.args]
  commandArgs.push(...passthrough)
  const child = spawn(spec.command, commandArgs, {
    env: { ...process.env, ...spec.env },
    stdio: "inherit",
  })
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal))
  }
  child.on("error", (error) => {
    console.error(`ERROR: failed to start OpenDesign MCP: ${error.message}`)
    process.exitCode = 1
  })
  child.on("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1)
  })
}

function replaceDaemonUrl(args, daemonUrl) {
  const replaced = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--daemon-url") {
      index += 1
      continue
    }
    if (args[index].startsWith("--daemon-url=")) continue
    replaced.push(args[index])
  }
  replaced.push("--daemon-url", daemonUrl)
  return replaced
}

await main()
