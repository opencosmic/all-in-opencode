#!/usr/bin/env node

import { execFile } from "node:child_process"
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { homedir, platform, release, tmpdir } from "node:os"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { createHash, randomUUID } from "node:crypto"

const execFileAsync = promisify(execFile)

export const STATUS = Object.freeze({
  PROVEN: "PROVEN",
  FAILED: "FAILED",
  UNPROVEN: "UNPROVEN",
})

export const VERDICTS = Object.freeze({
  PROVEN: "WORKTREE_ISOLATION_CAPABILITY_PROVEN",
  PARTIAL: "PARTIAL_ISOLATION",
  PROMPT_ONLY: "PROMPT_ONLY_ISOLATION",
  UNAVAILABLE: "CALLER_SELECTED_CWD_UNAVAILABLE",
  UNPROVEN: "UNPROVEN",
})

export const PROBE_PREFIX = "opencode-workflow-cwd-probe-"
export const PROVENANCE_FILE = ".opencode-workflow-probe-owner.json"
const PROVENANCE_KIND = "opencode-workflow-child-cwd-probe"

async function command(commandName, args, options = {}) {
  const { stdout = "", stderr = "" } = await execFileAsync(commandName, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    env: options.env,
  })
  return { stdout: stdout.trim(), stderr: stderr.trim() }
}

async function git(cwd, ...args) {
  return command("git", args, { cwd })
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function canonical(path) {
  return realpath(path)
}

function isInside(parent, candidate) {
  const rel = relative(parent, candidate)
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel)
}

