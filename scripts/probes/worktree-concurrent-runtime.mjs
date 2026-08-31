#!/usr/bin/env node

import { spawn } from "node:child_process"
import { copyFile, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"

import {
  STATUS,
  assertOwnedProbeRoot,
  cleanupProbeFixture,
  createProbeFixture,
  inspectSentinelIsolation,
  sentinelPayload,
} from "./worktree-isolation.mjs"

const ALLOWED_MODELS = new Set(["openai/gpt-5.6-luna", "openai/gpt-5.6-terra"])
const DEFAULT_MODEL = "openai/gpt-5.6-luna"
const BARRIER_TIMEOUT_MS = 20_000
const PREFLIGHT_TIMEOUT_MS = 90_000
const RUNTIME_TIMEOUT_MS = 240_000

function bigint(value) {
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

export function classifyTemporalOverlap(workers) {
  const a = workers?.A
  const b = workers?.B
  const startA = bigint(a?.start)
  const endA = bigint(a?.end)
  const startB = bigint(b?.start)
  const endB = bigint(b?.end)
  if (
    !a?.completed || !b?.completed ||
    startA === null || endA === null || startB === null || endB === null ||
    endA <= startA || endB <= startB
  ) {
    return { status: STATUS.UNPROVEN, mechanicallyOverlapped: undefined }
  }

  const latestStart = startA > startB ? startA : startB
  const earliestEnd = endA < endB ? endA : endB
  const mechanicallyOverlapped = latestStart < earliestEnd
  if (!mechanicallyOverlapped) {
    return {
      status: STATUS.FAILED,
      mechanicallyOverlapped,
      latestStart: latestStart.toString(),
      earliestEnd: earliestEnd.toString(),
    }
  }

  const barrierConsistent =
    a.peerObserved === true && b.peerObserved === true &&
    a.worker === "A" && b.worker === "B" &&
    a.peer === "B" && b.peer === "A"
  return {
    status: barrierConsistent ? STATUS.PROVEN : STATUS.UNPROVEN,
    mechanicallyOverlapped,
    barrierConsistent,
    latestStart: latestStart.toString(),
    earliestEnd: earliestEnd.toString(),
  }
}

function workerWasMeasured(worker) {
  return worker?.tool?.status === "completed" && worker?.record?.completed === true
}

export function classifySiblingMutation({ workers, sentinels }) {
  if (!workerWasMeasured(workers?.A) || !workerWasMeasured(workers?.B) || !sentinels?.exercised) {
    return {
      siblingMutationConfinement: STATUS.UNPROVEN,
      parentWorkerMutationConfinement: STATUS.UNPROVEN,
    }
  }
  return {
    siblingMutationConfinement:
      sentinels.workerAValid && sentinels.workerBValid && sentinels.siblingIsolated
        ? STATUS.PROVEN
        : STATUS.FAILED,
    parentWorkerMutationConfinement: sentinels.parentUnaffected ? STATUS.PROVEN : STATUS.FAILED,
  }
}

export function classifyWorkerRuntime(expected, observed) {
  if (!observed?.session || !observed?.tool || !observed?.record) return STATUS.UNPROVEN
  if (observed.tool.status !== "completed" || observed.record.completed !== true) return STATUS.UNPROVEN
  const matches =
    observed.session.directory === expected.directory &&
    observed.record.pwd === expected.directory &&
    observed.record.gitTopLevel === expected.directory &&
    observed.record.branch === expected.branch &&
    observed.record.gitCommonDir === expected.commonDir &&
    observed.tool.command === expected.command &&
    !/(^|[;&|]\s*)cd\s/.test(observed.tool.command) &&
    observed.tool.workdir === undefined
  return matches ? STATUS.PROVEN : STATUS.FAILED
}

export function classifyConcurrentRuntime(input) {
  const workerA = classifyWorkerRuntime(input.expected.A, input.workers.A)
  const workerB = classifyWorkerRuntime(input.expected.B, input.workers.B)
  const temporal = classifyTemporalOverlap({
    A: input.workers.A?.record,
    B: input.workers.B?.record,
  })
  const mutation = classifySiblingMutation({ workers: input.workers, sentinels: input.sentinels })
  const modelCompliant = input.modelRequests.length > 0 && input.modelRequests.every((request) =>
    request.provider === "openai" &&
    ALLOWED_MODELS.has(`${request.provider}/${request.model}`) &&
    (request.reasoning === undefined || ["none", "minimal", "low", "medium", "high"].includes(request.reasoning))
  )
  const measured = workerA === STATUS.PROVEN && workerB === STATUS.PROVEN
  return {
    workerAActualCwd: modelCompliant ? workerA : STATUS.UNPROVEN,
    workerBActualCwd: modelCompliant ? workerB : STATUS.UNPROVEN,
    temporalOverlap: modelCompliant ? temporal.status : STATUS.UNPROVEN,
    concurrentSiblingToolIsolation:
      modelCompliant && measured && temporal.status === STATUS.PROVEN && mutation.siblingMutationConfinement === STATUS.PROVEN
        ? STATUS.PROVEN
        : modelCompliant && measured && temporal.status === STATUS.FAILED
          ? STATUS.FAILED
          : STATUS.UNPROVEN,
    siblingMutationConfinement: modelCompliant ? mutation.siblingMutationConfinement : STATUS.UNPROVEN,
    parentWorkerMutationConfinement: modelCompliant ? mutation.parentWorkerMutationConfinement : STATUS.UNPROVEN,
    parentRuntimeBookkeepingCleanliness:
      input.bookkeeping?.base?.length > 0 ? STATUS.FAILED : input.bookkeeping ? STATUS.PROVEN : STATUS.UNPROVEN,
    modelProviderCompliance: modelCompliant ? STATUS.PROVEN : STATUS.FAILED,
    overlap: temporal,
  }
}

async function runCommand(command, args, { cwd, env, timeout = 30_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error(`${command} timed out after ${timeout}ms`))
    }, timeout)
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      resolvePromise({ code, signal, stdout, stderr })
    })
  })
}

