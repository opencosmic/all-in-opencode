#!/usr/bin/env node

import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"

import {
  ALLOWED_MODELS,
  DEFAULT_MODEL,
  classifyWorkerRuntime,
  collectModelRequests,
  collectSessionMessages,
  collectTool,
  fixtureFacts,
  liveSessionCount,
  markerEvidence,
  markerFiles,
  parseJson,
  runCommand,
  shellQuote,
} from "./worktree-concurrent-runtime.mjs"
import {
  STATUS,
  approvedOmoRuntimeBookkeepingPaths,
  assessWorkerIsolationPolicy,
  assertOwnedProbeRoot,
  classifyOmoRuntimeBookkeeping,
  cleanupProbeFixture,
  createProbeFixture,
} from "./worktree-isolation.mjs"

const PREFLIGHT_TIMEOUT_MS = 90_000
const RUNTIME_TIMEOUT_MS = 300_000
const OUTER_SENTINEL = "OUTER_SENTINEL"
const NESTED_SENTINEL = "NESTED_SENTINEL"

function hasOwn(value, key) {
  return value !== null && typeof value === "object" && Object.hasOwn(value, key)
}

function modelRequestsComply(requests) {
  return requests.length > 0 && requests.every((request) =>
    request.provider === "openai" &&
    ALLOWED_MODELS.has(`${request.provider}/${request.model}`) &&
    request.reasoning === "high",
  )
}

function workerMeasured(worker) {
  return worker?.tool?.status === "completed" && worker?.record?.completed === true
}

function toolUsedIntrinsicDirectory(tool) {
  return Boolean(
    tool &&
    typeof tool.command === "string" &&
    !/(^|[;&|]\s*)cd\s/.test(tool.command) &&
    tool.workdir === undefined,
  )
}

export function nestedDirectoryWasOmitted(delegation) {
  const input = delegation?.input
  return Boolean(
    delegation?.count === 1 &&
    input &&
    !hasOwn(input, "directory") &&
    !hasOwn(input, "cwd") &&
    !hasOwn(input, "workdir"),
  )
}

