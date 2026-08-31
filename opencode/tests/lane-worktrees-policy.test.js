import test from "node:test"
import assert from "node:assert/strict"

import {
  EXECUTION_MODE,
  LANE_DECISION,
  assessLaneCleanup,
  assessLaneRuntimeCapability,
  assessWaveCompletion,
  buildIntegrationPlan,
  buildLaneWorkerDispatch,
  classifyResumeCandidate,
  compareLaneTasks,
  defaultProductionLaneRuntimeEvidence,
  inspectLaneResult,
  pathBelongsToLane,
  planLaneCreation,
  selectLaneWave,
  validateLaneCreation,
} from "../../scripts/lib/lane-worktrees.mjs"
import { STATUS } from "../../scripts/probes/worktree-isolation.mjs"

function runtimeEvidence(overrides = {}) {
  return {
    source: "mechanical-runtime-evidence",
    adoptedForExecution: true,
    runtimeIdentity: { opencode: "1.18.25", omoHead: "measured-head" },
    capabilities: {
      callerSelectedDirectory: STATUS.PROVEN,
      syncActiveToolCompletion: STATUS.PROVEN,
      backgroundActiveToolCompletion: STATUS.PROVEN,
      syncActualToolCwd: STATUS.PROVEN,
      backgroundActualToolCwd: STATUS.PROVEN,
      singleWorkerMutationConfinement: STATUS.PROVEN,
      concurrentDirectoryAssignment: STATUS.PROVEN,
      concurrentToolIsolation: STATUS.PROVEN,
      temporalOverlap: STATUS.PROVEN,
      siblingMutationConfinement: STATUS.PROVEN,
      parentWorkerMutationConfinement: STATUS.PROVEN,
      nestedRuntimePreservation: STATUS.PROVEN,
      runtimeBookkeepingPolicy: STATUS.PROVEN,
    },
    ...overrides,
  }
}

function task(id, order, overrides = {}) {
  return {
    id,
    order,
    checked: false,
    dependencies: [],
    parallel: "SAFE_TO_PARALLELIZE",
    laneIsolationEligible: true,
    objective: `Implement ${id}`,
    writeScopes: [`src/${id}.js`],
    shared: {},
    verification: `node --test test/${id}.test.js`,
    ...overrides,
  }
}

const canonical = {
  path: "/tmp/change",
  branch: "feature/foo",
  head: "a".repeat(40),
  commonDir: "/tmp/repo/.git",
}

function laneFor(id = "T1", order = 1) {
  return planLaneCreation({
    canonical,
    task: task(id, order),
    executionID: "run-1234567890",
    laneRoot: "/tmp/lanes",
  })
}

function acceptedLaneResult(lane) {
  const inspection = inspectLaneResult({
    lane,
    task: task(lane.taskID, lane.order),
    observed: {
      path: lane.path,
      branch: lane.branch,
      commonDir: lane.commonDir,
      workerConfinement: STATUS.PROVEN,
      bookkeepingPolicy: STATUS.PROVEN,
      rawPathsCaptured: true,
      changedPaths: task(lane.taskID, lane.order).writeScopes,
      unknownMutations: [],
      forbiddenWorkerMutations: [],
      focusedChecksPassed: true,
      committed: true,
      aheadBy: 1,
    },
    review: "[APPROVED]",
  })
  return { lane, inspection }
}

test("current production capability defaults to unavailable without a version guess", () => {
  const result = assessLaneRuntimeCapability(defaultProductionLaneRuntimeEvidence())
  assert.equal(result.available, false)
  assert.equal(result.status, STATUS.UNPROVEN)
})

test("runtime gate requires every adopted mechanical capability", () => {
  const evidence = runtimeEvidence()
  evidence.capabilities.backgroundActiveToolCompletion = STATUS.FAILED
  const result = assessLaneRuntimeCapability(evidence)
  assert.equal(result.available, false)
  assert.equal(result.status, STATUS.FAILED)
  assert.deepEqual(result.missing, ["backgroundActiveToolCompletion"])
})