function queryAll(db, sql, ...params) {
  return db.prepare(sql).all(...params)
}

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function liveSessionCount() {
  const dbPath = join(homedir(), ".local", "share", "opencode", "opencode.db")
  if (!existsSync(dbPath)) return null
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return Number(db.prepare("SELECT count(*) AS count FROM session").get().count)
  } finally {
    db.close()
  }
}

function barrierSource() {
  return `import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

const [worker, peer, probeId, expectedBranch, expectedCommonDir] = process.argv.slice(2)
const coordination = new URL(".", import.meta.url).pathname
const startedPath = join(coordination, worker + ".started.json")
const peerStartedPath = join(coordination, peer + ".started.json")
const finishedPath = join(coordination, worker + ".finished.json")
const start = process.hrtime.bigint()
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
const identity = {
  schemaVersion: 1,
  probeId,
  worker,
  peer,
  pid: process.pid,
  start: start.toString(),
  pwd: process.cwd(),
  gitTopLevel: git("rev-parse", "--show-toplevel"),
  branch: git("branch", "--show-current"),
  gitCommonDir: git("rev-parse", "--path-format=absolute", "--git-common-dir"),
}
if (identity.branch !== expectedBranch || identity.gitCommonDir !== expectedCommonDir) {
  throw new Error("runtime Git identity does not match the probe fixture")
}
await writeFile(startedPath, JSON.stringify(identity, null, 2) + "\\n", { flag: "wx" })
const deadline = Date.now() + ${BARRIER_TIMEOUT_MS}
while (!existsSync(peerStartedPath) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 50))
}
if (!existsSync(peerStartedPath)) throw new Error("bounded barrier timed out waiting for " + peer)
const sentinel = worker === "A" ? "WORKER_A_SENTINEL" : "WORKER_B_SENTINEL"
await writeFile(sentinel, JSON.stringify({ schemaVersion: 1, probeId, worker }) + "\\n", { flag: "wx" })
const end = process.hrtime.bigint()
await writeFile(finishedPath, JSON.stringify({
  ...identity,
  end: end.toString(),
  peerObserved: true,
  completed: true,
  sentinel,
}, null, 2) + "\\n", { flag: "wx" })
console.log(JSON.stringify({ ...identity, end: end.toString(), peerObserved: true, completed: true, sentinel }))
`
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function workerCommand(fixture, coordination, worker) {
  const peer = worker === "A" ? "B" : "A"
  const branch = worker === "A" ? fixture.branchA : fixture.branchB
  return [
    "exec node",
    shellQuote(join(coordination, "worker-barrier.mjs")),
    shellQuote(worker),
    shellQuote(peer),
    shellQuote(fixture.probeId),
    shellQuote(branch),
    shellQuote(fixture.commonDir),
  ].join(" ")
}

function parentPrompt(fixture, commands) {
  const call = (worker, directory, command) => `task(category="concurrency-probe", load_skills=[], run_in_background=true, directory=${JSON.stringify(directory)}, description="Concurrent worker ${worker}", prompt=${JSON.stringify(`Execute exactly one bash tool call. Its command must be exactly the following string, with no cd and no workdir override:\n${command}\nDo not call any other tool. Report the tool result only.`)})`
  return `This is a mechanical concurrency probe. In your FIRST assistant turn, emit exactly TWO task tool calls in the SAME tool-call batch and no prose:

${call("A", fixture.worktreeA, commands.A)}

${call("B", fixture.worktreeB, commands.B)}

After both launch results return, do not call background_output or any other tool. Wait for both background completion notifications. When both have arrived, respond exactly CONCURRENT_PROBE_COMPLETE.`
}

async function setupRuntime(fixture, omoPackageRoot, model) {
  const runtimeRoot = join(fixture.root, "runtime")
  const home = join(runtimeRoot, "home")
  const xdg = {
    data: join(runtimeRoot, "data"),
    config: join(runtimeRoot, "config"),
    state: join(runtimeRoot, "state"),
    cache: join(runtimeRoot, "cache"),
  }
  const configDir = join(xdg.config, "opencode")
  const dataDir = join(xdg.data, "opencode")
  await Promise.all([
    mkdir(join(home, ".omo"), { recursive: true }),
    mkdir(configDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(xdg.state, { recursive: true }),
    mkdir(xdg.cache, { recursive: true }),
  ])
  const liveAuth = join(homedir(), ".local", "share", "opencode", "auth.json")
  if (!existsSync(liveAuth)) throw new Error(`OpenCode auth file is unavailable: ${liveAuth}`)
  await copyFile(liveAuth, join(dataDir, "auth.json"))

  await writeFile(join(configDir, "opencode.json"), JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model,
    small_model: model,
    agent: {
      "concurrency-probe-parent": {
        description: "Single-purpose concurrent sibling CWD probe parent",
        mode: "primary",
        model,
        variant: "high",
        prompt: "Follow the probe request literally. Launch exactly two task calls in the same tool-call batch. Use no other tools or providers.",
        permission: { task: "allow", bash: "deny", edit: "deny", write: "deny" },
      },
    },
    plugin: [pathToFileURL(join(omoPackageRoot, "dist", "index.js")).href],
  }, null, 2) + "\n")
  await writeFile(join(home, ".omo", "omo.jsonc"), JSON.stringify({
    "[opencode]": {
      auto_update: false,
      telemetry: false,
      model_fallback: false,
      runtime_fallback: false,
      background_task: { modelConcurrency: { [model]: 2 } },
      agents: {
        sisyphus: { models: [model], reasoning: "high" },
        "sisyphus-junior": { models: [model], reasoning: "high" },
      },
      categories: {
        "concurrency-probe": {
          description: "Isolated concurrent child working-directory probe",
          models: [model],
          reasoning: "high",
          tools: { bash: true },
        },
      },
    },
  }, null, 2) + "\n")
  return {
    runtimeRoot,
    dbPath: join(dataDir, "opencode.db"),
    logPath: join(dataDir, "log", "opencode.log"),
    env: {
      ...process.env,
      HOME: home,
      XDG_DATA_HOME: xdg.data,
      XDG_CONFIG_HOME: xdg.config,
      XDG_STATE_HOME: xdg.state,
      XDG_CACHE_HOME: xdg.cache,
      OMO_DISABLE_PROCESS_CLEANUP: "1",
    },
  }
}

