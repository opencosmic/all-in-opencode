#!/usr/bin/env node

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createServer } from "node:net"
import { copyFile, cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"

import { assessLaneRuntimeCapability, REQUIRED_RUNTIME_CAPABILITIES } from "../lib/lane-worktrees.mjs"
import { classifyExecutorLaneE2E } from "../lib/executor-lane-e2e.mjs"
import {
  ALLOWED_MODELS,
  DEFAULT_MODEL,
  collectModelRequests,
  markerEvidence,
  parseJson,
  runCommand,
} from "./worktree-concurrent-runtime.mjs"
import { STATUS, classifyOmoRuntimeBookkeeping } from "./worktree-isolation.mjs"

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..")
const PROBE_PREFIX = "executor-lane-e2e-"
const OWNER_FILE = ".executor-lane-e2e-owner.json"
const EXPECTED_OMO_HEAD = "5c699bc74830864eac0cd27ae7e453a3faf5a3df"
const RUNTIME_TIMEOUT_MS = 20 * 60_000
const ROLE_NAMES = ["Executor", "executor", "Plan Reviewer", "Reviewer", "QA", "Sisyphus-Junior"]

function usage() {
  return `Usage:
  node scripts/probes/executor-lane-runtime.mjs --preflight-only --omo-package-root <path> --evidence-dir <path>
  node scripts/probes/executor-lane-runtime.mjs --run --omo-package-root <path> --evidence-dir <path> [--keep]

The probe never invokes an LLM unless --run is present. It uses an isolated
HOME/XDG runtime, the real /execute command, the real Executor, and the exact
measured OMO build supplied by --omo-package-root.`
}

function parseArgs(argv) {
  const options = { run: false, preflightOnly: false, keep: false, model: DEFAULT_MODEL }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--run") options.run = true
    else if (arg === "--preflight-only") options.preflightOnly = true
    else if (arg === "--keep") options.keep = true
    else if (arg === "--omo-package-root") options.omoPackageRoot = resolve(argv[++index])
    else if (arg === "--evidence-dir") options.evidenceDir = resolve(argv[++index])
    else if (arg === "--model") options.model = argv[++index]
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (options.run && options.preflightOnly) throw new Error("choose --run or --preflight-only")
  return options
}

function git(directory, ...args) {
  return runCommand("git", args, { cwd: directory, timeout: 60_000 })
}

async function gitValue(directory, ...args) {
  const result = await git(directory, ...args)
  if (result.code !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`)
  return result.stdout.trim()
}

async function write(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value)
}

function taskState(text) {
  const state = {}
  for (const id of ["T1", "T2", "T3"]) state[id] = new RegExp(`- \\[x\\] ${id}\\b`).test(text)
  return state
}

function runtimeCapabilityEvidence(openCodeVersion, omoHead) {
  return {
    source: "mechanical-runtime-evidence",
    adoptedForExecution: true,
    runtimeIdentity: { opencode: openCodeVersion, omoHead },
    capabilities: Object.fromEntries(REQUIRED_RUNTIME_CAPABILITIES.map((name) => [name, STATUS.PROVEN])),
  }
}

function workerScript() {
  return `import { execFileSync } from "node:child_process"
import { connect } from "node:net"
import { mkdir, writeFile } from "node:fs/promises"

const task = process.argv[2]
if (!new Set(["T1", "T2"]).has(task)) throw new Error("expected T1 or T2")
const port = Number(process.env.EXECUTOR_LANE_E2E_PORT)
const token = process.env.EXECUTOR_LANE_E2E_TOKEN
if (!Number.isInteger(port) || !token) throw new Error("missing harness barrier environment")
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
const evidence = {
  task,
  pid: process.pid,
  start: process.hrtime.bigint().toString(),
  wallStart: Date.now(),
  pwd: process.cwd(),
  gitTopLevel: git("rev-parse", "--show-toplevel"),
  branch: git("branch", "--show-current"),
  gitCommonDir: git("rev-parse", "--path-format=absolute", "--git-common-dir"),
}
const socket = connect({ host: "127.0.0.1", port })
socket.setEncoding("utf8")
socket.write(JSON.stringify({ token, type: "worker-start", task, evidence }) + "\\n")
let buffer = ""
await new Promise((resolve, reject) => {
  socket.on("data", (chunk) => {
    buffer += chunk
    if (buffer.includes("RELEASE\\n")) resolve()
  })
  socket.on("error", reject)
})
const path = task === "T1" ? "src/a.txt" : "src/b.txt"
const contents = task === "T1" ? "A\\n" : "B\\n"
await mkdir("src", { recursive: true })
await writeFile(path, contents, { flag: "wx" })
const finish = { ...evidence, end: process.hrtime.bigint().toString(), wallEnd: Date.now(), path, completed: true }
socket.write(JSON.stringify({ token, type: "worker-finish", task, evidence: finish }) + "\\n")
socket.end()
console.log(JSON.stringify(finish))
`
}

function t3Script() {
  return `import { execFileSync } from "node:child_process"
import { connect } from "node:net"
import { readFile, writeFile } from "node:fs/promises"

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
const port = Number(process.env.EXECUTOR_LANE_E2E_PORT)
const token = process.env.EXECUTOR_LANE_E2E_TOKEN
if (!Number.isInteger(port) || !token) throw new Error("missing harness barrier environment")
const a = await readFile("src/a.txt", "utf8")
const b = await readFile("src/b.txt", "utf8")
const evidence = {
  task: "T3", pid: process.pid, start: process.hrtime.bigint().toString(), pwd: process.cwd(),
  gitTopLevel: git("rev-parse", "--show-toplevel"), branch: git("branch", "--show-current"),
  gitCommonDir: git("rev-parse", "--path-format=absolute", "--git-common-dir"),
  observedT1: a === "A\\n", observedT2: b === "B\\n",
}
const send = (payload) => new Promise((resolve, reject) => {
  const socket = connect({ host: "127.0.0.1", port }, () => {
    socket.end(JSON.stringify({ token, ...payload }) + "\\n")
  })
  socket.on("close", resolve); socket.on("error", reject)
})
await send({ type: "t3-start", evidence })
await writeFile("src/combined.txt", a.trim() + "+" + b.trim() + "\\n", { flag: "wx" })
const finish = { ...evidence, end: process.hrtime.bigint().toString(), completed: true }
await send({ type: "t3-finish", evidence: finish })
console.log(JSON.stringify(finish))
`
}

function checkScript(kind) {
  const body = kind === "wave"
    ? `const checks = (await readFile("src/a.txt", "utf8")) === "A\\n" && (await readFile("src/b.txt", "utf8")) === "B\\n"`
    : `const checks = (await readFile("src/combined.txt", "utf8")) === "A+B\\n"`
  return `import { connect } from "node:net"
import { readFile } from "node:fs/promises"
const port = Number(process.env.EXECUTOR_LANE_E2E_PORT)
const token = process.env.EXECUTOR_LANE_E2E_TOKEN
if (!Number.isInteger(port) || !token) throw new Error("missing harness barrier environment")
${body}
if (!checks) throw new Error(${JSON.stringify(`${kind} check failed`)})
await new Promise((resolve, reject) => {
  const socket = connect({ host: "127.0.0.1", port }, () => socket.end(JSON.stringify({
    token, type: ${JSON.stringify(`${kind}-check`)}, at: process.hrtime.bigint().toString(), passed: true
  }) + "\\n"))
  socket.on("close", resolve); socket.on("error", reject)
})
console.log(${JSON.stringify(`${kind.toUpperCase()}_CHECK_PASS`)})
`
}

async function createFixture(root, port, token) {
  const fixture = join(root, "fixture")
  const lanes = { T1: join(root, "lanes", "T1"), T2: join(root, "lanes", "T2") }
  await mkdir(join(fixture, "src"), { recursive: true })
  await mkdir(join(root, "lanes"), { recursive: true })
  await write(join(fixture, "README.md"), "Executor lane E2E fixture\n")
  await write(join(fixture, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2) + "\n")
  await write(join(fixture, "scripts", "lane-worker.mjs"), workerScript())
  await write(join(fixture, "scripts", "t3-worker.mjs"), t3Script())
  await write(join(fixture, "scripts", "check-wave.mjs"), checkScript("wave"))
  await write(join(fixture, "scripts", "check-final.mjs"), checkScript("final"))
  await write(join(fixture, "scripts", "check-task.mjs"), `import { readFile } from "node:fs/promises"
const task = process.argv[2]
const path = task === "T1" ? "src/a.txt" : "src/b.txt"
const expected = task === "T1" ? "A\\n" : "B\\n"
if ((await readFile(path, "utf8")) !== expected) throw new Error(task + " check failed")
console.log(task + "_CHECK_PASS")
`)
  await write(join(fixture, "openspec", "config.yaml"), "schema: spec-driven\n")
  const change = join(fixture, "openspec", "changes", "executor-lane-e2e")
  await write(join(change, "proposal.md"), `# Executor lane E2E\n\n## Why\n\nProve the lane lifecycle in a disposable repository.\n\n## What Changes\n\n- Add independent A and B outputs.\n- Add a dependent combined output.\n\n## Capabilities\n\n### New Capabilities\n- \`executor-lane-e2e\`: Disposable lane orchestration proof.\n\n## Impact\n\nOnly this disposable fixture changes.\n`)
  await write(join(change, "design.md"), `# Design\n\n## Execution topology\n\nLANE_WORKTREES for wave 1, then CHANGE_WORKTREE for the single dependent task. Executor creates two genuine linked worktrees from the same captured canonical SHA and records each absolute path, unique branch, HEAD, and Git common directory before dispatch.\n\n## Wave 1\n\nT1 and T2 are SAFE_TO_PARALLELIZE and LANE_ISOLATION_ELIGIBLE. Their write scopes are disjoint and they share no mutable contract, schema, migration, generated output, lock file, project port, external service, or project test fixture. Executor sends both normal OMO category task calls in one tool-call batch with each lane path in the task API directory field. A prompt path is not CWD authority.\n\n## Causal overlap and telemetry\n\nThe tracked lane-worker script opens a loopback TCP connection to a harness-owned bounded causal barrier. The probe binds one OS-assigned loopback port inside its unique provenance root and uses a per-run random token; the entire run has a 20-minute bound. This is allowed transient harness coordination, not shared project state, a project port, an external service, a worker scheduler, or durable workflow state. The worker sends task ID, PID, monotonic start, actual pwd, Git top-level, branch, and Git common directory. The harness releases both workers only after both connections arrive. Each worker then writes only its declared source file and sends a finish timestamp. Accepted overlap requires max(T1.start,T2.start) < min(T1.end,T2.end).\n\n## Session-directory proof\n\nThe harness—not worker prose—queries the isolated OpenCode SQLite session/message/part records after execution. For each task it captures the parent task-call input directory, child session parent ID, stored child session directory, bash command, absence of a tool workdir override, and the child script's actual CWD/Git evidence. Acceptance requires requested directory = stored directory = actual pwd = Git top-level = assigned lane, plus the expected branch/common directory.\n\n## Independent confinement and review\n\nBefore integration the harness independently requires canonical to contain neither output, lane T1 to contain only A, and lane T2 to contain only B. Executor checks each actual lane diff, runs its focused check, and obtains a lane-local Reviewer verdict. The harness captures Reviewer session IDs/final verdicts and rejects missing approval. QA is not applicable because this is a deterministic internal text fixture with no user-facing/runtime surface beyond the mechanically measured orchestration itself. Executor commits accepted source files only; the harness extracts subjects, changed paths, and commit SHAs from Git.\n\n## Integration and task timing\n\nExecutor merges T1 then T2 in tasks.md order with non-fast-forward merges. The harness extracts first-parent merge order and merge SHAs. Executor runs the wave check in canonical; that script sends a timestamped pass event to the harness. The harness snapshots tasks.md before execution, after both worker mutations, after canonical integration, and after the wave gate. T1/T2 must stay unchecked until both merges and that check pass. T3 MUST_SERIALIZE and depends on that timestamped gate; its script records start/CWD/Git identity, reads both integrated outputs, and writes the combined output. Acceptance requires T3.start > wave-check completion.\n\n## Cleanup\n\nExecutor removes only provenance-matched continuation markers for known sessions, then uses normal worktree removal and safe branch deletion. The harness verifies absence from final worktree/branch listings. Unknown state or normal-removal refusal is preserved and prevents full E2E proof.\n`)
  await write(join(change, "specs", "executor-lane-e2e", "spec.md"), `## ADDED Requirements\n\n### Requirement: Independent lane outputs\nThe workflow SHALL create A and B through real OMO children in distinct genuine linked worktrees that share one baseline and Git common directory.\n\n#### Scenario: Parallel independent implementation\n- **WHEN** T1 and T2 are dependency-ready and lane eligible\n- **THEN** their task API directory values, stored session directories, actual pwd, Git top-level, branches, and common directory match their assigned lanes\n- **AND** their actual child tool intervals strictly overlap at the harness-owned causal barrier\n- **AND** canonical has neither mutation, lane T1 has only A, and lane T2 has only B before integration\n\n### Requirement: Reviewed deterministic integration\nThe workflow SHALL inspect, check, and independently review both lane diffs before committing and merging them in T1 then T2 task order.\n\n#### Scenario: Wave completion\n- **WHEN** both reviewed lane commits are merged and the canonical wave check passes\n- **THEN** Executor marks T1 and T2 complete\n- **AND** it did not mark them complete at worker completion or merge time alone\n\n### Requirement: Dependent combined output\nThe workflow SHALL create the combined output only after A and B are integrated and checked.\n\n#### Scenario: Dependency gate\n- **WHEN** wave 1 passes combined verification\n- **THEN** T3 runs without a sibling lane in the canonical change worktree and mechanically observes both outputs\n`)
  await write(join(change, "tasks.md"), `# Tasks\n\n- [ ] T1 Create \`src/a.txt\` containing exactly \`A\\n\`. SAFE_TO_PARALLELIZE. LANE_ISOLATION_ELIGIBLE. Dependencies: none. Write scope: \`src/a.txt\`. Worker category: \`lane-e2e\`. Worker command: \`node scripts/lane-worker.mjs T1\`. Focused check: \`node scripts/check-task.mjs T1\`. QA: not applicable; this is a mechanical internal text fixture.\n- [ ] T2 Create \`src/b.txt\` containing exactly \`B\\n\`. SAFE_TO_PARALLELIZE. LANE_ISOLATION_ELIGIBLE. Dependencies: none. Write scope: \`src/b.txt\`. Worker category: \`lane-e2e\`. Worker command: \`node scripts/lane-worker.mjs T2\`. Focused check: \`node scripts/check-task.mjs T2\`. QA: not applicable; this is a mechanical internal text fixture.\n- [ ] T3 After T1 and T2 are canonically integrated and \`node scripts/check-wave.mjs\` passes, create \`src/combined.txt\` containing exactly \`A+B\\n\`. MUST_SERIALIZE. Dependencies: T1, T2. Write scope: \`src/combined.txt\`. Worker category: \`lane-e2e\`. Worker command: \`node scripts/t3-worker.mjs\`. Final check: \`node scripts/check-final.mjs\`. QA: not applicable; this is a mechanical internal text fixture.\n\n## Harness-owned acceptance evidence\n\nThe external disposable probe must reject the E2E unless it mechanically captures: fresh Plan Reviewer approval; both task-call and stored child directories; child parent/session IDs; actual pwd/Git identity; strict T1/T2 tool overlap; the canonical/lane confinement matrix; focused-check passes; lane-local Reviewer approvals; lane commit SHAs/subjects/paths; non-fast-forward integration order T1 then T2; a timestamped wave-check pass; tasks.md snapshots proving no early T1/T2 completion; T3 start after that gate with both inputs observed; allowed Luna/high request accounting; and normal worktree plus safe branch cleanup. Agent prose alone satisfies none of these assertions.\n`)
  await write(join(root, OWNER_FILE), JSON.stringify({ schemaVersion: 1, probe: "executor-lane-runtime", fixture }, null, 2) + "\n")
  let result = await git(fixture, "init", "-b", "fixture-change")
  if (result.code !== 0) throw new Error(result.stderr)
  await git(fixture, "config", "user.name", "Executor Lane E2E")
  await git(fixture, "config", "user.email", "executor-lane-e2e@example.invalid")
  await git(fixture, "add", ".")
  result = await git(fixture, "commit", "-m", "fixture: establish lane E2E baseline")
  if (result.code !== 0) throw new Error(result.stderr)
  const head = await gitValue(fixture, "rev-parse", "HEAD")
  const commonDir = await gitValue(fixture, "rev-parse", "--path-format=absolute", "--git-common-dir")
  return {
    root, fixture, lanes, head, commonDir,
    branches: { T1: "fixture-change--lane-T1-e2e", T2: "fixture-change--lane-T2-e2e" },
    tasksPath: join(change, "tasks.md"),
  }
}

async function createBarrier() {
  const token = crypto.randomUUID()
  const events = []
  const sockets = new Map()
  const server = createServer((socket) => {
    let buffer = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk) => {
      buffer += chunk
      let newline
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        const event = parseJson(line)
        if (!event || event.token !== token) continue
        events.push({ ...event, receivedAt: Date.now() })
        if (event.type === "worker-start") {
          sockets.set(event.task, socket)
          if (sockets.has("T1") && sockets.has("T2")) {
            sockets.get("T1").write("RELEASE\n")
            sockets.get("T2").write("RELEASE\n")
          }
        } else {
          socket.end()
        }
      }
    })
  })
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolvePromise)
  })
  return { server, token, port: server.address().port, events }
}

