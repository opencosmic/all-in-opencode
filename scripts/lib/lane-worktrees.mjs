import { isAbsolute, relative, resolve } from "node:path"
import { realpathSync } from "node:fs"

import { STATUS } from "../probes/worktree-isolation.mjs"

// Pure policy helpers only: callers own Git/OMO execution and keep provenance
// transient. This module never creates a worktree or writes workflow state.

export const EXECUTION_MODE = Object.freeze({
  IN_PLACE: "IN_PLACE",
  CHANGE_WORKTREE: "CHANGE_WORKTREE",
  LANE_WORKTREES: "LANE_WORKTREES",
  EPHEMERAL_SANDBOX: "EPHEMERAL_SANDBOX",
})

export const LANE_DECISION = Object.freeze({
  PERMITTED: "PERMITTED",
  FALLBACK: "FALLBACK",
  BLOCKED: "BLOCKED",
  PRESERVE: "PRESERVE",
})

export const REQUIRED_RUNTIME_CAPABILITIES = Object.freeze([
  "callerSelectedDirectory",
  "syncActiveToolCompletion",
  "backgroundActiveToolCompletion",
  "syncActualToolCwd",
  "backgroundActualToolCwd",
  "singleWorkerMutationConfinement",
  "concurrentDirectoryAssignment",
  "concurrentToolIsolation",
  "temporalOverlap",
  "siblingMutationConfinement",
  "parentWorkerMutationConfinement",
  "nestedRuntimePreservation",
  "runtimeBookkeepingPolicy",
])

const SHARED_SURFACES = Object.freeze([
  "contracts",
  "schemas",
  "migrations",
  "packageLocks",
  "generatedFiles",
  "mutableState",
  "ports",
  "externalServices",
  "testFixtures",
])

function array(value) {
  return Array.isArray(value) ? value : []
}

function normalizedPath(path) {
  return String(path).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "")
}

function comparableAbsolutePath(path) {
  const absolute = resolve(path)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

function pathsOverlap(left, right) {
  const a = normalizedPath(left)
  const b = normalizedPath(right)
  if (!a || !b) return true
  const aRoot = a.includes("*") ? a.slice(0, a.indexOf("*")).replace(/\/$/, "") : a
  const bRoot = b.includes("*") ? b.slice(0, b.indexOf("*")).replace(/\/$/, "") : b
  if (!aRoot || !bRoot) return true
  return aRoot === bRoot || aRoot.startsWith(`${bRoot}/`) || bRoot.startsWith(`${aRoot}/`)
}

function valuesOverlap(left, right) {
  return array(left).some((a) => array(right).some((b) => pathsOverlap(a, b)))
}

function pathWithinScope(path, scope) {
  const candidate = normalizedPath(path)
  const allowed = normalizedPath(scope)
  if (!candidate || !allowed) return false
  if (allowed.includes("*")) {
    const root = allowed.slice(0, allowed.indexOf("*")).replace(/\/$/, "")
    if (!root) return true
    return candidate === root || candidate.startsWith(`${root}/`)
  }
  return candidate === allowed || candidate.startsWith(`${allowed}/`)
}

function taskOrder(task, index) {
  return Number.isFinite(task.order) ? task.order : index
}

function safeToken(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error("lane token is required")
  }
  const token = String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  if (!token) throw new Error("lane token must contain a safe character")
  return token
}

export function assessLaneRuntimeCapability(evidence) {
  if (!evidence || evidence.adoptedForExecution !== true) {
    return {
      available: false,
      status: STATUS.UNPROVEN,
      reason: "no exact runtime capability evidence has been adopted for this execution",
    }
  }
  if (evidence.source !== "mechanical-runtime-evidence" || !evidence.runtimeIdentity) {
    return {
      available: false,
      status: STATUS.UNPROVEN,
      reason: "runtime identity and mechanical evidence source are required",
    }
  }
  const missing = REQUIRED_RUNTIME_CAPABILITIES.filter((name) => evidence.capabilities?.[name] !== STATUS.PROVEN)
  if (missing.length > 0) {
    return {
      available: false,
      status: evidence.capabilities && missing.some((name) => evidence.capabilities[name] === STATUS.FAILED)
        ? STATUS.FAILED
        : STATUS.UNPROVEN,
      reason: `required runtime capabilities are not proven: ${missing.join(", ")}`,
      missing,
    }
  }
  return {
    available: true,
    status: STATUS.PROVEN,
    runtimeIdentity: evidence.runtimeIdentity,
  }
}