async function preflight(runtime, model) {
  // OpenCode debug commands initialize the same isolated SQLite database. Run
  // them sequentially so the routing preflight itself cannot create a DB lock.
  const commandOptions = { env: runtime.env, timeout: PREFLIGHT_TIMEOUT_MS }
  const agent = await runCommand("opencode", ["debug", "agent", "concurrency-probe-parent"], commandOptions)
  const config = await runCommand("opencode", ["debug", "config"], commandOptions)
  const models = await runCommand("opencode", ["models"], commandOptions)
  if (agent.code !== 0 || config.code !== 0 || models.code !== 0) {
    throw new Error(`routing preflight failed: ${agent.stderr || config.stderr || models.stderr}`)
  }
  const agentConfig = parseJson(agent.stdout.replace(/\u001b\[[0-9;]*m/g, ""))
  if (
    agentConfig?.model?.providerID !== "openai" ||
    `openai/${agentConfig?.model?.modelID}` !== model ||
    agentConfig?.variant !== "high" ||
    !models.stdout.split(/\s+/).includes(model)
  ) {
    throw new Error("effective parent routing did not resolve to the requested OpenAI model at high")
  }
  if (!config.stdout.includes(`\"model\": \"${model}\"`) && !config.stdout.includes(`\"model\":\"${model}\"`)) {
    throw new Error("effective OpenCode config did not retain the requested model")
  }
  return { agent: agentConfig, model, fallback: "disabled/constrained by isolated OMO config" }
}

function collectTool(db, sessionID) {
  const rows = queryAll(db, "SELECT data FROM part WHERE session_id = ? ORDER BY time_created, id", sessionID)
  const toolParts = rows.map((row) => parseJson(row.data)).filter((part) => part?.type === "tool" && part?.tool === "bash")
  if (toolParts.length !== 1) return { count: toolParts.length }
  const state = toolParts[0].state ?? {}
  return {
    count: 1,
    status: state.status,
    command: state.input?.command,
    workdir: state.input?.workdir ?? state.input?.cwd,
    output: state.output,
    error: state.error,
    exit: state.metadata?.exit,
    start: state.time?.start,
    end: state.time?.end,
    rawState: state,
  }
}

function collectSessionMessages(db, sessionID) {
  return queryAll(db, "SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id", sessionID)
    .map((row) => ({ rowID: row.id, message: parseJson(row.data) }))
    .filter(({ message }) => Boolean(message))
    .map(({ rowID, message }) => ({
      id: message.id ?? rowID,
      role: message.role,
      provider: message.providerID,
      model: message.modelID,
      reasoning: message.variant,
      agent: message.agent,
      finish: message.finish,
      error: message.error,
      time: message.time,
      parts: queryAll(db, "SELECT data FROM part WHERE message_id = ? ORDER BY time_created, id", message.id ?? rowID)
        .map((row) => parseJson(row.data))
        .filter(Boolean)
        .map((part) => ({
          id: part.id,
          type: part.type,
          tool: part.tool,
          state: part.state,
          time: part.time,
        })),
    }))
}

function collectModelRequests(db, logText) {
  const requests = []
  const stream = /message=stream providerID=(\S+) modelID=(\S+) session\.id=(\S+).*?agent=(\S+)/g
  for (const match of logText.matchAll(stream)) {
    const sessionID = match[3]
    const routedMessage = queryAll(db, "SELECT data FROM message WHERE session_id = ? ORDER BY time_created", sessionID)
      .map((row) => parseJson(row.data))
      .findLast((message) =>
        message?.providerID === match[1]
        && message?.modelID === match[2]
        && typeof message?.variant === "string",
      )
    requests.push({
      purpose: match[4] === "Sisyphus-Junior" ? "delegated child turn" : "parent orchestration turn",
      session: sessionID,
      provider: match[1],
      model: match[2],
      reasoning: routedMessage?.variant,
      agent: match[4],
    })
  }
  return requests
}

async function markerFiles(directory) {
  const markerDir = join(directory, ".omo", "run-continuation")
  try {
    return (await readdir(markerDir)).sort()
  } catch {
    return []
  }
}

async function readJson(path) {
  return parseJson(await readFile(path, "utf8"))
}

async function fixtureFacts(directory) {
  const gitValue = async (...args) => {
    const result = await runCommand("git", args, { cwd: directory })
    if (result.code !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`)
    return result.stdout.trim()
  }
  return {
    pwd: resolve(directory),
    gitTopLevel: await gitValue("rev-parse", "--show-toplevel"),
    branch: await gitValue("branch", "--show-current"),
    gitCommonDir: await gitValue("rev-parse", "--path-format=absolute", "--git-common-dir"),
    status: await gitValue("status", "--short"),
  }
}

async function collectEvidence({ fixture, topologyBefore, coordination, commands, runtime, preflightResult, cliResult, liveBefore }) {
  const db = new DatabaseSync(runtime.dbPath, { readOnly: true })
  try {
    const sessions = queryAll(db, "SELECT id, parent_id, directory, title, time_created, time_updated FROM session ORDER BY time_created")
    const parent = sessions.find((session) => !session.parent_id)
    const childA = sessions.find((session) => session.parent_id === parent?.id && session.directory === fixture.worktreeA)
    const childB = sessions.find((session) => session.parent_id === parent?.id && session.directory === fixture.worktreeB)
    const startedA = existsSync(join(coordination, "A.started.json")) ? await readJson(join(coordination, "A.started.json")) : null
    const startedB = existsSync(join(coordination, "B.started.json")) ? await readJson(join(coordination, "B.started.json")) : null
    const recordA = existsSync(join(coordination, "A.finished.json")) ? await readJson(join(coordination, "A.finished.json")) : startedA
    const recordB = existsSync(join(coordination, "B.finished.json")) ? await readJson(join(coordination, "B.finished.json")) : startedB
    const logText = existsSync(runtime.logPath) ? await readFile(runtime.logPath, "utf8") : ""
    const modelRequests = collectModelRequests(db, logText)
    const sentinels = await inspectSentinelIsolation(fixture)
    const bookkeeping = {
      base: await markerFiles(fixture.base),
      worktreeA: await markerFiles(fixture.worktreeA),
      worktreeB: await markerFiles(fixture.worktreeB),
    }
    const workers = {
      A: {
        session: childA,
        tool: childA ? collectTool(db, childA.id) : null,
        record: recordA,
        messages: childA ? collectSessionMessages(db, childA.id) : [],
      },
      B: {
        session: childB,
        tool: childB ? collectTool(db, childB.id) : null,
        record: recordB,
        messages: childB ? collectSessionMessages(db, childB.id) : [],
      },
    }
    const expected = {
      A: { directory: fixture.worktreeA, branch: fixture.branchA, commonDir: fixture.commonDir, command: commands.A },
      B: { directory: fixture.worktreeB, branch: fixture.branchB, commonDir: fixture.commonDir, command: commands.B },
    }
    const classifications = classifyConcurrentRuntime({ expected, workers, sentinels, bookkeeping, modelRequests })
    const liveAfter = liveSessionCount()
    return {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      fixture: {
        probeId: fixture.probeId,
        root: fixture.root,
        base: fixture.base,
        worktreeA: fixture.worktreeA,
        worktreeB: fixture.worktreeB,
        coordination,
        branchA: fixture.branchA,
        branchB: fixture.branchB,
        commonDir: fixture.commonDir,
        topologyBefore,
      },
      preflight: preflightResult,
      cli: { code: cliResult.code, signal: cliResult.signal, stdout: cliResult.stdout, stderr: cliResult.stderr },
      sessions: { parent, childA, childB },
      expected,
      workers,
      sentinels,
      bookkeeping,
      modelRequests,
      runtimeLog: logText
        .split("\n")
        .filter((line) =>
          line.includes("[background-agent]")
          || line.includes("message=stream")
          || (parent?.id && line.includes(parent.id))
          || (childA?.id && line.includes(childA.id))
          || (childB?.id && line.includes(childB.id)),
        ),
      liveDatabase: {
        before: liveBefore,
        after: liveAfter,
        unchanged: liveBefore === null ? null : liveBefore === liveAfter,
      },
      classifications,
    }
  } finally {
    db.close()
  }
}

async function removeKnownProbeArtifacts(evidence) {
  await assertOwnedProbeRoot(evidence.fixture.root)
  const removals = [
    join(evidence.fixture.worktreeA, "WORKER_A_SENTINEL"),
    join(evidence.fixture.worktreeB, "WORKER_B_SENTINEL"),
  ]
  for (const path of removals) {
    if (existsSync(path)) await unlink(path)
  }
  const sessionsByDirectory = [
    [evidence.fixture.base, evidence.sessions.parent?.id],
    [evidence.fixture.worktreeA, evidence.sessions.childA?.id],
    [evidence.fixture.worktreeB, evidence.sessions.childB?.id],
  ]
  for (const [directory, sessionID] of sessionsByDirectory) {
    if (!sessionID) continue
    const marker = join(directory, ".omo", "run-continuation", `${sessionID}.json`)
    if (existsSync(marker)) await unlink(marker)
  }
  return cleanupProbeFixture(evidence.fixture.root)
}

function parseArgs(argv) {
  const options = { run: false, keep: false, model: DEFAULT_MODEL }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--run") options.run = true
    else if (arg === "--keep") options.keep = true
    else if (arg === "--omo-package-root") options.omoPackageRoot = argv[++index]
    else if (arg === "--evidence-dir") options.evidenceDir = argv[++index]
    else if (arg === "--recover-root") options.recoverRoot = argv[++index]
    else if (arg === "--model") options.model = argv[++index]
    else if (arg === "--help") options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function usage() {
  return `Usage:
  node scripts/probes/worktree-concurrent-runtime.mjs --run \\
    --omo-package-root PATH --evidence-dir PATH [--model openai/gpt-5.6-luna] [--keep]

  node scripts/probes/worktree-concurrent-runtime.mjs --run --recover-root PATH \\
    --evidence-dir PATH [--model openai/gpt-5.6-luna] [--keep]

This companion probe makes runtime LLM calls ONLY with --run. It creates a
disposable base/A/B Git topology, launches two normal OMO background tasks with
caller-selected directories, and requires a bounded causal child-process barrier.`
}

async function recoverConcurrentRuntimeProbe(options) {
  const ownership = await assertOwnedProbeRoot(resolve(options.recoverRoot))
  const root = ownership.root
  const base = join(root, "base")
  const worktreeA = join(root, "worktree-a")
  const worktreeB = join(root, "worktree-b")
  const topologyRecoveredAfter = {
    base: await fixtureFacts(base),
    worktreeA: await fixtureFacts(worktreeA),
    worktreeB: await fixtureFacts(worktreeB),
  }
  const fixture = {
    probeId: ownership.marker.probeId,
    root,
    base,
    worktreeA,
    worktreeB,
    branchA: topologyRecoveredAfter.worktreeA.branch,
    branchB: topologyRecoveredAfter.worktreeB.branch,
    commonDir: topologyRecoveredAfter.base.gitCommonDir,
    sentinelA: "WORKER_A_SENTINEL",
    sentinelB: "WORKER_B_SENTINEL",
  }
  const runtimeRoot = join(root, "runtime")
  const runtime = {
    runtimeRoot,
    dbPath: join(runtimeRoot, "data", "opencode", "opencode.db"),
    logPath: join(runtimeRoot, "data", "opencode", "log", "opencode.log"),
  }
  const coordination = join(root, "coordination")
  const commands = {
    A: workerCommand(fixture, coordination, "A"),
    B: workerCommand(fixture, coordination, "B"),
  }
  const evidence = await collectEvidence({
    fixture,
    topologyBefore: null,
    coordination,
    commands,
    runtime,
    preflightResult: {
      recoveredAfterCollectorFailure: true,
      model: options.model,
      fallback: "isolated runtime configuration retained on disk",
      topologyRecoveredAfter,
    },
    cliResult: {
      code: null,
      signal: null,
      stdout: "",
      stderr: "collector process result unavailable; runtime database and logs recovered",
    },
    liveBefore: null,
  })
  const evidenceDir = resolve(options.evidenceDir)
  await mkdir(evidenceDir, { recursive: true })
  const evidencePath = join(evidenceDir, "runtime-evidence.json")
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n")
  let cleanup = { removed: false, root }
  if (!options.keep) cleanup = await removeKnownProbeArtifacts(evidence)
  const result = { evidencePath, cleanup, classifications: evidence.classifications }
  await writeFile(join(evidenceDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  return result
}

export async function runConcurrentRuntimeProbe(options) {
  if (!options.run) throw new Error("runtime execution requires the explicit --run flag")
  if (!options.evidenceDir || (!options.omoPackageRoot && !options.recoverRoot)) {
    throw new Error("--evidence-dir and either --omo-package-root or --recover-root are required with --run")
  }
  if (!ALLOWED_MODELS.has(options.model)) throw new Error(`model is not allowed: ${options.model}`)
  if (options.recoverRoot) return recoverConcurrentRuntimeProbe(options)
  const omoPackageRoot = resolve(options.omoPackageRoot)
  if (!existsSync(join(omoPackageRoot, "dist", "index.js"))) throw new Error("OMO package root is not built")
  const evidenceDir = resolve(options.evidenceDir)
  await mkdir(evidenceDir, { recursive: true })
  const fixture = await createProbeFixture({ dataRoot: tmpdir() })
  let evidence
  try {
    const coordination = join(fixture.root, "coordination")
    await mkdir(coordination)
    await writeFile(join(coordination, "worker-barrier.mjs"), barrierSource())
    const topologyBefore = {
      base: await fixtureFacts(fixture.base),
      worktreeA: await fixtureFacts(fixture.worktreeA),
      worktreeB: await fixtureFacts(fixture.worktreeB),
    }
    const commands = {
      A: workerCommand(fixture, coordination, "A"),
      B: workerCommand(fixture, coordination, "B"),
    }
    const runtime = await setupRuntime(fixture, omoPackageRoot, options.model)
    const runtimeEnv = { ...runtime.env, PWD: fixture.base }
    const liveBefore = liveSessionCount()
    const preflightResult = await preflight({ ...runtime, env: runtimeEnv }, options.model)
    const cliResult = await runCommand("bun", [
      join(omoPackageRoot, "dist", "cli", "index.js"),
      "run",
      "--directory", fixture.base,
      "--json",
      "--agent", "concurrency-probe-parent",
      "--model", options.model,
      parentPrompt(fixture, commands),
    ], { cwd: fixture.base, env: runtimeEnv, timeout: RUNTIME_TIMEOUT_MS })
    evidence = await collectEvidence({ fixture, topologyBefore, coordination, commands, runtime, preflightResult, cliResult, liveBefore })
    const evidencePath = join(evidenceDir, "runtime-evidence.json")
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n")
    let cleanup = { removed: false, root: fixture.root }
    if (!options.keep) cleanup = await removeKnownProbeArtifacts(evidence)
    const result = { evidencePath, cleanup, classifications: evidence.classifications }
    await writeFile(join(evidenceDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
    return result
  } catch (error) {
    if (!options.keep && !evidence) {
      await cleanupProbeFixture(fixture.root).catch(() => undefined)
    }
    throw error
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const options = parseArgs(process.argv.slice(2))
  if (options.help || !options.run) {
    console.log(usage())
  } else {
    console.log(JSON.stringify(await runConcurrentRuntimeProbe(options), null, 2))
  }
}