export function classifyNestedRuntime(input) {
  const modelCompliant = modelRequestsComply(input.modelRequests ?? [])
  const bookkeeping = classifyOmoRuntimeBookkeeping(input.bookkeepingEvidence)
  const outerRuntime = classifyWorkerRuntime(input.expected.outer, input.outer)
  const nestedRuntime = classifyWorkerRuntime(input.expected.nested, input.nested)
  const outerExplicitDirectory =
    input.delegations?.outer?.count === 1 &&
    input.delegations.outer.input?.directory === input.expected.outer.directory
  const nestedDirectoryOmitted = nestedDirectoryWasOmitted(input.delegations?.nested)
  const parentageProven = Boolean(
    input.outer?.session?.id &&
    input.nested?.session?.parent_id === input.outer.session.id,
  )
  const sessionInheritanceProven = Boolean(
    input.outer?.session?.directory &&
    input.nested?.session?.directory === input.outer.session.directory,
  )
  const outerTaskAllowed = input.permissions?.outer?.task === true
  const nestedTaskDenied = input.permissions?.nested?.task === false
  const outerToolIntrinsic = toolUsedIntrinsicDirectory(input.outer?.tool)
  const nestedToolIntrinsic = toolUsedIntrinsicDirectory(input.nested?.tool)

  let outerMutationConfinement = STATUS.UNPROVEN
  if (workerMeasured(input.outer) && outerToolIntrinsic && input.sentinels?.exercised) {
    outerMutationConfinement = input.sentinels.outerConfined ? STATUS.PROVEN : STATUS.FAILED
  }

  let nestedMutationConfinement = STATUS.UNPROVEN
  if (workerMeasured(input.nested) && nestedToolIntrinsic && input.sentinels?.exercised) {
    nestedMutationConfinement = input.sentinels.nestedConfined ? STATUS.PROVEN : STATUS.FAILED
  }

  let parentWorkerMutationConfinement = STATUS.UNPROVEN
  if (
    workerMeasured(input.outer) && outerToolIntrinsic &&
    workerMeasured(input.nested) && nestedToolIntrinsic &&
    input.sentinels?.exercised
  ) {
    parentWorkerMutationConfinement = input.sentinels.parentUnaffected ? STATUS.PROVEN : STATUS.FAILED
  }

  let nestedRuntimePreservation = STATUS.UNPROVEN
  const validInheritanceAttempt =
    modelCompliant &&
    outerExplicitDirectory &&
    outerRuntime === STATUS.PROVEN &&
    nestedDirectoryOmitted &&
    parentageProven &&
    outerTaskAllowed &&
    nestedTaskDenied &&
    outerToolIntrinsic &&
    nestedToolIntrinsic

  if (validInheritanceAttempt && workerMeasured(input.nested)) {
    if (nestedRuntime === STATUS.FAILED || !sessionInheritanceProven) {
      nestedRuntimePreservation = STATUS.FAILED
    } else if (
      nestedRuntime === STATUS.PROVEN &&
      nestedMutationConfinement === STATUS.PROVEN
    ) {
      nestedRuntimePreservation = STATUS.PROVEN
    }
  }

  return {
    outerActualCwd: modelCompliant && outerToolIntrinsic ? outerRuntime : STATUS.UNPROVEN,
    nestedActualCwd: modelCompliant && nestedToolIntrinsic ? nestedRuntime : STATUS.UNPROVEN,
    nestedRuntimePreservation,
    outerMutationConfinement: modelCompliant ? outerMutationConfinement : STATUS.UNPROVEN,
    nestedMutationConfinement: modelCompliant ? nestedMutationConfinement : STATUS.UNPROVEN,
    parentWorkerMutationConfinement: modelCompliant ? parentWorkerMutationConfinement : STATUS.UNPROVEN,
    parentRuntimeBookkeepingCleanliness:
      input.bookkeepingEvidence
        ? bookkeeping.literalCleanliness
        : input.bookkeeping?.base?.length > 0 ? STATUS.FAILED : input.bookkeeping ? STATUS.PROVEN : STATUS.UNPROVEN,
    runtimeBookkeepingPolicy: bookkeeping.policyStatus,
    workerIsolationPolicy:
      modelCompliant
        ? assessWorkerIsolationPolicy({ workerMutationConfinement: parentWorkerMutationConfinement, bookkeeping })
        : STATUS.UNPROVEN,
    modelProviderCompliance: modelCompliant ? STATUS.PROVEN : STATUS.FAILED,
    proof: {
      outerExplicitDirectory,
      nestedDirectoryOmitted,
      parentageProven,
      sessionInheritanceProven,
      outerTaskAllowed,
      nestedTaskDenied,
      outerToolIntrinsic,
      nestedToolIntrinsic,
    },
  }
}

function identitySource() {
  return `import { execFileSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

const [role, probeId] = process.argv.slice(2)
if (role !== "OUTER" && role !== "NESTED") throw new Error("unknown probe role")
const coordination = new URL(".", import.meta.url).pathname
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
const record = {
  schemaVersion: 1,
  probeId,
  role,
  pid: process.pid,
  pwd: process.cwd(),
  gitTopLevel: git("rev-parse", "--show-toplevel"),
  branch: git("branch", "--show-current"),
  gitCommonDir: git("rev-parse", "--path-format=absolute", "--git-common-dir"),
  sentinel: role === "OUTER" ? "${OUTER_SENTINEL}" : "${NESTED_SENTINEL}",
  completed: true,
}
await writeFile(record.sentinel, JSON.stringify({ schemaVersion: 1, probeId, role }) + "\\n", { flag: "wx" })
await writeFile(join(coordination, role + ".json"), JSON.stringify(record, null, 2) + "\\n", { flag: "wx" })
console.log(JSON.stringify(record))
`
}

function identityCommand(fixture, coordination, role) {
  return [
    "exec node",
    shellQuote(join(coordination, "nested-identity.mjs")),
    shellQuote(role),
    shellQuote(fixture.probeId),
  ].join(" ")
}

function nestedPrompt(command) {
  return `Execute exactly one bash tool call. Its command must be exactly the following string, with no cd and no tool-level working-directory override:\n${command}\nDo not call task, call_omo_agent, or any other tool. Return the tool result only.`
}