test("capability unavailable falls back without lane creation", () => {
  const result = selectLaneWave({ tasks: [task("T1", 1), task("T2", 2)], runtimeEvidence: defaultProductionLaneRuntimeEvidence() })
  assert.equal(result.mode, EXECUTION_MODE.CHANGE_WORKTREE)
  assert.equal(result.decision, LANE_DECISION.FALLBACK)
  assert.equal(result.laneTasks.length, 0)
})

test("one ready task does not fan out into a lane", () => {
  const result = selectLaneWave({ tasks: [task("T1", 1)], runtimeEvidence: runtimeEvidence() })
  assert.equal(result.mode, EXECUTION_MODE.CHANGE_WORKTREE)
  assert.match(result.reason, /fewer than two/)
})

test("two independent ready tasks permit lane worktrees", () => {
  const result = selectLaneWave({ tasks: [task("T1", 1), task("T2", 2)], runtimeEvidence: runtimeEvidence() })
  assert.equal(result.mode, EXECUTION_MODE.LANE_WORKTREES)
  assert.deepEqual(result.laneTasks.map((entry) => entry.id), ["T1", "T2"])
})

test("dependency edge keeps the dependent task out of the ready wave", () => {
  const result = selectLaneWave({
    tasks: [task("T1", 1), task("T2", 2, { dependencies: ["T1"] })],
    runtimeEvidence: runtimeEvidence(),
  })
  assert.equal(result.mode, EXECUTION_MODE.CHANGE_WORKTREE)
  assert.deepEqual(result.ready.map((entry) => entry.id), ["T1"])
})

test("write-scope overlap forces serialization", () => {
  const left = task("T1", 1, { writeScopes: ["src/shared"] })
  const right = task("T2", 2, { writeScopes: ["src/shared/file.js"] })
  assert.deepEqual(compareLaneTasks(left, right), { independent: false, reasons: ["write-scope overlap"] })
  assert.equal(selectLaneWave({ tasks: [left, right], runtimeEvidence: runtimeEvidence() }).mode, EXECUTION_MODE.CHANGE_WORKTREE)
})

test("wildcard write scopes conservatively overlap their concrete descendants", () => {
  const left = task("T1", 1, { writeScopes: ["src/features/**"] })
  const right = task("T2", 2, { writeScopes: ["src/features/item.js"] })
  assert.equal(compareLaneTasks(left, right).independent, false)
})

test("shared schema or migration forces serialization", () => {
  const left = task("T1", 1, { shared: { schemas: ["public.user"], migrations: ["db"] } })
  const right = task("T2", 2, { shared: { schemas: ["public.user"], migrations: ["db"] } })
  const comparison = compareLaneTasks(left, right)
  assert.equal(comparison.independent, false)
  assert.deepEqual(comparison.reasons, ["shared schemas", "shared migrations"])
})

test("lane naming is unique, provenance-bearing, and collision refusing", () => {
  const lane = laneFor()
  assert.match(lane.branch, /^feature\/foo--lane-T1-run-1234567/)
  assert.equal(lane.baseSha, canonical.head)
  assert.equal(lane.commonDir, canonical.commonDir)
  assert.deepEqual(lane.create.slice(0, 3), ["worktree", "add", "-b"])
  assert.throws(() => planLaneCreation({
    canonical,
    task: task("T1", 1),
    executionID: "run-1234567890",
    laneRoot: "/tmp/lanes",
    existingBranches: [lane.branch],
  }), /already exists/)
})

test("lane creation rejects missing identity and a lane root nested in canonical", () => {
  assert.throws(() => planLaneCreation({
    canonical,
    task: task("", 1),
    executionID: "run",
    laneRoot: "/tmp/lanes",
  }), /token/)
  assert.throws(() => planLaneCreation({
    canonical,
    task: task("T1", 1),
    executionID: "run",
    laneRoot: "/tmp/change/lanes",
  }), /must not be nested/)
})

test("all lanes must mechanically match the common creation baseline", () => {
  const lane = laneFor()
  assert.equal(validateLaneCreation({ lane, observed: {
    isLinkedWorktree: true,
    path: lane.path,
    branch: lane.branch,
    head: lane.baseSha,
    commonDir: lane.commonDir,
  } }).status, STATUS.PROVEN)
  assert.equal(validateLaneCreation({ lane, observed: {
    isLinkedWorktree: true,
    path: lane.path,
    branch: lane.branch,
    head: "b".repeat(40),
    commonDir: lane.commonDir,
  } }).status, STATUS.FAILED)
})

