import { spawn } from "node:child_process"

const args = process.argv.slice(2)
const cliIndex = args.indexOf("--cli")
const cli = cliIndex >= 0 ? args[cliIndex + 1] : ""
const launcherIndex = args.indexOf("--launcher")
const launcher = launcherIndex >= 0 ? args[launcherIndex + 1] : ""
const daemonIndex = args.indexOf("--daemon-url")
const daemonUrl = daemonIndex >= 0 ? args[daemonIndex + 1] : ""
const timeoutIndex = args.indexOf("--timeout-ms")
const timeoutMs = timeoutIndex >= 0 ? Number(args[timeoutIndex + 1]) : 10_000

if ((!cli && !launcher) || (cli && launcher) || !Number.isFinite(timeoutMs) || timeoutMs < 1) {
  console.error("usage: check-open-design-mcp.mjs (--cli | --launcher) ABSOLUTE_PATH [--daemon-url URL] [--timeout-ms N]")
  process.exit(2)
}

function frame(message) {
  return `${JSON.stringify(message)}\n`
}

function errorMessage(response, operation) {
  if (response?.error?.message) return `${operation}: ${response.error.message}`
  if (!response?.result) return `${operation}: MCP response did not contain a result`
  return null
}

function createClient() {
  const command = launcher || cli
  const commandArgs = launcher ? [] : ["mcp", ...(daemonUrl ? ["--daemon-url", daemonUrl] : [])]
  const childEnv = { ...process.env, OD_MCP_STDIO_IDLE_EXIT_MS: "0" }
  if (launcher && daemonUrl) childEnv.OPEN_DESIGN_MCP_DAEMON_URL = daemonUrl
  const child = spawn(command, commandArgs, {
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  })
  let buffer = ""
  let nextID = 1
  let stderr = ""
  const pending = new Map()

  const rejectPending = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  const parse = () => {
    while (true) {
      const newline = buffer.indexOf("\n")
      if (newline < 0) return
      const body = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!body) continue
      let message
      try {
        message = JSON.parse(body)
      } catch {
        rejectPending(new Error("MCP response was not valid newline-delimited JSON"))
        return
      }
      if (message?.id === undefined) continue
      const entry = pending.get(message.id)
      if (!entry) continue
      pending.delete(message.id)
      clearTimeout(entry.timer)
      entry.resolve(message)
    }
  }

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8")
    parse()
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8")
  })
  child.stdin.on("error", () => {})
  child.on("error", (error) => rejectPending(error))
  child.on("exit", (code, signal) => {
    rejectPending(new Error(`MCP process exited before responding (code=${code ?? "?"}, signal=${signal ?? "?"})`))
  })

  function request(method, params) {
    const id = nextID++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(frame({ jsonrpc: "2.0", id, method, params }), (error) => {
        if (!error) return
        clearTimeout(timer)
        pending.delete(id)
        reject(error)
      })
    })
  }

  function notify(method, params) {
    child.stdin.write(frame({ jsonrpc: "2.0", method, params }))
  }

  async function close() {
    child.stdin.destroy()
    if (!child.killed) child.kill("SIGTERM")
  }

  return { request, notify, close, stderr: () => stderr }
}

function resourceMatches(resources, expression) {
  return resources.filter((resource) => typeof resource?.uri === "string" && expression.test(resource.uri))
}

async function main() {
  const client = createClient()
  try {
    const initialize = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "aio-health-check", version: "1" },
    })
    const initializeError = errorMessage(initialize, "initialize")
    if (initializeError) throw new Error(initializeError)
    client.notify("notifications/initialized", {})
    console.log("MCP connection: connected headlessly")

    const listed = await client.request("resources/list", {})
    const listError = errorMessage(listed, "resources/list")
    if (listError) throw new Error(listError)
    const resources = Array.isArray(listed.result.resources) ? listed.result.resources : []
    const skills = resourceMatches(resources, /^od:\/\/skills\/[^/]+\/SKILL\.md$/)
    const designSystems = resourceMatches(resources, /^od:\/\/design-systems\/[^/]+\/DESIGN\.md$/)
    console.log(`Resources visible: ${resources.length}`)
    console.log(`Skill resources: ${skills.length}`)
    console.log(`Design-system resources: ${designSystems.length}`)

    let readable = true
    for (const [label, resource] of [["Skill", skills[0]], ["Design-system", designSystems[0]]]) {
      if (!resource) {
        console.log(`${label} resource read: NOT CHECKED (resource class not discoverable)`)
        readable = false
        continue
      }
      const response = await client.request("resources/read", { uri: resource.uri })
      const readError = errorMessage(response, `resources/read ${resource.uri}`)
      const contents = response?.result?.contents
      const hasText = Array.isArray(contents) && contents.some((entry) => typeof entry?.text === "string" && entry.text.trim())
      if (readError || !hasText) {
        console.log(`${label} resource read: FAILED (${readError ?? "no textual content"})`)
        readable = false
      } else {
        console.log(`${label} resource read: OK (${resource.uri})`)
      }
    }
    if (!skills.length || !designSystems.length || !readable) process.exitCode = 1
  } catch (error) {
    const detail = error?.message ?? String(error)
    const stderr = client.stderr().trim().split("\n").filter(Boolean).at(-1)
    console.log(`MCP connection: FAILED (${detail}${stderr ? `; stderr: ${stderr}` : ""})`)
    process.exitCode = 1
  } finally {
    await client.close()
  }
}

await main()