function outerPrompt(commands) {
  const nestedCall = `task(category="nested-probe", load_skills=[], run_in_background=false, description="Nested inherited CWD", prompt=${JSON.stringify(nestedPrompt(commands.nested))})`
  return `This is an isolated mechanical runtime probe, not a planning request. Perform exactly these actions in order:

1. Execute one bash tool call whose command is exactly this string, with no cd and no tool-level working-directory override:
${commands.outer}

2. After that tool completes, execute exactly this task call:
${nestedCall}

The nested task call above intentionally has no directory, cwd, or workdir argument. Do not add one. Do not call call_omo_agent or any other task.

3. After the nested task returns, respond exactly <plan>NESTED_CHAIN_COMPLETE</plan>.`
}

function parentPrompt(fixture, commands) {
  const outerCall = `task(subagent_type="plan", load_skills=[], run_in_background=false, directory=${JSON.stringify(fixture.worktreeA)}, description="Outer nested-CWD probe", prompt=${JSON.stringify(outerPrompt(commands))})`
  return `This is a mechanical nested working-directory probe. In your first assistant turn, execute exactly this task call and no other tool:

${outerCall}

After it returns, respond exactly NESTED_PROBE_COMPLETE.`
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
      "nested-probe-parent": {
        description: "Single-purpose nested CWD probe parent",
        mode: "primary",
        model,
        variant: "high",
        prompt: "Launch exactly the one requested outer task. Use no other tools or providers.",
        permission: { task: "allow", bash: "deny", edit: "deny", write: "deny", question: "deny" },
      },
      plan: {
        description: "Probe-local outer worker with one normal nested delegation",
        mode: "subagent",
        model,
        variant: "high",
        prompt: "You are a single-purpose runtime probe worker. Do not plan, gather context, or launch exploratory agents. Execute the supplied bash command, then the one supplied nested task call, then return the exact marker.",
        permission: { bash: "allow", task: "allow", call_omo_agent: "deny", edit: "deny", write: "deny", question: "deny" },
      },
    },
    plugin: [pathToFileURL(join(omoPackageRoot, "dist", "index.js")).href],
  }, null, 2) + "\n")

  const omoConfig = {
    "[opencode]": {
      auto_update: false,
      telemetry: false,
      model_fallback: false,
      runtime_fallback: false,
      sisyphus_agent: { planner_enabled: false, replace_plan: false },
      background_task: {
        modelConcurrency: { [model]: 2 },
        maxDepth: 2,
        maxLiveDescendantsPerRoot: 2,
      },
      agents: {
        sisyphus: { models: [model], reasoning: "high" },
        "sisyphus-junior": { models: [model], reasoning: "high" },
      },
      categories: {
        "nested-probe": {
          description: "Non-delegating nested child CWD probe",
          models: [model],
          reasoning: "high",
          tools: { bash: true, task: false, call_omo_agent: false, edit: false, write: false },
        },
      },
    },
  }
  await writeFile(join(home, ".omo", "omo.jsonc"), JSON.stringify(omoConfig, null, 2) + "\n")

  return {
    runtimeRoot,
    dbPath: join(dataDir, "opencode.db"),
    logPath: join(dataDir, "log", "opencode.log"),
    omoConfig,
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

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, "")
}

async function preflight(runtime, model) {
  const commandOptions = { env: runtime.env, timeout: PREFLIGHT_TIMEOUT_MS }
  const parent = await runCommand("opencode", ["debug", "agent", "nested-probe-parent"], commandOptions)
  const outer = await runCommand("opencode", ["debug", "agent", "plan"], commandOptions)
  const models = await runCommand("opencode", ["models"], commandOptions)
  if (parent.code !== 0 || outer.code !== 0 || models.code !== 0) {
    throw new Error(`routing preflight failed: ${parent.stderr || outer.stderr || models.stderr}`)
  }
  const parentConfig = parseJson(stripAnsi(parent.stdout))
  const outerConfig = parseJson(stripAnsi(outer.stdout))
  for (const [label, agent] of [["parent", parentConfig], ["outer", outerConfig]]) {
    if (
      agent?.model?.providerID !== "openai" ||
      `openai/${agent?.model?.modelID}` !== model ||
      agent?.variant !== "high"
    ) {
      throw new Error(
        `effective ${label} routing did not resolve to the requested OpenAI model at high: ` +
        JSON.stringify({ name: agent?.name, model: agent?.model, variant: agent?.variant }),
      )
    }
  }
  if (!models.stdout.split(/\s+/).includes(model)) throw new Error("requested model is unavailable")
  const nestedCategory = runtime.omoConfig["[opencode]"].categories["nested-probe"]
  const plannerIsolation = runtime.omoConfig["[opencode]"].sisyphus_agent
  if (
    runtime.omoConfig["[opencode]"].model_fallback !== false ||
    runtime.omoConfig["[opencode]"].runtime_fallback !== false ||
    plannerIsolation.planner_enabled !== false ||
    plannerIsolation.replace_plan !== false ||
    nestedCategory.models.length !== 1 ||
    nestedCategory.models[0] !== model ||
    nestedCategory.reasoning !== "high" ||
    nestedCategory.tools.task !== false
  ) {
    throw new Error("nested routing or recursion guard was not mechanically constrained")
  }
  return {
    parent: parentConfig,
    outer: outerConfig,
    plannerIsolation,
    nestedCategory,
    model,
    fallback: "disabled in isolated OMO config",
    concurrency: { [model]: 2 },
    maxDepth: 2,
    maxLiveDescendantsPerRoot: 2,
  }
}