test("creation failure is surfaced before worker mutation", () => {
  const lane = laneFor()
  const result = validateLaneCreation({ lane, observed: { isLinkedWorktree: false, path: lane.path } })
  assert.equal(result.status, STATUS.FAILED)
  assert.equal(result.commonBaseline, false)
})

test("worker dispatch uses the directory field and never treats prompt path as binding", () => {
  const lane = laneFor()
  const dispatch = buildLaneWorkerDispatch({ lane, task: task("T1", 1), category: "implementation" })
  assert.equal(dispatch.directory, lane.path)
  assert.equal(dispatch.run_in_background, true)
  assert.equal(dispatch.proof.runtimeDirectoryBinding, true)
  assert.equal(dispatch.proof.promptPathIsAuthority, false)
  assert.doesNotMatch(dispatch.prompt, /please cd|\bcd\s/i)
})

test("known bookkeeping and clean lane evidence can pass result inspection", () => {
  assert.equal(acceptedLaneResult(laneFor()).inspection.readyForIntegration, true)
})

test("unknown mutation blocks lane integration", () => {
  const lane = laneFor()
  const result = inspectLaneResult({
    lane,
    task: task("T1", 1),
    observed: {
      path: lane.path,
      branch: lane.branch,
      commonDir: lane.commonDir,
      workerConfinement: STATUS.PROVEN,
      bookkeepingPolicy: STATUS.UNPROVEN,
      rawPathsCaptured: true,
      changedPaths: ["src/T1.js"],
      unknownMutations: [".omo/unexpected.json"],
      focusedChecksPassed: true,
      committed: true,
      aheadBy: 1,
    },
    review: "[APPROVED]",
  })
  assert.equal(result.readyForIntegration, false)
  assert.ok(result.issues.includes("unknown mutation"))
})

test("a changed path outside the task write scope blocks lane integration", () => {
  const lane = laneFor()
  const result = inspectLaneResult({
    lane,
    task: task("T1", 1),
    observed: {
      path: lane.path,
      branch: lane.branch,
      commonDir: lane.commonDir,
      workerConfinement: STATUS.PROVEN,
      bookkeepingPolicy: STATUS.PROVEN,
      rawPathsCaptured: true,
      changedPaths: ["src/T2.js"],
      focusedChecksPassed: true,
      committed: true,
      aheadBy: 1,
    },
    review: "[APPROVED]",
  })
  assert.equal(result.readyForIntegration, false)
  assert.ok(result.issues.includes("mutation outside task write scope"))
})

test("worker escape or cross-lane mutation blocks integration", () => {
  const lane = laneFor()
  const result = inspectLaneResult({
    lane,
    task: task("T1", 1),
    observed: {
      path: lane.path,
      branch: lane.branch,
      commonDir: lane.commonDir,
      workerConfinement: STATUS.FAILED,
      bookkeepingPolicy: STATUS.PROVEN,
      rawPathsCaptured: true,
      changedPaths: ["src/T1.js"],
      forbiddenWorkerMutations: ["/tmp/change/src/T1.js"],
      focusedChecksPassed: true,
      committed: true,
      aheadBy: 1,
    },
    review: "[APPROVED]",
  })
  assert.equal(result.status, STATUS.FAILED)
})

test("review or required lane-local QA failure keeps the task unchecked", () => {
  const lane = laneFor()
  const baseObserved = {
    path: lane.path,
    branch: lane.branch,
    commonDir: lane.commonDir,
    workerConfinement: STATUS.PROVEN,
    bookkeepingPolicy: STATUS.PROVEN,
    rawPathsCaptured: true,
    changedPaths: ["src/T1.js"],
    focusedChecksPassed: true,
    committed: true,
    aheadBy: 1,
  }
  assert.equal(inspectLaneResult({ lane, task: task("T1", 1), observed: baseObserved, review: "[CHANGES_REQUIRED]" }).readyForIntegration, false)
  assert.equal(inspectLaneResult({ lane, task: task("T1", 1, { qaRequired: true }), observed: baseObserved, review: "[APPROVED]", qa: "QA_FAIL" }).readyForIntegration, false)
})

