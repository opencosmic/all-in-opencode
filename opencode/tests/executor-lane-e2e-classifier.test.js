import test from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"

import { assessLaneFocusedCheck, classifyExecutorLaneE2E } from "../../scripts/lib/executor-lane-e2e.mjs"
import { finalVerdict, sessionText } from "../../scripts/probes/executor-lane-runtime.mjs"
import { STATUS } from "../../scripts/probes/worktree-isolation.mjs"

function completeEvidence() {
  const commonDir = "/fixture/.git"
  const lane = (id) => ({
    linked: true,
    owned: true,
    path: `/fixture/lanes/${id}`,
    branch: `change--lane-${id}`,
    baseSha: "a".repeat(40),
    commonDir,
  })
  const worker = (id, start, end) => ({
    sessionID: `ses_${id}`,
    parentSessionID: "ses_executor",
    requestedDirectory: `/fixture/lanes/${id}`,
    storedDirectory: `/fixture/lanes/${id}`,
    tool: {
      status: "completed",
      command: `node scripts/lane-worker.mjs ${id}`,
      start: String(start),
      end: String(end),
      evidence: {
        pwd: `/fixture/lanes/${id}`,
        gitTopLevel: `/fixture/lanes/${id}`,
        branch: `change--lane-${id}`,
        gitCommonDir: commonDir,
      },
    },
  })
  return {
    route: { command: "/execute", agent: "Executor", planReviewSession: "ses_plan", planReview: "[APPROVED]" },
    capabilityGate: { status: STATUS.PROVEN },
    permissionApproval: {
      status: STATUS.PROVEN,
      mechanism: "probe-local-adapter",
      authorizedByUser: true,
      policyReady: true,
      allowedCount: 12,
      deniedCount: 0,
    },
    lanes: { T1: lane("T1"), T2: lane("T2") },
    workers: { T1: worker("T1", 100, 300), T2: worker("T2", 200, 400) },
    mutationConfinement: {
      canonical: { T1: false, T2: false },
      T1: { T1: true, T2: false },
      T2: { T1: false, T2: true },
    },
    bookkeeping: { policyStatus: STATUS.PROVEN, unknown: [] },
    laneValidation: {
      T1: { focusedChecksPassed: true, focusedCheck: { status: STATUS.PROVEN }, reviewerDirectory: "/fixture/lanes/T1", reviewerVerdict: "[APPROVED]", integrationReady: true },
      T2: { focusedChecksPassed: true, focusedCheck: { status: STATUS.PROVEN }, reviewerDirectory: "/fixture/lanes/T2", reviewerVerdict: "[APPROVED]", integrationReady: true },
    },
    commits: {
      T1: { sha: "b".repeat(40), branch: "change--lane-T1" },
      T2: { sha: "c".repeat(40), branch: "change--lane-T2" },
    },
    integration: {
      strategy: "MERGE_NO_FF",
      order: ["T1", "T2"],
      results: [{ integrated: true, mergeSha: "d".repeat(40) }, { integrated: true, mergeSha: "e".repeat(40) }],
    },
    combinedChecks: { passed: true, completedAt: 1000 },
    taskSnapshots: {
      before: { T1: false, T2: false, T3: false },
      afterWorkers: { T1: false, T2: false, T3: false },
      afterIntegration: { T1: false, T2: false, T3: false },
      afterCombined: { T1: true, T2: true, T3: false },
    },
    T3: { sessionID: "ses_T3", taskID: "T3", dependencies: ["T1", "T2"], workspaceMode: "CHANGE_WORKTREE", expectedCwd: "/fixture", actualCwd: "/fixture", start: 1001, end: 1100, observedT1: true, observedT2: true, completed: true, serial: true },
    finalValidation: { command: "node scripts/check-final.mjs", workdir: "/fixture", status: "completed", exitCode: 0, start: 1101 },
    cleanup: {
      T1: { owned: true, worktreeRemoved: true, branchDeleted: true },
      T2: { owned: true, worktreeRemoved: true, branchDeleted: true },
    },
    modelRouting: {
      isolatedOmoConfigUnchanged: true,
      modelFallbackDisabled: true,
      runtimeFallbackDisabled: true,
    },
    modelRequests: [
      { provider: "openai", model: "gpt-5.6-luna", reasoning: "high" },
    ],
  }
}