function interfaceBody(source, interfaceName) {
  const match = source.match(new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)^\\}`, "m"))
  return match?.[1] ?? null
}

function hasOwnField(interfaceSource, field) {
  return new RegExp(`^\\s*${field}\\??:`, "m").test(interfaceSource ?? "")
}

export function inspectNormalTaskSource({ delegateTypes, backgroundTypes, bundleSource }) {
  const delegateArgs = interfaceBody(delegateTypes, "DelegateTaskArgs")
  const launchInput = interfaceBody(backgroundTypes, "LaunchInput")
  const syncBlock = bundleSource.match(
    /function createSyncSession\([\s\S]*?\/\/ packages\/omo-opencode\/src\/tools\/delegate-task\/sync-prompt-sender\.ts/,
  )?.[0]
  const backgroundBlock = bundleSource.match(
    /async startTask\(item\) \{[\s\S]*?await input\.onSessionCreated\?\.\(sessionID\);/,
  )?.[0]

  const delegateTaskAcceptsCwd = hasOwnField(delegateArgs, "cwd") || hasOwnField(delegateArgs, "directory")
  const launchInputAcceptsCwd = hasOwnField(launchInput, "cwd") || hasOwnField(launchInput, "directory")
  const syncInheritsParent =
    Boolean(syncBlock) &&
    /const parentDirectory = parentSession\?\.data\?\.directory \?\? input\.defaultDirectory/.test(syncBlock) &&
    /query:\s*\{\s*directory: parentDirectory\s*\}/.test(syncBlock)
  const backgroundInheritsParent =
    Boolean(backgroundBlock) &&
    /const parentDirectory = parentSession\?\.data\?\.directory \?\? this\.directory/.test(backgroundBlock) &&
    /query:\s*\{\s*directory: parentDirectory\s*\}/.test(backgroundBlock)

  const decisive =
    delegateArgs !== null &&
    launchInput !== null &&
    syncBlock !== undefined &&
    backgroundBlock !== undefined &&
    !delegateTaskAcceptsCwd &&
    !launchInputAcceptsCwd &&
    syncInheritsParent &&
    backgroundInheritsParent

  return {
    delegateTaskAcceptsCwd,
    launchInputAcceptsCwd,
    syncInheritsParent,
    backgroundInheritsParent,
    status: decisive ? STATUS.FAILED : STATUS.UNPROVEN,
    mechanism: decisive
      ? "normal OMO task/category children inherit the parent session directory; no caller cwd field is exposed"
      : "installed source did not provide complete evidence for a caller-selectable normal-task cwd",
  }
}

export function inspectTeamModeSource(bundleSource) {
  const memberSchemaHasWorktreePath =
    /MemberBaseSchema = [\s\S]*?worktreePath:\s*z\w*\.string\(\)\.optional\(\)/.test(bundleSource)
  const createsDirectoryOnly =
    /async function createMemberWorktree[\s\S]*?mkdir\w*\(absolutePath, \{ recursive: true \}\)[\s\S]*?return absolutePath/.test(
      bundleSource,
    )
  const launchesViaBackgroundManager =
    /const task\w* = await bgMgr\.launch\(\{[\s\S]*?prompt: buildMemberPrompt[\s\S]*?onSessionCreated:/.test(
      bundleSource,
    )
  const promptCarriesWorktree =
    /if \(worktreePath\)\s*promptLines\.push\(`Worktree: \$\{worktreePath\}`\)/.test(bundleSource)

  return {
    memberSchemaHasWorktreePath,
    createsDirectoryOnly,
    launchesViaBackgroundManager,
    promptCarriesWorktree,
    normalTaskEquivalentBindingProven: false,
    status:
      memberSchemaHasWorktreePath && createsDirectoryOnly && launchesViaBackgroundManager && promptCarriesWorktree
        ? STATUS.FAILED
        : STATUS.UNPROVEN,
    mechanism:
      memberSchemaHasWorktreePath && createsDirectoryOnly && launchesViaBackgroundManager && promptCarriesWorktree
        ? "Team Mode creates/records a worktree path and prompts the member, but launches through the parent-directory background manager"
        : "installed Team Mode source was incomplete or unrecognized",
  }
}

export function inspectOpenCodeSessionApiSource(typesSource) {
  const createBlock = typesSource.match(
    /export type SessionCreateData = \{[\s\S]*?export type SessionCreateErrors = \{/,
  )?.[0]
  const acceptsDirectoryQuery =
    Boolean(createBlock) && /query\?: \{[\s\S]*?directory\?: string;[\s\S]*?\};/.test(createBlock)
  return {
    acceptsDirectoryQuery,
    status: acceptsDirectoryQuery ? STATUS.PROVEN : STATUS.UNPROVEN,
    mechanism: acceptsDirectoryQuery
      ? "OpenCode session creation exposes a directory query"
      : "installed OpenCode SDK types did not prove a session-creation directory query",
  }
}

export function classifyWorkerEvidence(expected, observed) {
  if (!observed) {
    return {
      child_selected_cwd: STATUS.UNPROVEN,
      child_actual_pwd: STATUS.UNPROVEN,
      git_top_level: STATUS.UNPROVEN,
      mutation_confinement: STATUS.UNPROVEN,
      nested_child_cwd_preservation: STATUS.UNPROVEN,
    }
  }

  const mechanical = observed.source === "child-tool"
  const pwdMatches = observed.actualCwd === expected.worktree
  const topMatches = observed.gitTopLevel === expected.worktree
  const branchMatches = observed.branch === expected.branch
  const sentinelMatches = observed.sentinelPath === expected.sentinelPath && observed.sentinelVerified === true
  const runtimeBound = observed.runtimeBinding === true

  const statusFor = (condition) => (condition ? STATUS.PROVEN : STATUS.FAILED)
  const nested =
    observed.nested === undefined
      ? STATUS.UNPROVEN
      : statusFor(
          observed.nested.source === "child-tool" &&
            observed.nested.actualCwd === expected.worktree &&
            observed.nested.gitTopLevel === expected.worktree,
        )

  return {
    child_selected_cwd: mechanical ? statusFor(runtimeBound && pwdMatches) : STATUS.UNPROVEN,
    child_actual_pwd: mechanical ? statusFor(pwdMatches) : STATUS.UNPROVEN,
    git_top_level: mechanical ? statusFor(topMatches && branchMatches) : STATUS.UNPROVEN,
    mutation_confinement: mechanical ? statusFor(sentinelMatches) : STATUS.UNPROVEN,
    nested_child_cwd_preservation: mechanical ? nested : STATUS.UNPROVEN,
  }
}

function combineStatuses(statuses) {
  if (statuses.includes(STATUS.FAILED)) return STATUS.FAILED
  if (statuses.every((status) => status === STATUS.PROVEN)) return STATUS.PROVEN
  return STATUS.UNPROVEN
}

export function classifyProbeEvidence({ runtimeInspection, workers, filesystem, concurrent }) {
  const workerStatuses = workers?.map(({ expected, observed }) => classifyWorkerEvidence(expected, observed)) ?? []
  const workerField = (field) =>
    workerStatuses.length === 0 ? STATUS.UNPROVEN : combineStatuses(workerStatuses.map((entry) => entry[field]))

  let callerSelected = workerField("child_selected_cwd")
  if (callerSelected === STATUS.UNPROVEN && runtimeInspection?.normalTask?.status === STATUS.FAILED) {
    callerSelected = STATUS.FAILED
  }

  const filesystemWasExercised = workers?.length > 0 && workers.every((worker) => worker.observed)
  const siblingIsolation = !filesystemWasExercised
    ? STATUS.UNPROVEN
    : filesystem?.siblingIsolated === true
      ? STATUS.PROVEN
      : STATUS.FAILED
  const parentCleanliness = !filesystemWasExercised
    ? STATUS.UNPROVEN
    : filesystem?.parentUnaffected === true
      ? STATUS.PROVEN
      : STATUS.FAILED
  const concurrentIsolation = !filesystemWasExercised
    ? STATUS.UNPROVEN
    : concurrent?.mechanicallyOverlapped === true && siblingIsolation === STATUS.PROVEN
      ? STATUS.PROVEN
      : concurrent?.attempted === true
        ? STATUS.FAILED
        : STATUS.UNPROVEN

  return {
    caller_selected_child_cwd: callerSelected,
    tool_execution_cwd: workerField("child_actual_pwd"),
    git_top_level: workerField("git_top_level"),
    mutation_confinement: workerField("mutation_confinement"),
    sibling_worktree_isolation: siblingIsolation,
    concurrent_sibling_isolation: concurrentIsolation,
    parent_worktree_cleanliness: parentCleanliness,
    nested_child_cwd_preservation: workerField("nested_child_cwd_preservation"),
  }
}

export function chooseVerdict(capabilities, options = {}) {
  if (capabilities.caller_selected_child_cwd === STATUS.FAILED) return VERDICTS.UNAVAILABLE
  if (options.promptOnly === true) return VERDICTS.PROMPT_ONLY
  if (
    capabilities.caller_selected_child_cwd === STATUS.PROVEN &&
    capabilities.tool_execution_cwd === STATUS.PROVEN &&
    capabilities.git_top_level === STATUS.PROVEN &&
    capabilities.sibling_worktree_isolation === STATUS.PROVEN &&
    capabilities.parent_worktree_cleanliness === STATUS.PROVEN &&
    capabilities.nested_child_cwd_preservation === STATUS.FAILED
  ) {
    return VERDICTS.PARTIAL
  }
  const critical = [
    "caller_selected_child_cwd",
    "tool_execution_cwd",
    "git_top_level",
    "mutation_confinement",
    "sibling_worktree_isolation",
    "concurrent_sibling_isolation",
    "parent_worktree_cleanliness",
    "nested_child_cwd_preservation",
  ]
  return critical.every((key) => capabilities[key] === STATUS.PROVEN) ? VERDICTS.PROVEN : VERDICTS.UNPROVEN
}

export async function createProbeFixture(options = {}) {
  const dataRoot = resolve(options.dataRoot ?? tmpdir())
  await mkdir(dataRoot, { recursive: true })
  const root = await mkdtemp(join(dataRoot, PROBE_PREFIX))
  const ownedRoot = await canonical(root)
  const probeId = randomUUID()
  const fixture = {
    probeId,
    root: ownedRoot,
    base: join(ownedRoot, "base"),
    worktreeA: join(ownedRoot, "worktree-a"),
    worktreeB: join(ownedRoot, "worktree-b"),
    branchA: `probe-a-${probeId.slice(0, 8)}`,
    branchB: `probe-b-${probeId.slice(0, 8)}`,
    sentinelA: "WORKER_A_SENTINEL",
    sentinelB: "WORKER_B_SENTINEL",
  }
  await writeFile(
    join(ownedRoot, PROVENANCE_FILE),
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: PROVENANCE_KIND,
        probeId,
        root: ownedRoot,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  )
  await mkdir(fixture.base)
  await git(fixture.base, "init", "-q")
  await git(fixture.base, "config", "user.email", "cwd-probe@example.invalid")
  await git(fixture.base, "config", "user.name", "CWD Probe")
  await writeFile(join(fixture.base, "README.md"), "Disposable child-CWD probe fixture.\n")
  await git(fixture.base, "add", "README.md")
  await git(fixture.base, "commit", "-qm", "probe baseline")
  await git(fixture.base, "worktree", "add", "-qb", fixture.branchA, fixture.worktreeA)
  await git(fixture.base, "worktree", "add", "-qb", fixture.branchB, fixture.worktreeB)
  fixture.baseSha = (await git(fixture.base, "rev-parse", "HEAD")).stdout
  fixture.commonDir = await canonical((await git(fixture.base, "rev-parse", "--path-format=absolute", "--git-common-dir")).stdout)
  return fixture
}

export function sentinelPayload(fixture, worker) {
  return JSON.stringify({
    schemaVersion: 1,
    probeId: fixture.probeId,
    worker,
  }) + "\n"
}

async function inspectSentinel(path, expectedPayload) {
  if (!(await exists(path))) return { exists: false, valid: false, path }
  const content = await readFile(path)
  return {
    exists: true,
    valid: content.equals(Buffer.from(expectedPayload)),
    path: await canonical(path),
    sha256: createHash("sha256").update(content).digest("hex"),
  }
}

export async function inspectSentinelIsolation(fixture) {
  const paths = {
    aOwn: join(fixture.worktreeA, fixture.sentinelA),
    aCross: join(fixture.worktreeA, fixture.sentinelB),
    bOwn: join(fixture.worktreeB, fixture.sentinelB),
    bCross: join(fixture.worktreeB, fixture.sentinelA),
    baseA: join(fixture.base, fixture.sentinelA),
    baseB: join(fixture.base, fixture.sentinelB),
  }
  const [aOwn, aCross, bOwn, bCross, baseA, baseB] = await Promise.all([
    inspectSentinel(paths.aOwn, sentinelPayload(fixture, "A")),
    inspectSentinel(paths.aCross, sentinelPayload(fixture, "B")),
    inspectSentinel(paths.bOwn, sentinelPayload(fixture, "B")),
    inspectSentinel(paths.bCross, sentinelPayload(fixture, "A")),
    inspectSentinel(paths.baseA, sentinelPayload(fixture, "A")),
    inspectSentinel(paths.baseB, sentinelPayload(fixture, "B")),
  ])
  const exercised = aOwn.exists || bOwn.exists || aCross.exists || bCross.exists || baseA.exists || baseB.exists
  return {
    exercised,
    workerAValid: aOwn.valid,
    workerBValid: bOwn.valid,
    siblingIsolated: exercised && aOwn.valid && bOwn.valid && !aCross.exists && !bCross.exists,
    parentUnaffected: exercised && !baseA.exists && !baseB.exists,
    sentinels: { aOwn, aCross, bOwn, bCross, baseA, baseB },
  }
}

export async function assertOwnedProbeRoot(root) {
  const absolute = resolve(root)
  const rootStat = await stat(absolute)
  if (!rootStat.isDirectory()) throw new Error("cleanup refused: probe root is not a directory")
  const ownedRoot = await canonical(absolute)
  if (!basename(ownedRoot).startsWith(PROBE_PREFIX)) {
    throw new Error("cleanup refused: path does not have the probe prefix")
  }
  const markerPath = join(ownedRoot, PROVENANCE_FILE)
  let marker
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"))
  } catch {
    throw new Error("cleanup refused: valid provenance marker is missing")
  }
  if (marker.kind !== PROVENANCE_KIND || marker.root !== ownedRoot || typeof marker.probeId !== "string") {
    throw new Error("cleanup refused: provenance marker does not match the requested root")
  }
  return { root: ownedRoot, marker }
}

async function worktreeStatus(path) {
  return (await git(path, "status", "--porcelain=v1", "--untracked-files=all")).stdout
}

export async function cleanupProbeFixture(root) {
  const ownership = await assertOwnedProbeRoot(root)
  const expected = {
    base: join(ownership.root, "base"),
    worktreeA: join(ownership.root, "worktree-a"),
    worktreeB: join(ownership.root, "worktree-b"),
  }
  for (const path of Object.values(expected)) {
    if (!(await exists(path))) throw new Error(`cleanup refused: expected fixture path is missing: ${path}`)
    const canonicalPath = await canonical(path)
    if (!isInside(ownership.root, canonicalPath)) {
      throw new Error(`cleanup refused: fixture path escapes owned root: ${path}`)
    }
  }
  for (const [name, path] of Object.entries(expected)) {
    const dirty = await worktreeStatus(path)
    if (dirty) throw new Error(`cleanup refused: ${name} is dirty; evidence preserved at ${ownership.root}`)
  }
  const listed = (await git(expected.base, "worktree", "list", "--porcelain")).stdout
  const registeredPaths = listed
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
  const allowed = new Set(Object.values(expected))
  if (registeredPaths.length !== allowed.size || registeredPaths.some((path) => !allowed.has(path))) {
    throw new Error("cleanup refused: registered worktrees do not exactly match the owned fixture")
  }
  await git(expected.base, "worktree", "remove", expected.worktreeA)
  await git(expected.base, "worktree", "remove", expected.worktreeB)
  await rm(ownership.root, { recursive: true })
  return { removed: true, root: ownership.root }
}

async function fixtureFacts(fixture) {
  const facts = async (path) => ({
    pwd: await canonical(path),
    topLevel: await canonical((await git(path, "rev-parse", "--show-toplevel")).stdout),
    branch: (await git(path, "branch", "--show-current")).stdout,
    commonDir: await canonical((await git(path, "rev-parse", "--path-format=absolute", "--git-common-dir")).stdout),
  })
  return {
    base: await facts(fixture.base),
    worktreeA: await facts(fixture.worktreeA),
    worktreeB: await facts(fixture.worktreeB),
  }
}

async function installedRuntime(options = {}) {
  const omoPackageRoot = resolve(
    options.omoPackageRoot ??
      join(homedir(), ".cache", "opencode", "packages", "oh-my-openagent@latest", "node_modules", "oh-my-openagent"),
  )
  const [packageJson, delegateTypes, backgroundTypes, bundleSource, sdkTypes, opencodeVersion] = await Promise.all([
    readFile(join(omoPackageRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(join(omoPackageRoot, "dist", "tools", "delegate-task", "types.d.ts"), "utf8"),
    readFile(join(omoPackageRoot, "dist", "features", "background-agent", "types.d.ts"), "utf8"),
    readFile(join(omoPackageRoot, "dist", "index.js"), "utf8"),
    readFile(join(omoPackageRoot, "..", "@opencode-ai", "sdk", "dist", "v2", "gen", "types.gen.d.ts"), "utf8"),
    command("opencode", ["--version"]).then((result) => result.stdout),
  ])
  return {
    versions: {
      opencode: opencodeVersion,
      omo: packageJson.version,
      node: process.version,
      bun: await command("bun", ["--version"]).then((result) => result.stdout).catch(() => null),
      os: `${platform()} ${release()}`,
    },
    source: {
      omoPackageRoot,
      openCodeSessionApi: inspectOpenCodeSessionApiSource(sdkTypes),
      normalTask: inspectNormalTaskSource({ delegateTypes, backgroundTypes, bundleSource }),
      teamMode: inspectTeamModeSource(bundleSource),
    },
  }
}

function parseArgs(argv) {
  const options = { keep: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--keep") options.keep = true
    else if (arg === "--data-root") options.dataRoot = argv[++index]
    else if (arg === "--omo-package-root") options.omoPackageRoot = argv[++index]
    else if (arg === "--help") options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function usage() {
  return `Usage: node scripts/probes/worktree-isolation.mjs [--keep] [--data-root PATH] [--omo-package-root PATH]