function exactBashPolicy(fixture) {
  const rules = {
    "*": "ask",
    "git status*": "allow",
    "git rev-parse*": "allow",
    "git branch --show-current*": "allow",
    "git worktree list*": "allow",
    "git diff*": "allow",
    "git log*": "allow",
    "git show*": "allow",
    "git ls-files*": "allow",
    "git rev-list*": "allow",
    "git merge-base*": "allow",
    "openspec status*": "allow",
    "openspec validate*": "allow",
    "node scripts/check-task.mjs *": "allow",
    "node scripts/check-wave.mjs": "allow",
    "node scripts/check-final.mjs": "allow",
    "git add src/a.txt": "allow",
    "git add src/b.txt": "allow",
    "git commit -m 'T1: add A'": "allow",
    "git commit -m 'T2: add B'": "allow",
    [`ls -la ${fixture.root}`]: "allow",
    [`ls -la ${fixture.fixture}`]: "allow",
    [`ls ${fixture.root}`]: "allow",
    [`ls ${fixture.fixture}`]: "allow",
    [`ls -ld ${fixture.root}*`]: "allow",
    [`pwd; git status --short --branch; git log --oneline -10; git submodule status; git worktree list --porcelain; ls ${fixture.root}`]: "allow",
    "node --check scripts/lane-worker.mjs; node --check scripts/check-task.mjs; node --check scripts/check-wave.mjs; node --check scripts/t3-worker.mjs; node --check scripts/check-final.mjs; node -e 'const p=require(\"./package.json\"); console.log(\"BOOTSTRAP_OK\", p.private === true, p.type)'": "allow",
    "env | grep '^EXECUTOR_LANE_E2E_' || true": "allow",
  }
  for (const id of ["T1", "T2"]) {
    const branch = fixture.branches[id]
    const path = fixture.lanes[id]
    rules[`git worktree add -b ${branch} ${path} ${fixture.head}`] = "allow"
    rules[`git worktree add -b *${branch}* *${path}* ${fixture.head}`] = "allow"
    rules[`git merge --no-ff --no-edit ${branch}`] = "allow"
    rules[`rm ${path}/.omo/run-continuation/ses_*.json`] = "allow"
    rules[`git worktree remove ${path}`] = "allow"
    rules[`git branch -d ${branch}`] = "allow"
  }
  return rules
}