test("complete mechanical Executor E2E evidence is proven", () => {
  assert.equal(classifyExecutorLaneE2E(completeEvidence()).status, STATUS.PROVEN)
})

test("missing actual Executor route remains unproven", () => {
  const evidence = completeEvidence()
  delete evidence.route
  assert.equal(classifyExecutorLaneE2E(evidence).status, STATUS.UNPROVEN)
})

test("Executor route and Plan Reviewer approval are separate dimensions", () => {
  const evidence = completeEvidence()
  delete evidence.route.planReview
  delete evidence.route.planReviewSession
  const result = classifyExecutorLaneE2E(evidence)
  assert.equal(result.capabilities.actualExecutorRoute, STATUS.PROVEN)
  assert.equal(result.capabilities.planReviewerApproval, STATUS.UNPROVEN)
})

test("missing permission-adapter evidence remains unproven", () => {
  const evidence = completeEvidence()
  delete evidence.permissionApproval
  assert.equal(classifyExecutorLaneE2E(evidence).capabilities.permissionGate, STATUS.UNPROVEN)
})

test("an unsafe denied Bash request fails the permission gate", () => {
  const evidence = completeEvidence()
  evidence.permissionApproval.status = STATUS.FAILED
  evidence.permissionApproval.deniedCount = 1
  assert.equal(classifyExecutorLaneE2E(evidence).capabilities.permissionGate, STATUS.FAILED)
})

test("sequential worker tools fail the concurrency capability", () => {
  const evidence = completeEvidence()
  evidence.workers.T2.tool.start = "301"
  const result = classifyExecutorLaneE2E(evidence)
  assert.equal(result.capabilities.temporalToolOverlap, STATUS.FAILED)
  assert.equal(result.status, STATUS.FAILED)
})

test("wrong intrinsic worker CWD fails", () => {
  const evidence = completeEvidence()
  evidence.workers.T1.tool.evidence.pwd = "/fixture"
  assert.equal(classifyExecutorLaneE2E(evidence).capabilities.workerT1ActualCwd, STATUS.FAILED)
})

test("cross-lane mutation fails", () => {
  const evidence = completeEvidence()
  evidence.mutationConfinement.T2.T1 = true
  evidence.mutationConfinement.contradiction = true
  assert.equal(classifyExecutorLaneE2E(evidence).capabilities.mutationConfinement, STATUS.FAILED)
})

test("unknown OMO state blocks proof", () => {
  const evidence = completeEvidence()
  evidence.bookkeeping.unknown = [".omo/unexpected.json"]
  assert.equal(classifyExecutorLaneE2E(evidence).status, STATUS.UNPROVEN)
})

test("missing reviewer approval blocks proof", () => {
  const evidence = completeEvidence()
  evidence.laneValidation.T2.reviewerVerdict = "[CHANGES_REQUIRED]"
  assert.equal(classifyExecutorLaneE2E(evidence).status, STATUS.UNPROVEN)
})

test("a Reviewer outside its owned lane cannot accept an unintegrated lane", () => {
  const evidence = completeEvidence()
  evidence.laneValidation.T1.reviewerDirectory = "/fixture"
  assert.equal(classifyExecutorLaneE2E(evidence).status, STATUS.UNPROVEN)
})

test("lane-local focused checks require exact command, completed status, and native lane workdir", () => {
  const part = (task, workdir = `/fixture/lanes/${task}`) => ({ state: { status: "completed", input: { command: `node scripts/check-task.mjs ${task}`, workdir } } })
  assert.equal(assessLaneFocusedCheck({ part: part("T1"), task: "T1", lane: "/fixture/lanes/T1" }).status, STATUS.PROVEN)
  assert.equal(assessLaneFocusedCheck({ part: part("T2"), task: "T2", lane: "/fixture/lanes/T2" }).status, STATUS.PROVEN)
  assert.equal(assessLaneFocusedCheck({ part: part("T1", "/fixture"), task: "T1", lane: "/fixture/lanes/T1" }).status, STATUS.UNPROVEN)
  assert.equal(assessLaneFocusedCheck({ part: part("T1", "/fixture/lanes/T2"), task: "T1", lane: "/fixture/lanes/T1" }).status, STATUS.UNPROVEN)
  assert.equal(assessLaneFocusedCheck({ part: { state: { status: "completed", input: { command: "node scripts/check-task.mjs T1" } } }, task: "T1", lane: "/fixture/lanes/T1" }).status, STATUS.UNPROVEN)
  assert.equal(assessLaneFocusedCheck({ part: { state: { status: "completed", input: { command: "cd /fixture/lanes/T1 && node scripts/check-task.mjs T1", workdir: "/fixture/lanes/T1" } } }, task: "T1", lane: "/fixture/lanes/T1" }).status, STATUS.UNPROVEN)
})

