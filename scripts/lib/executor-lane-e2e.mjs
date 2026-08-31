import { STATUS } from "../probes/worktree-isolation.mjs"
import { ALLOWED_MODELS } from "../probes/worktree-concurrent-runtime.mjs"

const ALLOWED_REASONING = new Set(["none", "minimal", "low", "medium", "high"])

function status(condition, contradiction = false) {
  if (condition === true) return STATUS.PROVEN
  return contradiction ? STATUS.FAILED : STATUS.UNPROVEN
}

function interval(value) {
  if (!value || value.start === undefined || value.end === undefined) return null
  try {
    const start = BigInt(value.start)
    const end = BigInt(value.end)
    return end > start ? { start, end } : null
  } catch {
    return null
  }
}

function classifyModels(requests) {
  if (!Array.isArray(requests) || requests.length === 0) return STATUS.UNPROVEN
  return requests.every((request) =>
    request.provider === "openai" &&
    ALLOWED_MODELS.has(`${request.provider}/${request.model}`) &&
    typeof request.reasoning === "string" &&
    ALLOWED_REASONING.has(request.reasoning)
  ) ? STATUS.PROVEN : STATUS.UNPROVEN
}

function strictlyAfter(left, right) {
  try {
    return BigInt(left) > BigInt(right)
  } catch {
    return false
  }
}

function classifyOverlap(workers) {
  const left = interval(workers?.T1?.tool)
  const right = interval(workers?.T2?.tool)
  if (!left || !right) return { status: STATUS.UNPROVEN }
  const latestStart = left.start > right.start ? left.start : right.start
  const earliestEnd = left.end < right.end ? left.end : right.end
  return {
    status: latestStart < earliestEnd ? STATUS.PROVEN : STATUS.FAILED,
    latestStart: latestStart.toString(),
    earliestEnd: earliestEnd.toString(),
  }
}

function classifyWorker(worker, lane) {
  if (!worker?.sessionID || !worker?.parentSessionID || !worker?.tool || !lane) return STATUS.UNPROVEN
  if (worker.tool.status !== "completed") return STATUS.UNPROVEN
  const actual = worker.tool.evidence
  if (!actual) return STATUS.UNPROVEN
  const matches =
    worker.requestedDirectory === lane.path &&
    worker.storedDirectory === lane.path &&
    actual.pwd === lane.path &&
    actual.gitTopLevel === lane.path &&
    actual.branch === lane.branch &&
    actual.gitCommonDir === lane.commonDir &&
    worker.tool.workdir === undefined &&
    !/(^|[;&|]\s*)cd\s/.test(worker.tool.command ?? "")
  return status(matches, !matches)
}

function classifyTaskTiming(snapshots) {
  if (!snapshots?.before || !snapshots?.afterWorkers || !snapshots?.afterIntegration || !snapshots?.afterCombined) {
    return STATUS.UNPROVEN
  }
  const unchecked = (snapshot, id) => snapshot[id] === false
  const correct =
    unchecked(snapshots.before, "T1") && unchecked(snapshots.before, "T2") && unchecked(snapshots.before, "T3") &&
    unchecked(snapshots.afterWorkers, "T1") && unchecked(snapshots.afterWorkers, "T2") &&
    unchecked(snapshots.afterIntegration, "T1") && unchecked(snapshots.afterIntegration, "T2") &&
    snapshots.afterCombined.T1 === true && snapshots.afterCombined.T2 === true && snapshots.afterCombined.T3 === false
  return status(correct, !correct)
}