async function setupRuntime(fixture, omoPackageRoot, model, barrier) {
  const runtimeRoot = join(fixture.root, "runtime")
  const home = join(runtimeRoot, "home")
  const xdg = {
    data: join(runtimeRoot, "data"), config: join(runtimeRoot, "config"),
    state: join(runtimeRoot, "state"), cache: join(runtimeRoot, "cache"),
  }
  const configDir = join(xdg.config, "opencode")
  const dataDir = join(xdg.data, "opencode")
  await Promise.all([
    mkdir(join(home, ".omo"), { recursive: true }), mkdir(configDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }), mkdir(xdg.state, { recursive: true }), mkdir(xdg.cache, { recursive: true }),
  ])
  const auth = join(homedir(), ".local", "share", "opencode", "auth.json")
  if (!existsSync(auth)) throw new Error(`OpenCode auth file is unavailable: ${auth}`)
  await copyFile(auth, join(dataDir, "auth.json"))
  await cp(join(REPO_ROOT, "opencode", "agents"), join(configDir, "agents"), { recursive: true })
  await cp(join(REPO_ROOT, "opencode", "commands"), join(configDir, "commands"), { recursive: true })

  const executorSource = await readFile(join(REPO_ROOT, "opencode", "agents", "executor.md"), "utf8")
  const executorPrompt = executorSource.split(/^---\s*$/m).slice(2).join("---\n").trim()
  const executeCommandPath = join(configDir, "commands", "execute.md")
  const executeCommand = await readFile(executeCommandPath, "utf8")
  await writeFile(executeCommandPath, executeCommand.replace("agent: Executor", "agent: executor"))

  const roleOverride = Object.fromEntries(ROLE_NAMES.map((name) => [name, { model, variant: "high" }]))
  const executorPermission = {
    "*": "deny",
    read: { "*": "allow", ".env*": "deny", "*/.env*": "deny" },
    glob: "allow", grep: "allow", list: "allow", lsp: "allow",
    codegraph_codegraph_explore: "allow", todowrite: "allow", question: "allow",
    task: "allow", call_omo_agent: "allow", background_output: "allow", background_cancel: "allow",
    workspace_inspect: "allow",
    edit: { "*": "deny", "openspec/changes/**/tasks.md": "allow" },
    bash: exactBashPolicy(fixture),
    external_directory: { "*": "deny", [fixture.lanes.T1]: "allow", [fixture.lanes.T2]: "allow" },
  }
  roleOverride.Executor.permission = executorPermission
  roleOverride.executor = {
    ...roleOverride.executor,
    description: "Probe-local CLI alias for the canonical Executor",
    mode: "primary",
    prompt: executorPrompt,
    permission: executorPermission,
  }
  await write(join(configDir, "opencode.json"), JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model,
    small_model: model,
    agent: roleOverride,
    plugin: [
      pathToFileURL(join(omoPackageRoot, "dist", "index.js")).href,
      pathToFileURL(join(REPO_ROOT, "opencode", "plugins", "workspace-inspector.js")).href,
    ],
  }, null, 2) + "\n")

  const agentNames = ["build", "plan", "sisyphus", "hephaestus", "sisyphus-junior", "OpenCode-Builder", "prometheus", "metis", "momus", "oracle", "librarian", "explore", "multimodal-looker", "atlas"]
  const categoryNames = ["visual-engineering", "ultrabrain", "deep", "artistry", "quick", "unspecified-low", "unspecified-high", "writing", "lane-e2e"]
  const onlyModel = { models: [model], fallback_models: [], reasoning: "high" }
  await write(join(home, ".omo", "omo.jsonc"), JSON.stringify({
    "[opencode]": {
      auto_update: false,
      telemetry: false,
      model_fallback: false,
      runtime_fallback: false,
      disabled_providers: ["anthropic", "google", "openrouter", "opencode-go", "deepseek", "kimi", "glm", "qwen", "minimax"],
      background_task: { modelConcurrency: { [model]: 2 } },
      agents: Object.fromEntries(agentNames.map((name) => [name, onlyModel])),
      categories: Object.fromEntries(categoryNames.map((name) => [name, {
        ...onlyModel,
        description: name === "lane-e2e" ? "Disposable Executor lane E2E implementation worker" : undefined,
        tools: name === "lane-e2e" ? { bash: true, edit: false, write: false, task: false } : undefined,
      }])),
    },
  }, null, 2) + "\n")
  return {
    runtimeRoot,
    configPath: join(configDir, "opencode.json"),
    omoConfigPath: join(home, ".omo", "omo.jsonc"),
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
      EXECUTOR_CANONICAL_PROMPT_SHA256: createHash("sha256").update(executorPrompt).digest("hex"),
      EXECUTOR_LANE_E2E_PORT: String(barrier.port),
      EXECUTOR_LANE_E2E_TOKEN: barrier.token,
    },
  }
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "")
}

