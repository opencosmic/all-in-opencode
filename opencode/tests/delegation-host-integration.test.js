import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { execFile } from "node:child_process"
import { createServer } from "node:net"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const testDirectory = dirname(fileURLToPath(import.meta.url))
const delegationEntry = pathToFileURL(join(testDirectory, "../plugins/delegation-runtime.js")).href
const controlPlaneEntry = pathToFileURL(join(testDirectory, "../plugins/delegation/control-plane.js")).href

async function git(directory, args) {
  return (await execFileAsync("git", args, { cwd: directory, encoding: "utf8" })).stdout.trim()
}

async function waitFor(check, timeoutMs = 20_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`)
}

async function readJsonLines(path) {
  try {
    return (await readFile(path, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line))
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw error
  }
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : null
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function probeSource() {
  return `
import { appendFile } from "node:fs/promises"
import { delegationPluginHooks } from ${JSON.stringify(delegationEntry)}
import { acquireDelegationControlPlane } from ${JSON.stringify(controlPlaneEntry)}

const canonical = process.env.DELEGATION_PROBE_CANONICAL
const worktrees = [process.env.DELEGATION_PROBE_T1, process.env.DELEGATION_PROBE_T2]
const diagnostics = process.env.DELEGATION_PROBE_DIAGNOSTICS
const stateDirectory = process.env.DELEGATION_PROBE_STATE

async function record(value) {
  await appendFile(diagnostics, JSON.stringify(value) + "\\n")
}

export default async function probe(input) {
  const plane = await acquireDelegationControlPlane({ ...input, stateDirectory })
  const hooks = delegationPluginHooks(plane.runtime)
  await record({ type: "instance", directory: input.directory, control_plane_id: plane.id })

  if (input.directory === canonical && plane.runtime.registry.list().length === 0) {
    for (const [index, directory] of worktrees.entries()) {
      await plane.runtime.registry.register({
        parent_session_id: "host-parent",
        parent_message_id: "host-turn",
        parent_agent: "Executor",
        parent_directory: canonical,
        execution_directory: directory,
        workspace_id: "host-workspace-" + (index + 1),
        category: "testing",
        agent: "Implementer",
        description: "host task " + (index + 1),
        background: false,
      })
    }
    await record({ type: "seeded", control_plane_id: plane.id, task_count: plane.runtime.registry.list().length })
  }

  return {
    ...hooks,
    event: async ({ event }) => {
      const sessionID = event.properties?.sessionID
      const trackedTaskID = sessionID ? plane.runtime.tracker.taskForSession(sessionID) : null
      await hooks.event({ event })
      if (trackedTaskID && ["session.status", "session.idle"].includes(event.type)) {
        const statusResult = await input.client.session.status({ query: { directory: input.directory } })
        const statuses = statusResult?.data ?? statusResult ?? {}
        await record({
          type: "lifecycle",
          directory: input.directory,
          task_id: trackedTaskID,
          child_session_id: sessionID,
          event_type: event.type,
          event_status: event.properties?.status?.type ?? null,
          status_entry_present: Object.hasOwn(statuses, sessionID),
        })
        if (event.type === "session.idle") {
          const terminal = plane.runtime.registry.get(trackedTaskID)
          await record({
            type: "terminal",
            directory: input.directory,
            control_plane_id: plane.id,
            task_id: trackedTaskID,
            child_session_id: sessionID,
            status: terminal.status,
            completed_at: terminal.completed_at,
          })
        }
      }
      if (event.type !== "session.created") return
      await record({
        type: "host_event",
        observer_directory: input.directory,
        session_directory: event.properties.info.directory,
        child_session_id: event.properties.info.id,
        control_plane_id: plane.id,
      })
      if (!worktrees.includes(input.directory)) return
      const task = plane.runtime.registry.list().find((item) =>
        item.execution_directory === input.directory && item.status === "pending"
      )
      if (!task) return
      const childSessionID = event.properties.info.id
      const startedAt = Date.now()
      plane.runtime.tracker.track({ taskID: task.task_id, childSessionID, startedAt })
      await plane.runtime.registry.start(task.task_id, { child_session_id: childSessionID })

      const user = { id: "user-" + task.task_id, sessionID: childSessionID, role: "user", time: { created: startedAt + 1 } }
      const intermediate = {
        id: "assistant-tool-" + task.task_id,
        sessionID: childSessionID,
        role: "assistant",
        parentID: user.id,
        time: { created: startedAt + 2, completed: startedAt + 3 },
        finish: "tool-calls",
      }
      const final = {
        id: "assistant-final-" + task.task_id,
        sessionID: childSessionID,
        role: "assistant",
        parentID: user.id,
        time: { created: startedAt + 4, completed: startedAt + 5 },
        finish: "stop",
      }
      await plane.runtime.handleEvent({ type: "message.updated", properties: { info: user } })
      await plane.runtime.handleEvent({ type: "message.updated", properties: { info: intermediate } })
      const beforeFinal = plane.runtime.registry.get(task.task_id).status
      await plane.runtime.handleEvent({ type: "message.updated", properties: { info: final } })
      await plane.runtime.handleEvent({
        type: "message.part.updated",
        properties: { part: {
          id: "text-" + task.task_id,
          sessionID: childSessionID,
          messageID: final.id,
          type: "text",
          text: "completed in " + input.directory,
        } },
      })
      await record({
        type: "armed",
        directory: input.directory,
        control_plane_id: plane.id,
        task_id: task.task_id,
        child_session_id: childSessionID,
        before_final: beforeFinal,
      })
    },
  }
}
`
}

async function startServer({ cwd, root, plugin, diagnostics, stateDirectory, canonical, t1, t2 }) {
  const isolatedHome = join(root, "home")
  const env = { ...process.env }
  for (const key of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_PURE"]) delete env[key]
  Object.assign(env, {
    HOME: isolatedHome,
    OPENCODE_TEST_HOME: isolatedHome,
    XDG_CONFIG_HOME: join(isolatedHome, ".config"),
    XDG_DATA_HOME: join(isolatedHome, ".local/share"),
    XDG_STATE_HOME: join(isolatedHome, ".local/state"),
    XDG_CACHE_HOME: join(isolatedHome, ".cache"),
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [pathToFileURL(plugin).href] }),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_AUTH_CONTENT: "{}",
    DELEGATION_PROBE_CANONICAL: canonical,
    DELEGATION_PROBE_T1: t1,
    DELEGATION_PROBE_T2: t2,
    DELEGATION_PROBE_DIAGNOSTICS: diagnostics,
    DELEGATION_PROBE_STATE: stateDirectory,
  })

  const port = await availablePort()
  const child = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => { stdout += chunk })
  child.stderr.on("data", (chunk) => { stderr += chunk })

  const url = await waitFor(() => stdout.match(/listening on (http:\/\/[^\s]+)/)?.[1] ?? null)
    .catch((error) => {
      child.kill("SIGTERM")
      throw new Error(`${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
    })
  return { child, url, output: () => ({ stdout, stderr }) }
}