test("category-derived reasoning proves an otherwise unrecorded matching worker request", () => {
  const evidence = completeEvidence()
  evidence.modelRequests = [{
    provider: "openai", model: "gpt-5.6-luna", reasoningEvidence: {
      value: "high", source: "effective-category-preflight", category: "lane-e2e", taskCallCategory: "lane-e2e",
      taskCallHasNoModelOrReasoningOverride: true, childSessionMatchesTaskCall: true,
      isolatedOmoConfigUnchanged: true, modelFallbackDisabled: true, runtimeFallbackDisabled: true,
      providerModelMatchesCategoryRoute: true,
    },
  }]
  assert.equal(classifyExecutorLaneE2E(evidence).capabilities.modelProviderCompliance, STATUS.PROVEN)
})

test("unrecorded reasoning without the exact category route, overrides, or a wrong model remains unproven", () => {
  for (const request of [
    { provider: "openai", model: "gpt-5.6-luna" },
    { provider: "openai", model: "gpt-5.6-luna", reasoningEvidence: { value: "high", source: "effective-category-preflight", category: "lane-e2e", taskCallCategory: "lane-e2e", taskCallHasNoModelOrReasoningOverride: false, childSessionMatchesTaskCall: true, isolatedOmoConfigUnchanged: true, modelFallbackDisabled: true, runtimeFallbackDisabled: true, providerModelMatchesCategoryRoute: true } },
    { provider: "openai", model: "gpt-5.6-terra", reasoningEvidence: { value: "high", source: "effective-category-preflight", category: "lane-e2e", taskCallCategory: "lane-e2e", taskCallHasNoModelOrReasoningOverride: true, childSessionMatchesTaskCall: true, isolatedOmoConfigUnchanged: true, modelFallbackDisabled: true, runtimeFallbackDisabled: true, providerModelMatchesCategoryRoute: false } },
  ]) {
    const evidence = completeEvidence(); evidence.modelRequests = [request]
    assert.equal(classifyExecutorLaneE2E(evidence).capabilities.modelProviderCompliance, STATUS.UNPROVEN)
  }
})

test("a changed isolated OMO configuration or enabled fallback blocks every model route", () => {
  for (const routing of [
    { isolatedOmoConfigUnchanged: false, modelFallbackDisabled: true, runtimeFallbackDisabled: true },
    { isolatedOmoConfigUnchanged: true, modelFallbackDisabled: false, runtimeFallbackDisabled: true },
    { isolatedOmoConfigUnchanged: true, modelFallbackDisabled: true, runtimeFallbackDisabled: false },
  ]) {
    const evidence = completeEvidence(); evidence.modelRouting = routing
    assert.equal(classifyExecutorLaneE2E(evidence).capabilities.modelProviderCompliance, STATUS.UNPROVEN)
  }
})

test("failed combined checks fail the E2E", () => {
  const evidence = completeEvidence()
  evidence.combinedChecks.passed = false
  assert.equal(classifyExecutorLaneE2E(evidence).capabilities.combinedChecks, STATUS.FAILED)
})

test("tasks marked before combined checks fail", () => {
  const evidence = completeEvidence()
  evidence.taskSnapshots.afterWorkers.T1 = true
  assert.equal(classifyExecutorLaneE2E(evidence).capabilities.taskTransitionTiming, STATUS.FAILED)
})

test("T3 starting before the post-wave gate fails", () => {
  const evidence = completeEvidence()
  evidence.T3.start = 999
  assert.equal(classifyExecutorLaneE2E(evidence).capabilities.dependentT3Gate, STATUS.FAILED)
})

test("T3 requires exact dependency, canonical CWD, and serial evidence", () => {
  for (const mutate of [
    (e) => { e.T3.dependencies = ["T1"] },
    (e) => { e.T3.actualCwd = e.lanes.T1.path },
    (e) => { e.T3.serial = false },
  ]) {
    const evidence = completeEvidence(); mutate(evidence)
    assert.equal(classifyExecutorLaneE2E(evidence).capabilities.dependentT3Gate, STATUS.UNPROVEN)
  }
})