async function preflight(runtime, fixture, model, omoPackageRoot) {
  const canonicalStatus = await gitValue(REPO_ROOT, "status", "--short")
  if (canonicalStatus) throw new Error("canonical repository must be clean before runtime preflight")
  const omoHead = await gitValue(omoPackageRoot, "rev-parse", "HEAD")
  if (omoHead !== EXPECTED_OMO_HEAD) throw new Error(`measured OMO HEAD mismatch: ${omoHead}`)
  const omoStatus = await gitValue(omoPackageRoot, "status", "--short")
  if (omoStatus) throw new Error("measured OMO integration must be clean before runtime preflight")
  if (!existsSync(join(omoPackageRoot, "dist", "index.js"))) throw new Error("measured OMO dist/index.js is missing")
  if (!ALLOWED_MODELS.has(model)) throw new Error(`model is not allowed: ${model}`)
  const openCode = await runCommand("opencode", ["--version"], { env: runtime.env })
  if (openCode.code !== 0) throw new Error(openCode.stderr)
  const capabilityEvidence = runtimeCapabilityEvidence(openCode.stdout.trim(), omoHead)
  const capability = assessLaneRuntimeCapability(capabilityEvidence)
  if (!capability.available || capability.status !== STATUS.PROVEN) throw new Error(`canonical capability gate failed: ${capability.reason}`)
  const omoConfig = parseJson(await readFile(runtime.omoConfigPath, "utf8"))["[opencode]"]
  if (omoConfig.model_fallback !== false || omoConfig.runtime_fallback !== false) throw new Error("OMO fallbacks are not disabled")

  const agents = {}
  for (const role of ROLE_NAMES) {
    const result = await runCommand("opencode", ["debug", "agent", role], { cwd: fixture.fixture, env: runtime.env, timeout: 120_000 })
    if (result.code !== 0) throw new Error(`agent preflight failed for ${role}: ${result.stderr}`)
    const config = parseJson(stripAnsi(result.stdout))
    const reasoning = config?.variant ?? (role === "Sisyphus-Junior" ? omoConfig.agents?.["sisyphus-junior"]?.reasoning : undefined)
    if (config?.model?.providerID !== "openai" || `openai/${config?.model?.modelID}` !== model || reasoning !== "high") {
      throw new Error(`effective route for ${role} is not ${model}/high: ${JSON.stringify({ model: config?.model, variant: config?.variant, reasoningEffort: config?.reasoningEffort })}`)
    }
    agents[role] = { provider: config.model.providerID, model: config.model.modelID, reasoning, reasoningSource: config?.variant ? "effective-agent" : "isolated-OMO-agent-and-category" }
  }
  const executorAlias = await runCommand("opencode", ["debug", "agent", "executor"], { cwd: fixture.fixture, env: runtime.env, timeout: 120_000 })
  const executorAliasConfig = parseJson(stripAnsi(executorAlias.stdout))
  const aliasPromptSha256 = createHash("sha256").update(executorAliasConfig?.prompt ?? "").digest("hex")
  if (executorAlias.code !== 0 || aliasPromptSha256 !== runtime.env.EXECUTOR_CANONICAL_PROMPT_SHA256) {
    throw new Error("probe-local Executor CLI alias does not match the canonical prompt")
  }
  const models = await runCommand("opencode", ["models"], { cwd: fixture.fixture, env: runtime.env, timeout: 120_000 })
  if (models.code !== 0 || !models.stdout.split(/\s+/).includes(model)) throw new Error(`allowed model is unavailable: ${models.stderr}`)
  const openSpec = await runCommand("openspec", ["validate", "executor-lane-e2e", "--strict", "--no-interactive"], { cwd: fixture.fixture, env: runtime.env, timeout: 120_000 })
  if (openSpec.code !== 0) throw new Error(`fixture OpenSpec validation failed: ${openSpec.stderr || openSpec.stdout}`)
  const config = parseJson(await readFile(runtime.configPath, "utf8"))
  const approval = config.agent.Executor.permission.bash
  if (approval["*"] !== "ask" || Object.values(approval).some((value) => !["ask", "allow"].includes(value))) {
    throw new Error("probe-local Bash policy did not preserve ask-by-default")
  }
  return {
    completedAt: Date.now(),
    noLlmCalls: true,
    canonicalStatus,
    omoStatus,
    openSpecValidation: stripAnsi(openSpec.stdout).trim(),
    isolated: { home: runtime.env.HOME, data: runtime.env.XDG_DATA_HOME, config: runtime.env.XDG_CONFIG_HOME, state: runtime.env.XDG_STATE_HOME, cache: runtime.env.XDG_CACHE_HOME },
    pluginPath: join(omoPackageRoot, "dist", "index.js"),
    omoHead,
    openCodeVersion: openCode.stdout.trim(),
    model,
    agents,
    executorCliAlias: { name: "executor", promptSha256: aliasPromptSha256, canonicalPromptSha256: runtime.env.EXECUTOR_CANONICAL_PROMPT_SHA256, matchesCanonical: true },
    fallback: { model: false, runtime: false },
    capabilityEvidence,
    capability,
    approval: { default: "ask", allowedCommands: Object.keys(approval).filter((key) => key !== "*") },
    fixture: { root: fixture.root, canonical: fixture.fixture, head: fixture.head, commonDir: fixture.commonDir, lanes: fixture.lanes, branches: fixture.branches },
  }
}