export function compareLaneTasks(left, right) {
  const reasons = []
  if (array(left.dependencies).includes(right.id) || array(right.dependencies).includes(left.id)) {
    reasons.push("dependency edge")
  }
  if (valuesOverlap(left.writeScopes, right.writeScopes)) reasons.push("write-scope overlap")
  for (const surface of SHARED_SURFACES) {
    if (valuesOverlap(left.shared?.[surface], right.shared?.[surface])) reasons.push(`shared ${surface}`)
  }
  if (left.independenceAmbiguous || right.independenceAmbiguous) reasons.push("ambiguous independence")
  return { independent: reasons.length === 0, reasons }
}

export function selectLaneWave({ tasks, runtimeEvidence }) {
  const ordered = array(tasks)
    .map((task, index) => ({ ...task, _order: taskOrder(task, index) }))
    .sort((a, b) => a._order - b._order || String(a.id).localeCompare(String(b.id)))
  const completed = new Set(ordered.filter((task) => task.checked === true).map((task) => task.id))
  const ready = ordered.filter((task) =>
    task.checked !== true && array(task.dependencies).every((dependency) => completed.has(dependency)),
  )
  const runtime = assessLaneRuntimeCapability(runtimeEvidence)
  if (!runtime.available) {
    return {
      mode: EXECUTION_MODE.CHANGE_WORKTREE,
      decision: LANE_DECISION.FALLBACK,
      reason: runtime.reason,
      ready,
      laneTasks: [],
      serializedTasks: ready,
      runtime,
    }
  }
  if (ready.length < 2) {
    return {
      mode: EXECUTION_MODE.CHANGE_WORKTREE,
      decision: LANE_DECISION.FALLBACK,
      reason: "fewer than two dependency-ready tasks",
      ready,
      laneTasks: [],
      serializedTasks: ready,
      runtime,
    }
  }

  const candidates = ready.filter((task) =>
    task.parallel === "SAFE_TO_PARALLELIZE" && task.laneIsolationEligible === true,
  )
  const laneTasks = []
  const serializedTasks = ready.filter((task) => !candidates.includes(task))
  for (const candidate of candidates) {
    const conflict = laneTasks.find((accepted) => !compareLaneTasks(candidate, accepted).independent)
    if (conflict) serializedTasks.push(candidate)
    else laneTasks.push(candidate)
  }
  if (laneTasks.length < 2) {
    return {
      mode: EXECUTION_MODE.CHANGE_WORKTREE,
      decision: LANE_DECISION.FALLBACK,
      reason: "fewer than two ready tasks are independently lane eligible",
      ready,
      laneTasks: [],
      serializedTasks: ready,
      runtime,
    }
  }
  return {
    mode: EXECUTION_MODE.LANE_WORKTREES,
    decision: LANE_DECISION.PERMITTED,
    reason: "runtime contract and at least two independent ready tasks are proven",
    ready,
    laneTasks,
    serializedTasks,
    runtime,
  }
}

export function planLaneCreation({ canonical, task, executionID, laneRoot, existingBranches = [], existingWorktrees = [] }) {
  if (
    !canonical?.path ||
    !isAbsolute(canonical.path) ||
    !canonical.branch ||
    !/^[0-9a-f]{40,64}$/i.test(canonical.head ?? "") ||
    !canonical.commonDir ||
    !isAbsolute(canonical.commonDir)
  ) {
    throw new Error("canonical path, branch, HEAD, and Git common directory are required")
  }
  if (!isAbsolute(laneRoot)) throw new Error("lane root must be absolute")
  if (pathBelongsToLane(canonical.path, laneRoot)) throw new Error("lane root must not be nested in the canonical worktree")
  const taskToken = safeToken(task.id)
  const executionToken = safeToken(executionID).slice(0, 12)
  const branch = `${canonical.branch}--lane-${taskToken}-${executionToken}`
  const path = resolve(laneRoot, safeToken(branch.replaceAll("/", "-")))
  if (array(existingBranches).includes(branch)) throw new Error(`lane branch already exists: ${branch}`)
  if (array(existingWorktrees).some((entry) => comparableAbsolutePath(entry.path ?? entry) === comparableAbsolutePath(path))) {
    throw new Error(`lane worktree path already exists: ${path}`)
  }
  return {
    taskID: task.id,
    order: task._order ?? task.order,
    path,
    branch,
    baseSha: canonical.head,
    canonicalPath: resolve(canonical.path),
    canonicalBranch: canonical.branch,
    commonDir: resolve(canonical.commonDir),
    executionID,
    ownership: "EXECUTOR_CREATED_CURRENT_EXECUTION",
    create: ["worktree", "add", "-b", branch, path, canonical.head],
  }
}