function queryAll(db, sql, ...params) {
  return db.prepare(sql).all(...params)
}

function collectTaskCall(db, sessionID) {
  const parts = queryAll(db, "SELECT data FROM part WHERE session_id = ? ORDER BY time_created, id", sessionID)
    .map((row) => parseJson(row.data))
    .filter((part) => part?.type === "tool" && part?.tool === "task")
  if (parts.length !== 1) return { count: parts.length }
  const state = parts[0].state ?? {}
  return {
    count: 1,
    status: state.status,
    input: state.input,
    output: state.output,
    error: state.error,
    start: state.time?.start,
    end: state.time?.end,
    rawState: state,
  }
}

function sessionPromptTools(messages) {
  return messages.find((message) => message.role === "user" && message.tools)?.tools
}

async function readJsonIfPresent(path) {
  return existsSync(path) ? parseJson(await readFile(path, "utf8")) : null
}

function sentinelContent(probeId, role) {
  return JSON.stringify({ schemaVersion: 1, probeId, role }) + "\n"
}

async function inspectSentinel(path, expected) {
  if (!existsSync(path)) return { exists: false, valid: false, path }
  const content = await readFile(path, "utf8")
  return {
    exists: true,
    valid: content === expected,
    path,
    sha256: createHash("sha256").update(content).digest("hex"),
  }
}

async function inspectNestedSentinels(fixture) {
  const outerExpected = sentinelContent(fixture.probeId, "OUTER")
  const nestedExpected = sentinelContent(fixture.probeId, "NESTED")
  const paths = {
    baseOuter: await inspectSentinel(join(fixture.base, OUTER_SENTINEL), outerExpected),
    baseNested: await inspectSentinel(join(fixture.base, NESTED_SENTINEL), nestedExpected),
    aOuter: await inspectSentinel(join(fixture.worktreeA, OUTER_SENTINEL), outerExpected),
    aNested: await inspectSentinel(join(fixture.worktreeA, NESTED_SENTINEL), nestedExpected),
    bOuter: await inspectSentinel(join(fixture.worktreeB, OUTER_SENTINEL), outerExpected),
    bNested: await inspectSentinel(join(fixture.worktreeB, NESTED_SENTINEL), nestedExpected),
  }
  return {
    exercised: paths.aOuter.exists || paths.aNested.exists || paths.baseOuter.exists || paths.baseNested.exists || paths.bOuter.exists || paths.bNested.exists,
    outerConfined: paths.aOuter.valid && !paths.baseOuter.exists && !paths.bOuter.exists,
    nestedConfined: paths.aNested.valid && !paths.baseNested.exists && !paths.bNested.exists,
    parentUnaffected: !paths.baseOuter.exists && !paths.baseNested.exists,
    siblingUnaffected: !paths.bOuter.exists && !paths.bNested.exists,
    paths,
  }
}