function executePrompt(fixture, preflightResult) {
  const lane = (id) => `${id}: branch=${fixture.branches[id]}, path=${fixture.lanes[id]}`
  return `executor-lane-e2e

This is an authorized disposable runtime E2E. Follow the production Executor lifecycle exactly. The harness already applied the canonical capability helper to the isolated measured runtime and obtained this result: ${JSON.stringify(preflightResult.capability)}.

Use the current canonical fixture as the change worktree. Freshly dispatch Plan Reviewer. Then execute tasks.md exactly as written.

For wave 1 create these exact lanes from baseline ${fixture.head} using the exact unquoted git worktree commands allowed by the probe-local ask-by-default policy:
${lane("T1")}
${lane("T2")}

Launch T1 and T2 in the SAME assistant tool-call batch through normal OMO task(category="lane-e2e", load_skills=[], run_in_background=true, directory=<exact lane path>). Each worker must execute exactly its tasks.md Worker command in one bash call, with no cd and no workdir override, and no other tool.

After both workers complete, do not change tasks.md yet. Inspect each lane, run its focused check, and dispatch a fresh Reviewer with directory set to that lane and its actual base/diff/test evidence. QA is not applicable because these are mechanical internal text fixtures. After [APPROVED], commit only the lane source file: use exactly git add src/a.txt then git commit -m 'T1: add A' in T1, and exactly git add src/b.txt then git commit -m 'T2: add B' in T2.

Integrate in canonical task order T1 then T2 with exact git merge --no-ff --no-edit commands. Run node scripts/check-wave.mjs. Only after it passes, edit T1 and T2 checkboxes. Recompute readiness. Dispatch T3 through normal task(category="lane-e2e", load_skills=[], run_in_background=false, directory=${JSON.stringify(fixture.fixture)}). Its only tool call must be node scripts/t3-worker.mjs with no cd/workdir override. Review its actual diff, run node scripts/check-final.mjs, then mark T3 complete.

For each lane, classify only active-session .omo/run-continuation markers as known bookkeeping. Remove only exact recognized marker files, then run normal git worktree remove and git branch -d. Never force. End with a concise status; do not invoke /verify or /ship.`
}