export function validateLaneCreation({ lane, observed }) {
  const matches = Boolean(
    observed?.isLinkedWorktree === true &&
    comparableAbsolutePath(observed.path) === comparableAbsolutePath(lane.path) &&
    observed.branch === lane.branch &&
    observed.head === lane.baseSha &&
    comparableAbsolutePath(observed.commonDir) === comparableAbsolutePath(lane.commonDir),
  )
  return {
    status: matches ? STATUS.PROVEN : STATUS.FAILED,
    commonBaseline: matches,
    reason: matches ? "linked lane matches its creation provenance" : "created lane facts do not match provenance",
  }
}

export function buildLaneWorkerDispatch({ lane, task, category }) {
  if (!lane?.path || !isAbsolute(lane.path)) throw new Error("absolute lane path is required")
  const prompt = [
    `TASK: ${task.id} — ${task.objective}`,
    `WORKSPACE: ${lane.path}`,
    `ALLOWED SCOPE: ${array(task.writeScopes).join(", ") || "the task-defined implementation scope"}`,
    "WORKFLOW STATE IS READ-ONLY. Do not modify openspec/**, .omo/**, or .product/**.",
    "Do not create, remove, merge, reset, clean, or push Git worktrees/branches.",
    `VERIFY: ${task.verification ?? "run the task-defined focused checks and report exact evidence"}`,
  ].join("\n")
  return {
    category,
    run_in_background: true,
    directory: lane.path,
    prompt,
    proof: {
      runtimeDirectoryBinding: true,
      promptPathIsAuthority: false,
    },
  }
}

export function inspectLaneResult({ lane, observed, task, review, qa }) {
  const issues = []
  if (!observed?.path || comparableAbsolutePath(observed.path) !== comparableAbsolutePath(lane.path)) issues.push("lane path mismatch")
  if (observed?.branch !== lane.branch) issues.push("lane branch mismatch")
  if (comparableAbsolutePath(observed?.commonDir ?? "/") !== comparableAbsolutePath(lane.commonDir)) issues.push("Git common directory mismatch")
  if (observed?.workerConfinement !== STATUS.PROVEN) issues.push("worker mutation confinement is not proven")
  if (observed?.bookkeepingPolicy !== STATUS.PROVEN) issues.push("runtime bookkeeping is unknown")
  if (observed?.rawPathsCaptured !== true || !Array.isArray(observed?.changedPaths) || observed.changedPaths.length === 0) {
    issues.push("raw changed-path evidence is missing")
  }
  if (array(observed?.unknownMutations).length > 0) issues.push("unknown mutation")
  if (array(observed?.forbiddenWorkerMutations).length > 0) issues.push("forbidden worker mutation")
  if (array(observed?.changedPaths).some((path) => !array(task.writeScopes).some((scope) => pathWithinScope(path, scope)))) {
    issues.push("mutation outside task write scope")
  }
  if (!observed?.focusedChecksPassed) issues.push("focused checks failed or are missing")
  if (!observed?.committed || !(observed?.aheadBy > 0)) issues.push("no committed lane change")
  if (review !== "[APPROVED]") issues.push("lane review is not approved")
  if (task.qaRequired === true && qa !== "QA_PASS") issues.push("required lane-local QA did not pass")
  return {
    readyForIntegration: issues.length === 0,
    status: issues.length === 0 ? STATUS.PROVEN : STATUS.FAILED,
    issues,
  }
}

export function buildIntegrationPlan({ canonicalHead, laneResults }) {
  const ordered = array(laneResults)
    .slice()
    .sort((a, b) => (a.lane.order ?? 0) - (b.lane.order ?? 0) || String(a.lane.taskID).localeCompare(String(b.lane.taskID)))
  if (ordered.some((result) => result.inspection?.readyForIntegration !== true)) {
    return { status: LANE_DECISION.BLOCKED, reason: "one or more lanes are not integration-ready", steps: [] }
  }
  if (ordered.some((result) => result.lane.baseSha !== canonicalHead)) {
    return { status: LANE_DECISION.BLOCKED, reason: "lane baseline does not match the canonical wave baseline", steps: [] }
  }
  return {
    status: LANE_DECISION.PERMITTED,
    baseSha: canonicalHead,
    strategy: "MERGE_NO_FF",
    steps: ordered.map((result) => ({
      taskID: result.lane.taskID,
      branch: result.lane.branch,
      command: ["merge", "--no-ff", "--no-edit", result.lane.branch],
      onConflict: "STOP_AND_PRESERVE",
    })),
  }
}