test("stock OpenCode host forwards two linked-worktree event streams into one delegation control plane", { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "delegation-host-test-"))
  const repository = join(root, "repository")
  const t1 = join(root, "worktree-one")
  const t2 = join(root, "worktree-two")
  const plugin = join(root, "delegation-host-probe.mjs")
  const diagnostics = join(root, "diagnostics.jsonl")
  const stateDirectory = join(root, "delegation-state")
  await execFileAsync("git", ["init", "-b", "main", repository])
  await git(repository, ["config", "user.name", "Delegation Host Test"])
  await git(repository, ["config", "user.email", "delegation-host@example.invalid"])
  await writeFile(join(repository, "tracked.txt"), "baseline\n")
  await git(repository, ["add", "tracked.txt"])
  await git(repository, ["commit", "-m", "baseline"])
  await git(repository, ["worktree", "add", "-b", "host-one", t1, "HEAD"])
  await git(repository, ["worktree", "add", "-b", "host-two", t2, "HEAD"])
  await writeFile(plugin, probeSource())
  const canonicalRepository = await realpath(repository)
  const canonicalT1 = await realpath(t1)
  const canonicalT2 = await realpath(t2)

  const server = await startServer({
    cwd: canonicalRepository,
    root,
    plugin,
    diagnostics,
    stateDirectory,
    canonical: canonicalRepository,
    t1: canonicalT1,
    t2: canonicalT2,
  })
  t.after(async () => {
    server.child.kill("SIGTERM")
    await Promise.race([
      new Promise((resolve) => server.child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ])
    await rm(root, { recursive: true })
  })

  const canonicalPath = await fetch(`${server.url}/path?directory=${encodeURIComponent(canonicalRepository)}`)
  assert.equal(canonicalPath.status, 200, JSON.stringify(server.output()))
  await waitFor(async () => (await readJsonLines(diagnostics)).some((entry) => entry.type === "seeded")).catch(async (error) => {
    throw new Error(`${error.message}\nevidence: ${JSON.stringify(await readJsonLines(diagnostics))}\nserver: ${JSON.stringify(server.output())}`)
  })

  const sessions = await Promise.all([canonicalT1, canonicalT2].map(async (directory) => {
    const response = await fetch(`${server.url}/session?directory=${encodeURIComponent(directory)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: `no-model host event for ${directory}` }),
    })
    assert.equal(response.status, 200, JSON.stringify(server.output()))
    return response.json()
  }))

  await waitFor(async () => {
    const lines = await readJsonLines(diagnostics)
    return lines.filter((entry) => entry.type === "armed").length === 2
  })
  await Promise.all(sessions.map(async (session, index) => {
    const directory = [canonicalT1, canonicalT2][index]
    const response = await fetch(
      `${server.url}/session/${session.id}/abort?directory=${encodeURIComponent(directory)}`,
      { method: "POST" },
    )
    assert.equal(response.status, 200, JSON.stringify(server.output()))
  }))

  const evidence = await waitFor(async () => {
    const lines = await readJsonLines(diagnostics)
    return lines.filter((entry) => entry.type === "terminal").length === 2 ? lines : null
  })
  const instances = evidence.filter((entry) => entry.type === "instance" && [canonicalRepository, canonicalT1, canonicalT2].includes(entry.directory))
  const hostEvents = evidence.filter((entry) => entry.type === "host_event" && sessions.some((session) => session.id === entry.child_session_id))
  const lifecycle = evidence.filter((entry) => entry.type === "lifecycle")
  const terminals = evidence.filter((entry) => entry.type === "terminal")
  assert.deepEqual(new Set(instances.map((entry) => entry.control_plane_id)).size, 1)
  assert.deepEqual(new Set(terminals.map((entry) => entry.control_plane_id)).size, 1)
  assert.equal(hostEvents.length, 2)
  assert.ok(hostEvents.every((entry) => entry.observer_directory === entry.session_directory))
  assert.deepEqual(new Set(terminals.map((entry) => entry.directory)), new Set([canonicalT1, canonicalT2]))
  assert.deepEqual(new Set(terminals.map((entry) => entry.child_session_id)), new Set(sessions.map((session) => session.id)))
  assert.ok(lifecycle.some((entry) => entry.event_type === "session.status" && entry.event_status === "idle"))
  assert.ok(lifecycle.some((entry) => entry.event_type === "session.idle"))
  assert.ok(lifecycle.every((entry) => entry.status_entry_present === false))
  assert.ok(
    terminals.every((entry) => entry.status === "completed" && entry.completed_at),
    JSON.stringify({ terminals, server: server.output() }),
  )

  const commonDir = await realpath(await git(canonicalRepository, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))
  const repositoryID = createHash("sha256").update(commonDir).digest("hex").slice(0, 20)
  const taskStore = join(stateDirectory, "tasks", repositoryID, "tasks.json")
  const persisted = JSON.parse(await readFile(taskStore, "utf8"))
  assert.equal(Object.keys(persisted.tasks).length, 2)
  assert.ok(Object.values(persisted.tasks).every((task) => task.status === "completed"))
})
