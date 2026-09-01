import { spawn, spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"

function processSnapshot(pid) {
  const detail = spawnSync("ps", ["-o", "pid=,ppid=,state=,etime=,command=", "-p", String(pid)], { encoding: "utf8" })
  const children = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" })
  return {
    pid,
    process: detail.status === 0 ? detail.stdout.trim() : "",
    directChildren: children.status === 0 ? children.stdout.trim().split("\n").filter(Boolean) : [],
  }
}

async function logTail(path, bytes = 8_192) {
  if (!path) return ""
  try {
    const content = await readFile(path, "utf8")
    return content.slice(-bytes)
  } catch {
    return ""
  }
}

export async function runObservedCommand(command, args, {
  cwd,
  env,
  timeout = 30_000,
  grace = 1_000,
  expectedJson = (value) => Boolean(value && typeof value === "object"),
  logPath,
} = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let closed = false
    let timedOut = false
    let timeoutSnapshot
    let cleanupSnapshot
    let processGroupTerminationAttempted = false
    let closeResult
    const finish = async () => {
      const parsed = (() => { try { return JSON.parse(stdout) } catch { return null } })()
      resolve({
        command,
        args,
        cwd,
        pid: child.pid,
        startedAt,
        finishedAt: Date.now(),
        outputStarted: stdout.length > 0 || stderr.length > 0,
        stdout,
        stderr,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        jsonComplete: expectedJson(parsed) === true,
        jsonParseResult: parsed ? "valid" : "invalid-or-empty",
        processExited: closed,
        exitCode: closeResult?.code ?? null,
        exitSignal: closeResult?.signal ?? null,
        timedOut,
        timeoutSnapshot,
        cleanupSnapshot,
        processGroupTerminationAttempted,
        logTail: await logTail(logPath),
      })
    }
    const timer = setTimeout(async () => {
      timedOut = true
      timeoutSnapshot = processSnapshot(child.pid)
      child.kill("SIGTERM")
      setTimeout(() => {
        if (!closed || timeoutSnapshot.directChildren.length > 0) {
          processGroupTerminationAttempted = true
          try { process.kill(-child.pid, "SIGTERM") } catch {}
        }
      }, grace).unref()
      setTimeout(async () => {
        cleanupSnapshot = processSnapshot(child.pid)
        await finish()
      }, grace * 2).unref()
    }, timeout)
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", async (error) => {
      clearTimeout(timer)
      stderr += error.stack ?? error.message
      closed = true
      closeResult = { code: null, signal: null }
      await finish()
    })
    child.on("close", async (code, signal) => {
      if (closed) return
      clearTimeout(timer)
      closed = true
      closeResult = { code, signal }
      if (timedOut && !cleanupSnapshot) cleanupSnapshot = processSnapshot(child.pid)
      await finish()
    })
  })
}