Inspects the installed OpenCode/OMO normal category-worker CWD mechanism and
constructs a disposable base/worktree-a/worktree-b fixture. It makes no LLM call.
Use --keep to preserve the clean fixture for adapter development.`
}

export async function runProbe(options = {}) {
  const fixture = await createProbeFixture({ dataRoot: options.dataRoot })
  let cleanup = { removed: false, root: fixture.root }
  try {
    const runtime = await installedRuntime({ omoPackageRoot: options.omoPackageRoot })
    const facts = await fixtureFacts(fixture)
    const initialSentinelState = await inspectSentinelIsolation(fixture)
    const runtimeInspection = {
      normalTask: runtime.source.normalTask,
      teamMode: runtime.source.teamMode,
    }
    const capabilities = classifyProbeEvidence({ runtimeInspection })
    const result = {
      schemaVersion: 1,
      verdict: chooseVerdict(capabilities),
      runtime: runtime.versions,
      mechanism: {
        openCodeSessionApi: runtime.source.openCodeSessionApi,
        normalTask: runtime.source.normalTask,
        teamMode: runtime.source.teamMode,
      },
      capabilities,
      fixture: {
        root: fixture.root,
        baseSha: fixture.baseSha,
        commonDir: fixture.commonDir,
        facts,
        initialSentinelState,
        workersInvoked: false,
        note: "Topology was validated mechanically; no child was invoked because caller-selected normal-task CWD is unavailable.",
      },
      modelProviderCompliance: {
        llmRuntimeProbeInvoked: false,
        modelsUsed: [],
        reason: "Installed source was decisive; configured fallback chains are not OpenAI-only.",
      },
      cleanup,
    }
    if (!options.keep) {
      cleanup = await cleanupProbeFixture(fixture.root)
      result.cleanup = cleanup
      result.fixture.root = null
      result.fixture.commonDir = null
    }
    return result
  } catch (error) {
    if (!options.keep) {
      try {
        cleanup = await cleanupProbeFixture(fixture.root)
      } catch {
        // Preserve evidence when conservative cleanup refuses.
      }
    }
    error.probeRoot = fixture.root
    throw error
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(usage() + "\n")
    } else {
      process.stdout.write(JSON.stringify(await runProbe(options), null, 2) + "\n")
    }
  } catch (error) {
    const output = {
      schemaVersion: 1,
      verdict: VERDICTS.UNPROVEN,
      error: error instanceof Error ? error.message : String(error),
      probeRoot: error?.probeRoot ?? null,
    }
    process.stderr.write(JSON.stringify(output, null, 2) + "\n")
    process.exitCode = 1
  }
}