export function classifyExecutorLaneE2E(evidence = {}) {
  const route = status(
    evidence.route?.command === "/execute" &&
    (evidence.route?.agent === "Executor" ||
      (evidence.route?.agent === "executor" && evidence.route?.executorPromptMatchesCanonical === true)) &&
    evidence.route?.planReview === "[APPROVED]",
  )
  const capabilityGate = status(evidence.capabilityGate?.status === STATUS.PROVEN)
  const lanes = evidence.lanes ?? {}
  const laneCreationFacts = [lanes.T1, lanes.T2]
  const laneCreation = status(
    laneCreationFacts.every((lane) =>
      lane?.linked === true && lane?.owned === true && lane?.path && lane?.branch && lane?.baseSha && lane?.commonDir,
    ) &&
    lanes.T1?.baseSha === lanes.T2?.baseSha &&
    lanes.T1?.commonDir === lanes.T2?.commonDir &&
    lanes.T1?.path !== lanes.T2?.path &&
    lanes.T1?.branch !== lanes.T2?.branch,
  )
  const workers = evidence.workers ?? {}
  const workerT1 = classifyWorker(workers.T1, lanes.T1)
  const workerT2 = classifyWorker(workers.T2, lanes.T2)
  const overlap = classifyOverlap(workers)
  const confinement = status(
    evidence.mutationConfinement?.canonical?.T1 === false &&
    evidence.mutationConfinement?.canonical?.T2 === false &&
    evidence.mutationConfinement?.T1?.T1 === true &&
    evidence.mutationConfinement?.T1?.T2 === false &&
    evidence.mutationConfinement?.T2?.T1 === false &&
    evidence.mutationConfinement?.T2?.T2 === true,
    evidence.mutationConfinement?.contradiction === true,
  )
  const bookkeeping = status(
    evidence.bookkeeping?.policyStatus === STATUS.PROVEN &&
    Array.isArray(evidence.bookkeeping?.unknown) && evidence.bookkeeping.unknown.length === 0,
  )
  const laneAcceptance = status(
    ["T1", "T2"].every((id) =>
      evidence.laneValidation?.[id]?.focusedChecksPassed === true &&
      evidence.laneValidation?.[id]?.reviewerVerdict === "[APPROVED]" &&
      evidence.laneValidation?.[id]?.integrationReady === true,
    ),
  )
  const laneCommits = status(["T1", "T2"].every((id) =>
    evidence.commits?.[id]?.sha && evidence.commits?.[id]?.branch === lanes[id]?.branch,
  ))
  const integration = status(
    evidence.integration?.strategy === "MERGE_NO_FF" &&
    Array.isArray(evidence.integration?.order) &&
    evidence.integration.order.join(",") === "T1,T2" &&
    evidence.integration?.results?.every((result) => result.integrated === true && result.mergeSha),
    evidence.integration?.conflict === true,
  )
  const combinedChecks = status(evidence.combinedChecks?.passed === true, evidence.combinedChecks?.passed === false)
  const taskTransitions = classifyTaskTiming(evidence.taskSnapshots)
  const t3 = status(
    evidence.T3?.sessionID && evidence.T3?.workspaceMode === "CHANGE_WORKTREE" &&
    strictlyAfter(evidence.T3?.start, evidence.combinedChecks?.completedAt) &&
    evidence.T3?.observedT1 === true && evidence.T3?.observedT2 === true && evidence.T3?.completed === true,
    evidence.T3?.start !== undefined && evidence.combinedChecks?.completedAt !== undefined &&
      !strictlyAfter(evidence.T3.start, evidence.combinedChecks.completedAt),
  )
  const cleanup = status(
    ["T1", "T2"].every((id) =>
      evidence.cleanup?.[id]?.owned === true &&
      evidence.cleanup?.[id]?.worktreeRemoved === true &&
      evidence.cleanup?.[id]?.branchDeleted === true,
    ),
  )
  const modelProviderCompliance = classifyModels(evidence.modelRequests)

  const capabilities = {
    actualExecutorRoute: route,
    capabilityGate,
    laneCreation,
    workerT1ActualCwd: workerT1,
    workerT2ActualCwd: workerT2,
    temporalToolOverlap: overlap.status,
    mutationConfinement: confinement,
    runtimeBookkeepingPolicy: bookkeeping,
    laneLocalAcceptance: laneAcceptance,
    laneCommits,
    deterministicIntegration: integration,
    combinedChecks,
    taskTransitionTiming: taskTransitions,
    dependentT3Gate: t3,
    safeCleanup: cleanup,
    modelProviderCompliance,
  }
  const values = Object.values(capabilities)
  return {
    status: values.every((value) => value === STATUS.PROVEN)
      ? STATUS.PROVEN
      : values.some((value) => value === STATUS.FAILED)
        ? STATUS.FAILED
        : STATUS.UNPROVEN,
    capabilities,
    overlap,
  }
}