async function spawnRuntime(fixture, runtime, prompt) {
  return new Promise((resolvePromise) => {
    const child = spawn("opencode", ["run", "--dir", fixture.fixture, "--agent", "Executor", "--format", "json", "--model", DEFAULT_MODEL, "--variant", "high", "--command", "execute", prompt], {
      cwd: fixture.fixture,
      env: runtime.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    const timer = setTimeout(() => child.kill("SIGTERM"), RUNTIME_TIMEOUT_MS)
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      resolvePromise({ code, signal, stdout, stderr })
    })
  })
}

async function monitorRuntime(fixture, barrier, promise) {
  const snapshots = { before: taskState(await readFile(fixture.tasksPath, "utf8")) }
  const observations = { laneFiles: {}, canonicalBeforeIntegration: null, lanesCreated: { T1: false, T2: false } }
  let settled = false
  let result
  promise.then((value) => { settled = true; result = value })
  while (!settled) {
    const tasks = taskState(await readFile(fixture.tasksPath, "utf8"))
    const laneA = existsSync(join(fixture.lanes.T1, "src", "a.txt"))
    const laneB = existsSync(join(fixture.lanes.T2, "src", "b.txt"))
    const canonicalA = existsSync(join(fixture.fixture, "src", "a.txt"))
    const canonicalB = existsSync(join(fixture.fixture, "src", "b.txt"))
    for (const id of ["T1", "T2"]) {
      if (existsSync(join(fixture.lanes[id], ".git"))) observations.lanesCreated[id] = true
    }
    if (laneA && laneB && !snapshots.afterWorkers) {
      snapshots.afterWorkers = tasks
      observations.canonicalBeforeIntegration = { T1: canonicalA, T2: canonicalB }
      observations.laneFiles = {
        T1: { T1: laneA, T2: existsSync(join(fixture.lanes.T1, "src", "b.txt")) },
        T2: { T1: existsSync(join(fixture.lanes.T2, "src", "a.txt")), T2: laneB },
      }
    }
    if (canonicalA && canonicalB && !snapshots.afterIntegration) snapshots.afterIntegration = tasks
    if (tasks.T1 && tasks.T2 && !snapshots.afterCombined) snapshots.afterCombined = tasks
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  return { result, snapshots, observations, events: barrier.events }
}

function rows(db, sql, ...params) {
  return db.prepare(sql).all(...params)
}

function sessionAgent(db, id) {
  return rows(db, "SELECT data FROM message WHERE session_id = ? ORDER BY time_created", id)
    .map((row) => parseJson(row.data)).findLast((message) => message?.agent)?.agent
}

function sessionText(db, id) {
  return rows(db, "SELECT data FROM part WHERE session_id = ? ORDER BY time_created, id", id)
    .map((row) => parseJson(row.data)).filter((part) => part?.type === "text").map((part) => part.text).join("\n")
}

function finalVerdict(text, accepted, rejected) {
  const approvedAt = text.lastIndexOf(accepted)
  const rejectedAt = text.lastIndexOf(rejected)
  if (approvedAt < 0 && rejectedAt < 0) return undefined
  return approvedAt > rejectedAt ? accepted : rejected
}

function toolParts(db, id, tool) {
  return rows(db, "SELECT data FROM part WHERE session_id = ? ORDER BY time_created, id", id)
    .map((row) => parseJson(row.data)).filter((part) => part?.type === "tool" && part?.tool === tool)
}

function toolEvidence(db, id, commandPrefix) {
  const part = toolParts(db, id, "bash").find((item) => item.state?.input?.command?.startsWith(commandPrefix))
  if (!part) return null
  const state = part.state
  return {
    status: state.status,
    command: state.input?.command,
    workdir: state.input?.workdir ?? state.input?.cwd,
    start: state.time?.start,
    end: state.time?.end,
    output: state.output,
  }
}

async function collectEvidence(fixture, runtime, preflightResult, monitored) {
  const db = new DatabaseSync(runtime.dbPath, { readOnly: true })
  try {
    const sessions = rows(db, "SELECT id, parent_id, directory, title, time_created, time_updated FROM session ORDER BY time_created")
      .map((session) => ({ ...session, agent: sessionAgent(db, session.id), text: sessionText(db, session.id) }))
    const executor = sessions.find((session) => !session.parent_id && session.agent === "Executor") ?? sessions.find((session) => !session.parent_id)
    const childFor = (id) => sessions.find((session) => session.parent_id === executor?.id && session.directory === fixture.lanes[id] && session.agent === "Sisyphus-Junior")
    const workerSessions = { T1: childFor("T1"), T2: childFor("T2") }
    const taskCalls = executor ? toolParts(db, executor.id, "task").map((part) => part.state?.input).filter(Boolean) : []
    const event = (type, id) => monitored.events.find((entry) => entry.type === type && (!id || entry.task === id))
    const workers = {}
    for (const id of ["T1", "T2"]) {
      const session = workerSessions[id]
      const call = taskCalls.find((input) => input.directory === fixture.lanes[id] && input.category === "lane-e2e")
      const tool = session ? toolEvidence(db, session.id, `node scripts/lane-worker.mjs ${id}`) : null
      const measured = event("worker-finish", id)?.evidence ?? event("worker-start", id)?.evidence
      workers[id] = session && tool ? {
        sessionID: session.id,
        parentSessionID: session.parent_id,
        requestedDirectory: call?.directory,
        storedDirectory: session.directory,
        tool: { ...tool, start: measured?.start ?? tool.start, end: measured?.end ?? tool.end, evidence: measured },
      } : null
    }
    const reviewers = sessions.filter((session) => session.agent === "Reviewer")
    const planReviewer = sessions.find((session) => session.agent === "Plan Reviewer")
    const t3Event = event("t3-finish")?.evidence ?? event("t3-start")?.evidence
    const t3Session = sessions.find((session) => session.parent_id === executor?.id && session.directory === fixture.fixture && session.agent === "Sisyphus-Junior" && toolEvidence(db, session.id, "node scripts/t3-worker.mjs"))
    const t3Tool = t3Session ? toolEvidence(db, t3Session.id, "node scripts/t3-worker.mjs") : null
    const logText = existsSync(runtime.logPath) ? await readFile(runtime.logPath, "utf8") : ""
    const sessionAgents = new Map(sessions.map((session) => [session.id, session.agent]))
    const modelRequests = collectModelRequests(db, logText, (agent) => agent).map((request) => ({
      ...request,
      agent: request.agent === "title" ? "title" : (sessionAgents.get(request.session) ?? request.agent),
      purpose: request.agent === "title" ? "title/helper" : (sessionAgents.get(request.session) ?? request.agent),
    }))
    const markers = [
      ...(await markerEvidence(fixture.fixture)),
      ...(existsSync(fixture.lanes.T1) ? await markerEvidence(fixture.lanes.T1) : []),
      ...(existsSync(fixture.lanes.T2) ? await markerEvidence(fixture.lanes.T2) : []),
    ]
    const bookkeeping = classifyOmoRuntimeBookkeeping({ markers, sessions })
    const worktrees = await gitValue(fixture.fixture, "worktree", "list", "--porcelain")
    const branches = await gitValue(fixture.fixture, "branch", "--format=%(refname:short)")
    const unmergedPaths = (await gitValue(fixture.fixture, "diff", "--name-only", "--diff-filter=U"))
      .split("\n").filter(Boolean)
    const log = await gitValue(fixture.fixture, "log", "--format=%H%x09%P%x09%s", "--all")
    const commits = {}
    for (const id of ["T1", "T2"]) {
      const line = log.split("\n").find((entry) => entry.endsWith(`\t${id}: add ${id === "T1" ? "A" : "B"}`))
      commits[id] = line ? { sha: line.split("\t")[0], branch: fixture.branches[id], subject: line.split("\t")[2] } : null
    }
    const mergeLines = log.split("\n").filter((line) => line.includes("Merge branch 'fixture-change--lane-T"))
    const mergeFor = (id) => mergeLines.find((line) => line.includes(fixture.branches[id]))
    const waveCheck = event("wave-check")
    const finalTasks = taskState(await readFile(fixture.tasksPath, "utf8"))
    const laneValidation = {}
    for (const id of ["T1", "T2"]) {
      const reviewer = reviewers.find((session) => session.directory === fixture.lanes[id])
      laneValidation[id] = {
        focusedChecksPassed: executor ? toolParts(db, executor.id, "bash").some((part) => part.state?.input?.command === `node scripts/check-task.mjs ${id}` && part.state?.status === "completed") : false,
        reviewerSession: reviewer?.id,
        reviewerVerdict: reviewer ? finalVerdict(reviewer.text, "[APPROVED]", "[CHANGES_REQUIRED]") : undefined,
        integrationReady: Boolean(commits[id]),
        qa: "NOT_APPLICABLE_MECHANICAL_INTERNAL_FIXTURE",
      }
    }
    const evidence = {
      schemaVersion: 1,
      probeID: basename(fixture.root),
      createdAt: new Date().toISOString(),
      preflight: preflightResult,
      route: { command: "/execute", agent: executor?.agent, executorPromptMatchesCanonical: preflightResult.executorCliAlias?.matchesCanonical === true, executorSession: executor?.id, planReviewSession: planReviewer?.id, planReview: planReviewer ? finalVerdict(planReviewer.text, "[APPROVED]", "[REJECTED]") : undefined },
      capabilityGate: preflightResult.capability,
      sessionTopology: sessions.map(({ text, ...session }) => session),
      lanes: {
        T1: { linked: monitored.observations.lanesCreated.T1, owned: true, path: fixture.lanes.T1, branch: fixture.branches.T1, baseSha: fixture.head, commonDir: fixture.commonDir },
        T2: { linked: monitored.observations.lanesCreated.T2, owned: true, path: fixture.lanes.T2, branch: fixture.branches.T2, baseSha: fixture.head, commonDir: fixture.commonDir },
      },
      workers,
      mutationConfinement: {
        canonical: monitored.observations.canonicalBeforeIntegration ?? { T1: undefined, T2: undefined },
        ...monitored.observations.laneFiles,
        contradiction: monitored.observations.canonicalBeforeIntegration?.T1 === true || monitored.observations.canonicalBeforeIntegration?.T2 === true || monitored.observations.laneFiles?.T1?.T2 === true || monitored.observations.laneFiles?.T2?.T1 === true,
      },
      bookkeeping: {
        policyStatus: bookkeeping.policyStatus,
        literalCleanliness: bookkeeping.literalCleanliness,
        markers,
        known: bookkeeping.classifications.filter((entry) => entry.kind === "KNOWN_OMO_RUNTIME_BOOKKEEPING"),
        unknown: bookkeeping.classifications.filter((entry) => entry.kind === "UNKNOWN_MUTATION"),
      },
      laneValidation,
      commits,
      integration: {
        strategy: "MERGE_NO_FF",
        order: mergeLines.slice().reverse().map((line) => line.includes("T1") ? "T1" : "T2"),
        results: ["T1", "T2"].map((id) => ({ taskID: id, integrated: Boolean(mergeFor(id)), mergeSha: mergeFor(id)?.split("\t")[0] })),
        conflict: unmergedPaths.length > 0,
        unmergedPaths,
      },
      combinedChecks: { passed: waveCheck?.passed, completedAt: waveCheck?.at },
      taskSnapshots: { ...monitored.snapshots, final: finalTasks },
      T3: t3Session && t3Tool ? { sessionID: t3Session.id, workspaceMode: "CHANGE_WORKTREE", start: t3Event?.start, end: t3Event?.end, actualCwd: t3Event?.pwd, observedT1: t3Event?.observedT1, observedT2: t3Event?.observedT2, completed: t3Event?.completed } : null,
      cleanup: {
        T1: { owned: true, worktreeRemoved: monitored.observations.lanesCreated.T1 && !worktrees.includes(fixture.lanes.T1), branchDeleted: monitored.observations.lanesCreated.T1 && !branches.split("\n").includes(fixture.branches.T1) },
        T2: { owned: true, worktreeRemoved: monitored.observations.lanesCreated.T2 && !worktrees.includes(fixture.lanes.T2), branchDeleted: monitored.observations.lanesCreated.T2 && !branches.split("\n").includes(fixture.branches.T2) },
        remainingWorktrees: worktrees,
        remainingBranches: branches,
      },
      modelRequests,
      execution: {
        exitCode: monitored.result.code,
        signal: monitored.result.signal,
        usageLimitReached: /usage limit has been reached/i.test(monitored.result.stderr + monitored.result.stdout),
      },
      cli: monitored.result,
      barrierEvents: monitored.events,
    }
    evidence.classification = classifyExecutorLaneE2E(evidence)
    return evidence
  } finally {
    db.close()
  }
}

export async function runExecutorLaneProbe(options) {
  if (!options.omoPackageRoot || !options.evidenceDir) throw new Error("--omo-package-root and --evidence-dir are required")
  if (!ALLOWED_MODELS.has(options.model)) throw new Error(`only ${[...ALLOWED_MODELS].join(" or ")} is allowed`)
  await mkdir(options.evidenceDir, { recursive: true })
  const root = join(options.evidenceDir, `${PROBE_PREFIX}${Date.now()}-${crypto.randomUUID().slice(0, 8)}`)
  await mkdir(root)
  const barrier = await createBarrier()
  try {
    const fixture = await createFixture(root, barrier.port, barrier.token)
    const runtime = await setupRuntime(fixture, options.omoPackageRoot, options.model, barrier)
    const preflightResult = await preflight(runtime, fixture, options.model, options.omoPackageRoot)
    await write(join(root, "preflight.json"), JSON.stringify(preflightResult, null, 2) + "\n")
    if (options.preflightOnly) return { mode: "preflight-only", root, preflight: preflightResult }
    const runtimePromise = spawnRuntime(fixture, runtime, executePrompt(fixture, preflightResult))
    const monitored = await monitorRuntime(fixture, barrier, runtimePromise)
    const evidence = await collectEvidence(fixture, runtime, preflightResult, monitored)
    await write(join(root, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n")
    return { mode: "run", root, evidence }
  } finally {
    await new Promise((resolvePromise) => barrier.server.close(resolvePromise))
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help || (!options.run && !options.preflightOnly)) {
      console.log(usage())
    } else {
      const result = await runExecutorLaneProbe(options)
      console.log(JSON.stringify(result, null, 2))
      if (result.evidence && result.evidence.classification.status !== STATUS.PROVEN) process.exitCode = 2
    }
  } catch (error) {
    console.error(error.stack ?? error.message)
    process.exitCode = 1
  }
}