async function collectEvidence({ fixture, topologyBefore, coordination, commands, runtime, preflightResult, cliResult, liveBefore, omoPackageRoot }) {
  const db = new DatabaseSync(runtime.dbPath, { readOnly: true })
  try {
    const sessions = queryAll(db, "SELECT id, parent_id, directory, title, time_created, time_updated FROM session ORDER BY time_created")
    const parent = sessions.find((session) => !session.parent_id)
    const outerSession = sessions.find((session) => session.parent_id === parent?.id && session.directory === fixture.worktreeA)
    const nestedSession = sessions.find((session) => session.parent_id === outerSession?.id)
    const outerMessages = outerSession ? collectSessionMessages(db, outerSession.id) : []
    const nestedMessages = nestedSession ? collectSessionMessages(db, nestedSession.id) : []
    const outerRecord = await readJsonIfPresent(join(coordination, "OUTER.json"))
    const nestedRecord = await readJsonIfPresent(join(coordination, "NESTED.json"))
    const logText = existsSync(runtime.logPath) ? await readFile(runtime.logPath, "utf8") : ""
    const modelRequests = collectModelRequests(db, logText, (agent) => {
      if (agent === "plan") return "outer worker turn"
      if (agent === "Sisyphus-Junior") return "nested worker turn"
      return "parent orchestration turn"
    })
    const sentinels = await inspectNestedSentinels(fixture)
    const bookkeeping = {
      base: await markerFiles(fixture.base),
      worktreeA: await markerFiles(fixture.worktreeA),
      worktreeB: await markerFiles(fixture.worktreeB),
    }
    const delegations = {
      outer: parent ? collectTaskCall(db, parent.id) : null,
      nested: outerSession ? collectTaskCall(db, outerSession.id) : null,
    }
    const outer = {
      session: outerSession,
      tool: outerSession ? collectTool(db, outerSession.id) : null,
      record: outerRecord,
      messages: outerMessages,
    }
    const nested = {
      session: nestedSession,
      tool: nestedSession ? collectTool(db, nestedSession.id) : null,
      record: nestedRecord,
      messages: nestedMessages,
    }
    const bookkeepingEvidence = {
      markers: [
        ...(await markerEvidence(fixture.base)),
        ...(await markerEvidence(fixture.worktreeA)),
        ...(await markerEvidence(fixture.worktreeB)),
      ],
      sessions: [parent, outerSession, nestedSession],
    }
    const expected = {
      outer: { directory: fixture.worktreeA, branch: fixture.branchA, commonDir: fixture.commonDir, command: commands.outer },
      nested: { directory: fixture.worktreeA, branch: fixture.branchA, commonDir: fixture.commonDir, command: commands.nested },
    }
    const permissions = {
      outer: sessionPromptTools(outerMessages) ?? null,
      nested: sessionPromptTools(nestedMessages) ?? null,
    }
    const classifications = classifyNestedRuntime({
      expected,
      outer,
      nested,
      delegations,
      permissions,
      sentinels,
      bookkeeping,
      bookkeepingEvidence,
      modelRequests,
    })
    const integrationHead = await runCommand("git", ["rev-parse", "HEAD"], { cwd: omoPackageRoot })
    const opencodeVersion = await runCommand("opencode", ["--version"], { env: runtime.env })
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
      versions: {
        opencode: opencodeVersion.stdout.trim(),
        omoPackageRoot,
        omoIntegrationHead: integrationHead.stdout.trim(),
      },
      preflight: preflightResult,
      cli: { code: cliResult.code, signal: cliResult.signal, stdout: cliResult.stdout, stderr: cliResult.stderr },
      sessions: { parent, outer: outerSession, nested: nestedSession },
      delegations,
      permissions,
      expected,
      outer,
      nested,
      sentinels,
      bookkeeping,
      bookkeepingEvidence,
      modelRequests,
      runtimeLog: logText
        .split("\n")
        .filter((line) =>
          line.includes("message=stream") ||
          line.includes("[background-agent]") ||
          (parent?.id && line.includes(parent.id)) ||
          (outerSession?.id && line.includes(outerSession.id)) ||
          (nestedSession?.id && line.includes(nestedSession.id)),
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
  for (const directory of [evidence.fixture.base, evidence.fixture.worktreeA, evidence.fixture.worktreeB]) {
    for (const name of [OUTER_SENTINEL, NESTED_SENTINEL]) {
      const path = join(directory, name)
      if (existsSync(path)) await unlink(path)
    }
  }
  for (const markerPath of approvedOmoRuntimeBookkeepingPaths(evidence.bookkeepingEvidence)) {
    if (existsSync(markerPath)) await unlink(markerPath)
  }
  return cleanupProbeFixture(evidence.fixture.root)
}

function parseArgs(argv) {
  const options = { run: false, keep: false, preflightOnly: false, model: DEFAULT_MODEL }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--run") options.run = true
    else if (arg === "--keep") options.keep = true
    else if (arg === "--preflight-only") options.preflightOnly = true
    else if (arg === "--omo-package-root") options.omoPackageRoot = argv[++index]
    else if (arg === "--evidence-dir") options.evidenceDir = argv[++index]
    else if (arg === "--model") options.model = argv[++index]
    else if (arg === "--help") options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function usage() {
  return `Usage:
  node scripts/probes/worktree-nested-runtime.mjs --run \\
    --omo-package-root PATH --evidence-dir PATH [--model openai/gpt-5.6-luna] [--keep]

Add --preflight-only to validate routing and clean up without invoking an LLM.

This companion probe makes runtime LLM calls ONLY with --run. It creates a
provenance-owned base/A/B Git topology, explicitly binds one normal outer task
to A, and requires its one nested normal task to omit directory and inherit A.`
}

export async function runNestedRuntimeProbe(options) {
  if (!options.run) throw new Error("runtime execution requires the explicit --run flag")
  if (!options.omoPackageRoot || !options.evidenceDir) {
    throw new Error("--omo-package-root and --evidence-dir are required with --run")
  }
  if (!ALLOWED_MODELS.has(options.model)) throw new Error(`model is not allowed: ${options.model}`)
  const omoPackageRoot = resolve(options.omoPackageRoot)
  if (!existsSync(join(omoPackageRoot, "dist", "index.js"))) throw new Error("OMO package root is not built")
  const evidenceDir = resolve(options.evidenceDir)
  await mkdir(evidenceDir, { recursive: true })
  const fixture = await createProbeFixture({ dataRoot: "/private/tmp" })
  let evidence
  let runtimeStarted = false
  try {
    const coordination = join(fixture.root, "coordination")
    await mkdir(coordination)
    await writeFile(join(coordination, "nested-identity.mjs"), identitySource())
    const topologyBefore = {
      base: await fixtureFacts(fixture.base),
      worktreeA: await fixtureFacts(fixture.worktreeA),
      worktreeB: await fixtureFacts(fixture.worktreeB),
    }
    const commands = {
      outer: identityCommand(fixture, coordination, "OUTER"),
      nested: identityCommand(fixture, coordination, "NESTED"),
    }
    const runtime = await setupRuntime(fixture, omoPackageRoot, options.model)
    const runtimeEnv = { ...runtime.env, PWD: fixture.base }
    const liveBefore = liveSessionCount()
    const preflightResult = await preflight({ ...runtime, env: runtimeEnv }, options.model)
    if (options.preflightOnly) {
      return {
        preflight: preflightResult,
        cleanup: await cleanupProbeFixture(fixture.root),
        runtimeStarted: false,
      }
    }
    runtimeStarted = true
    const cliResult = await runCommand("bun", [
      join(omoPackageRoot, "dist", "cli", "index.js"),
      "run",
      "--directory", fixture.base,
      "--json",
      "--agent", "nested-probe-parent",
      "--model", options.model,
      parentPrompt(fixture, commands),
    ], { cwd: fixture.base, env: runtimeEnv, timeout: RUNTIME_TIMEOUT_MS })
    evidence = await collectEvidence({
      fixture,
      topologyBefore,
      coordination,
      commands,
      runtime,
      preflightResult,
      cliResult,
      liveBefore,
      omoPackageRoot,
    })
    const evidencePath = join(evidenceDir, "runtime-evidence.json")
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n")
    let cleanup = { removed: false, root: fixture.root }
    if (!options.keep) cleanup = await removeKnownProbeArtifacts(evidence)
    const result = { evidencePath, cleanup, classifications: evidence.classifications }
    await writeFile(join(evidenceDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
    return result
  } catch (error) {
    if (!runtimeStarted && !options.keep) {
      await cleanupProbeFixture(fixture.root).catch(() => undefined)
    }
    const suffix = runtimeStarted && !evidence ? ` Probe fixture preserved at ${fixture.root}.` : ""
    throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const options = parseArgs(process.argv.slice(2))
  if (options.help || !options.run) {
    console.log(usage())
  } else {
    console.log(JSON.stringify(await runNestedRuntimeProbe(options), null, 2))
  }
}