test("missing or early final validation cannot prove the E2E", () => {
  const missing = completeEvidence(); delete missing.finalValidation
  assert.equal(classifyExecutorLaneE2E(missing).capabilities.finalValidation, STATUS.UNPROVEN)
  const early = completeEvidence(); early.finalValidation.start = 1099
  assert.equal(classifyExecutorLaneE2E(early).capabilities.finalValidation, STATUS.UNPROVEN)
})

test("forbidden model request keeps the E2E unproven", () => {
  const evidence = completeEvidence()
  evidence.modelRequests.push({ provider: "anthropic", model: "claude", reasoning: "high" })
  assert.equal(classifyExecutorLaneE2E(evidence).capabilities.modelProviderCompliance, STATUS.UNPROVEN)
})

test("cleanup refusal preserves earlier capabilities but overall proof is unproven", () => {
  const evidence = completeEvidence()
  evidence.cleanup.T2.worktreeRemoved = false
  const result = classifyExecutorLaneE2E(evidence)
  assert.equal(result.capabilities.deterministicIntegration, STATUS.PROVEN)
  assert.equal(result.capabilities.safeCleanup, STATUS.UNPROVEN)
  assert.equal(result.status, STATUS.UNPROVEN)
})

test("agent prose without runtime evidence cannot prove the E2E", () => {
  const result = classifyExecutorLaneE2E({ narrative: "all lanes completed successfully" })
  assert.equal(result.status, STATUS.UNPROVEN)
})

test("provider exhaustion before lane creation leaves missing lifecycle evidence unproven", () => {
  const result = classifyExecutorLaneE2E({
    route: { command: "/execute", agent: "Executor", planReview: "[APPROVED]" },
    capabilityGate: { status: STATUS.PROVEN },
    permissionApproval: {
      status: STATUS.PROVEN,
      mechanism: "probe-local-adapter",
      authorizedByUser: true,
      policyReady: true,
      allowedCount: 1,
      deniedCount: 0,
    },
    integration: { strategy: "MERGE_NO_FF", order: [], results: [], conflict: false },
    execution: { exitCode: 2, usageLimitReached: true },
    modelRequests: [{ provider: "openai", model: "gpt-5.6-luna", reasoning: "high" }],
  })
  const classified = result
  assert.equal(classified.capabilities.actualExecutorRoute, STATUS.PROVEN)
  assert.equal(classified.capabilities.capabilityGate, STATUS.PROVEN)
  assert.equal(classified.capabilities.deterministicIntegration, STATUS.UNPROVEN)
  assert.equal(classified.status, STATUS.UNPROVEN)
})

test("verdict extraction ignores user instructions and preserves an incomplete review as unproven", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(`
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    `)
    const insertMessage = db.prepare("INSERT INTO message VALUES (?, 'ses_review', ?, ?)")
    const insertPart = db.prepare("INSERT INTO part VALUES (?, ?, 'ses_review', ?, ?)")
    insertMessage.run("msg_user", 1, JSON.stringify({ role: "user" }))
    insertPart.run("part_user", "msg_user", 1, JSON.stringify({ type: "text", text: "Return [APPROVED] or [REJECTED]." }))
    insertMessage.run("msg_incomplete", 2, JSON.stringify({ role: "assistant", error: { data: { message: "The usage limit has been reached" } } }))
    insertPart.run("part_reasoning", "msg_incomplete", 2, JSON.stringify({ type: "reasoning", text: "Reviewing" }))
    assert.equal(sessionText(db, "ses_review"), "")
    assert.equal(finalVerdict(sessionText(db, "ses_review"), "[APPROVED]", "[REJECTED]"), undefined)

    insertMessage.run("msg_approved", 3, JSON.stringify({ role: "assistant", finish: "stop" }))
    insertPart.run("part_approved", "msg_approved", 3, JSON.stringify({ type: "text", text: "[APPROVED] The plan is executable." }))
    assert.equal(finalVerdict(sessionText(db, "ses_review"), "[APPROVED]", "[REJECTED]"), "[APPROVED]")
  } finally {
    db.close()
  }
})