test("integration uses deterministic task order and no-ff merges", () => {
  const t2 = acceptedLaneResult(laneFor("T2", 2))
  const t1 = acceptedLaneResult(laneFor("T1", 1))
  const result = buildIntegrationPlan({ canonicalHead: canonical.head, laneResults: [t2, t1] })
  assert.equal(result.strategy, "MERGE_NO_FF")
  assert.deepEqual(result.steps.map((step) => step.taskID), ["T1", "T2"])
  assert.deepEqual(result.steps[0].command.slice(0, 3), ["merge", "--no-ff", "--no-edit"])
  assert.equal(result.steps[0].onConflict, "STOP_AND_PRESERVE")
})

test("integration refuses a lane from a mismatched baseline", () => {
  const result = acceptedLaneResult({ ...laneFor(), baseSha: "b".repeat(40) })
  const plan = buildIntegrationPlan({ canonicalHead: canonical.head, laneResults: [result] })
  assert.equal(plan.status, LANE_DECISION.BLOCKED)
  assert.match(plan.reason, /baseline/)
})

test("integration conflict blocks the wave and preserves task state", () => {
  const result = assessWaveCompletion({
    integrationResults: [{ taskID: "T1", integrated: false, conflict: true }],
    combinedChecksPassed: true,
    tasks: [task("T1", 1)],
  })
  assert.equal(result.advance, false)
  assert.deepEqual(result.completableTasks, [])
})

test("an empty integration result cannot advance a wave", () => {
  const result = assessWaveCompletion({ integrationResults: [], combinedChecksPassed: true, tasks: [task("T1", 1)] })
  assert.equal(result.advance, false)
  assert.deepEqual(result.completableTasks, [])
})

test("combined-check failure blocks dependent waves and checkbox transitions", () => {
  const result = assessWaveCompletion({
    integrationResults: [{ taskID: "T1", integrated: true }, { taskID: "T2", integrated: true }],
    combinedChecksPassed: false,
    tasks: [task("T1", 1), task("T2", 2)],
  })
  assert.equal(result.advance, false)
  assert.deepEqual(result.completableTasks, [])
})

test("successful integration plus combined checks permits exact task transitions", () => {
  const result = assessWaveCompletion({
    integrationResults: [{ taskID: "T1", integrated: true }, { taskID: "T2", integrated: true }],
    combinedChecksPassed: true,
    tasks: [task("T1", 1), task("T2", 2), task("T3", 3, { dependencies: ["T1", "T2"] })],
  })
  assert.equal(result.advance, true)
  assert.deepEqual(result.completableTasks, ["T1", "T2"])
})

test("owned integrated clean lane is removable with safe branch deletion", () => {
  const lane = laneFor()
  const result = assessLaneCleanup({
    lane,
    observed: {
      isLinkedWorktree: true,
      path: lane.path,
      branch: lane.branch,
      commonDir: lane.commonDir,
      bookkeepingPolicy: STATUS.PROVEN,
      unknownMutations: [],
      cleanAfterKnownBookkeeping: true,
    },
    integration: { integrated: true, uniqueUnintegratedCommits: 0 },
  })
  assert.equal(result.decision, LANE_DECISION.PERMITTED)
  assert.deepEqual(result.removeWorktree.slice(0, 2), ["worktree", "remove"])
  assert.deepEqual(result.deleteBranchAfterWorktreeRemoval.slice(0, 2), ["branch", "-d"])
})

