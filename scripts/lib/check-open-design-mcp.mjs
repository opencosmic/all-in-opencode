import { spawn } from "node:child_process"

const args = process.argv.slice(2)
const cliIndex = args.indexOf("--cli")
const cli = cliIndex >= 0 ? args[cliIndex + 1] : ""
const daemonIndex = args.indexOf("--daemon-url")
const daemonUrl = daemonIndex >= 0 ? args[daemonIndex + 1] : ""
const timeoutIndex = args.indexOf("--timeout-ms")
const timeoutMs = timeoutIndex >= 0 ? Number(args[timeoutIndex + 1]) : 10_000

if (!cli || !Number.isFinite(timeoutMs) || timeoutMs < 1) {
  console.error("usage: check-open-design-mcp.mjs --cli ABSOLUTE_PATH [--daemon-url URL] [--timeout-ms N]")
  process.exit(2)
}

function frame(message) {
  const body = JSON.stringify(message)
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

function errorMessage(response, operation) {
  if (response?.error?.message) return `${operation}: ${response.error.message}`
  if (!response?.result) return `${operation}: MCP response did not contain a result`
  return null
}

function createClient() {
  const child = spawn(cli, ["mcp", ...(daemonUrl ? ["--daemon-url", daemonUrl] : [])], {
    env: { ...process.env, OD_MCP_STDIO_IDLE_EXIT_MS: "0" },
    stdio: ["pipe", "pipe", "pipe"],
  })
  let buffer = Buffer.alloc(0)
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
      const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"))
      if (headerEnd < 0) return
      const header = buffer.subarray(0, headerEnd).toString("utf8")
      const length = /^Content-Length:\s*(\d+)\s*$/im.exec(header)?.[1]
      if (!length) {
        buffer = buffer.subarray(headerEnd + 4)
        continue
      }
      const bodyLength = Number(length)
      const bodyStart = headerEnd + 4
      if (!Number.isSafeInteger(bodyLength) || bodyLength < 0 || bodyLength > 10 * 1024 * 1024) {
        rejectPending(new Error("MCP response has an invalid Content-Length"))
        return
      }
      if (buffer.length < bodyStart + bodyLength) return
      const body = buffer.subarray(bodyStart, bodyStart + bodyLength).toString("utf8")
      buffer = buffer.subarray(bodyStart + bodyLength)
      let message
      try {
        message = JSON.parse(body)
      } catch {
        rejectPending(new Error("MCP response was not valid JSON"))
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
    buffer = Buffer.concat([buffer, chunk])
    parse()
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8")
  })
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
      clientInfo: { name: "opencode-workflow-health-check", version: "1" },
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