export function assessWaveCompletion({ integrationResults, combinedChecksPassed, tasks }) {
  const results = array(integrationResults)
  if (results.length === 0) {
    return { advance: false, status: LANE_DECISION.BLOCKED, reason: "no lane integration result was provided", completableTasks: [] }
  }
  if (results.some((result) => result.conflict || result.integrated !== true)) {
    return { advance: false, status: LANE_DECISION.BLOCKED, reason: "lane integration is incomplete or conflicted", completableTasks: [] }
  }
  if (combinedChecksPassed !== true) {
    return { advance: false, status: LANE_DECISION.BLOCKED, reason: "combined canonical checks did not pass", completableTasks: [] }
  }
  const integrated = new Set(results.map((result) => result.taskID))
  return {
    advance: true,
    status: LANE_DECISION.PERMITTED,
    completableTasks: array(tasks).filter((task) => integrated.has(task.id)).map((task) => task.id),
  }
}

export function assessLaneCleanup({ lane, observed, integration }) {
  const reasons = []
  if (lane?.ownership !== "EXECUTOR_CREATED_CURRENT_EXECUTION") reasons.push("lane ownership is not proven")
  if (
    observed?.isLinkedWorktree !== true ||
    !observed?.path ||
    comparableAbsolutePath(observed.path) !== comparableAbsolutePath(lane?.path ?? "/") ||
    observed?.branch !== lane?.branch ||
    !observed?.commonDir ||
    comparableAbsolutePath(observed.commonDir) !== comparableAbsolutePath(lane?.commonDir ?? "/")
  ) reasons.push("worktree identity mismatch")
  if (observed?.bookkeepingPolicy !== STATUS.PROVEN) reasons.push("unknown runtime bookkeeping")
  if (array(observed?.unknownMutations).length > 0) reasons.push("unknown mutation")
  if (observed?.cleanAfterKnownBookkeeping !== true) reasons.push("lane has uncommitted data")
  if (integration?.integrated !== true || integration?.uniqueUnintegratedCommits !== 0) reasons.push("lane has needed unintegrated commits")
  if (observed?.normalRemovalRefused === true) reasons.push("normal worktree removal refused")
  return {
    decision: reasons.length === 0 ? LANE_DECISION.PERMITTED : LANE_DECISION.PRESERVE,
    reasons,
    removeWorktree: reasons.length === 0 ? ["worktree", "remove", lane.path] : null,
    deleteBranchAfterWorktreeRemoval: reasons.length === 0 ? ["branch", "-d", lane.branch] : null,
  }
}

export function classifyResumeCandidate({
  task,
  canonical,
  worktree,
  branchMerged,
  taskAttribution = false,
  baseRelationship = false,
  contentsInspected = false,
  currentExecutionOwnership = false,
}) {
  if (!task || task.checked === true) return { decision: LANE_DECISION.PRESERVE, reason: "task is not an unchecked recovery target" }
  if (!worktree?.isLinkedWorktree || !worktree.commonDir || comparableAbsolutePath(worktree.commonDir) !== comparableAbsolutePath(canonical.commonDir)) {
    return { decision: LANE_DECISION.PRESERVE, reason: "worktree is not attributable to the canonical repository" }
  }
  const expectedPrefix = `${canonical.branch}--lane-${safeToken(task.id)}-`
  if (!worktree.branch?.startsWith(expectedPrefix)) {
    return { decision: LANE_DECISION.PRESERVE, reason: "branch naming does not match the task lane contract" }
  }
  if (!taskAttribution || !baseRelationship || !contentsInspected) {
    return { decision: LANE_DECISION.PRESERVE, reason: "naming alone does not prove task, base, and content provenance" }
  }
  if (branchMerged === true) {
    return {
      decision: LANE_DECISION.BLOCKED,
      reason: "lane appears integrated while tasks.md remains unchecked; re-run canonical checks before completing it",
      next: "VERIFY_INTEGRATED_STATE",
    }
  }
  return {
    decision: LANE_DECISION.PERMITTED,
    reason: "candidate may be inspected and reused; cleanup still requires current-execution ownership",
    reuse: true,
    cleanupAuthorized: currentExecutionOwnership,
  }
}

export function pathBelongsToLane(lanePath, candidatePath) {
  const contained = (root, candidate) => {
    const rel = relative(root, candidate)
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel))
  }
  return contained(resolve(lanePath), resolve(candidatePath)) ||
    contained(comparableAbsolutePath(lanePath), comparableAbsolutePath(candidatePath))
}

export function defaultProductionLaneRuntimeEvidence() {
  return {
    source: "production-runtime",
    adoptedForExecution: false,
    runtimeIdentity: null,
    capabilities: {},
  }
}