test("dirty, unknown, external, unintegrated, or removal-refused lanes are preserved", () => {
  const lane = laneFor()
  const cases = [
    { observed: { isLinkedWorktree: true, path: lane.path, branch: lane.branch, commonDir: lane.commonDir, bookkeepingPolicy: STATUS.PROVEN, cleanAfterKnownBookkeeping: false }, integration: { integrated: true, uniqueUnintegratedCommits: 0 } },
    { observed: { isLinkedWorktree: true, path: lane.path, branch: lane.branch, commonDir: lane.commonDir, bookkeepingPolicy: STATUS.UNPROVEN, cleanAfterKnownBookkeeping: true }, integration: { integrated: true, uniqueUnintegratedCommits: 0 } },
    { lane: { ...lane, ownership: "EXTERNAL" }, observed: { isLinkedWorktree: true, path: lane.path, branch: lane.branch, commonDir: lane.commonDir, bookkeepingPolicy: STATUS.PROVEN, cleanAfterKnownBookkeeping: true }, integration: { integrated: true, uniqueUnintegratedCommits: 0 } },
    { observed: { isLinkedWorktree: true, path: lane.path, branch: lane.branch, commonDir: lane.commonDir, bookkeepingPolicy: STATUS.PROVEN, cleanAfterKnownBookkeeping: true }, integration: { integrated: false, uniqueUnintegratedCommits: 1 } },
    { observed: { isLinkedWorktree: true, path: lane.path, branch: lane.branch, commonDir: lane.commonDir, bookkeepingPolicy: STATUS.PROVEN, cleanAfterKnownBookkeeping: true, normalRemovalRefused: true }, integration: { integrated: true, uniqueUnintegratedCommits: 0 } },
  ]
  for (const entry of cases) {
    assert.equal(assessLaneCleanup({ lane: entry.lane ?? lane, observed: entry.observed, integration: entry.integration }).decision, LANE_DECISION.PRESERVE)
  }
})

test("one failed or cancelled worker does not invalidate a successful sibling but blocks integration readiness", () => {
  const success = acceptedLaneResult(laneFor("T1", 1))
  const cancelled = { lane: laneFor("T2", 2), inspection: { readyForIntegration: false, issues: ["worker cancelled"] } }
  const result = buildIntegrationPlan({ canonicalHead: canonical.head, laneResults: [success, cancelled] })
  assert.equal(success.inspection.readyForIntegration, true)
  assert.equal(result.status, LANE_DECISION.BLOCKED)
})

test("resume recognizes an unchecked matching lane without granting cleanup ownership", () => {
  const lane = laneFor()
  const result = classifyResumeCandidate({
    task: task("T1", 1),
    canonical,
    worktree: { isLinkedWorktree: true, branch: lane.branch, commonDir: canonical.commonDir },
    branchMerged: false,
    taskAttribution: true,
    baseRelationship: true,
    contentsInspected: true,
  })
  assert.equal(result.reuse, true)
  assert.equal(result.cleanupAuthorized, false)
})

test("interruption after integration requires canonical verification before checkbox completion", () => {
  const lane = laneFor()
  const result = classifyResumeCandidate({
    task: task("T1", 1),
    canonical,
    worktree: { isLinkedWorktree: true, branch: lane.branch, commonDir: canonical.commonDir },
    branchMerged: true,
    taskAttribution: true,
    baseRelationship: true,
    contentsInspected: true,
  })
  assert.equal(result.decision, LANE_DECISION.BLOCKED)
  assert.equal(result.next, "VERIFY_INTEGRATED_STATE")
})

test("unknown existing worktree is preserved rather than reused or cleaned", () => {
  const result = classifyResumeCandidate({
    task: task("T1", 1),
    canonical,
    worktree: { isLinkedWorktree: true, branch: "user/work", commonDir: canonical.commonDir },
    branchMerged: false,
  })
  assert.equal(result.decision, LANE_DECISION.PRESERVE)
})

test("a matching lane name alone is insufficient for resume", () => {
  const lane = laneFor()
  const result = classifyResumeCandidate({
    task: task("T1", 1),
    canonical,
    worktree: { isLinkedWorktree: true, branch: lane.branch, commonDir: canonical.commonDir },
    branchMerged: false,
  })
  assert.equal(result.decision, LANE_DECISION.PRESERVE)
  assert.match(result.reason, /naming alone/)
})

test("lane path containment rejects sibling and parent paths", () => {
  assert.equal(pathBelongsToLane("/tmp/lanes/a", "/tmp/lanes/a/src/file.js"), true)
  assert.equal(pathBelongsToLane("/tmp/lanes/a", "/tmp/lanes/b/src/file.js"), false)
  assert.equal(pathBelongsToLane("/tmp/lanes/a", "/tmp/change/src/file.js"), false)
})
