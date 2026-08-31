import test from "node:test"
import assert from "node:assert/strict"

import {
  classifyConcurrentRuntime,
  classifySiblingMutation,
  classifyTemporalOverlap,
  classifyWorkerRuntime,
} from "../../scripts/probes/worktree-concurrent-runtime.mjs"
import { STATUS } from "../../scripts/probes/worktree-isolation.mjs"

function record(worker, peer, start, end, overrides = {}) {
  return {
    worker,
    peer,
    pid: worker === "A" ? 101 : 202,
    start: String(start),
    end: String(end),
    peerObserved: true,
    completed: true,
    ...overrides,
  }
}

function sentinels(overrides = {}) {
  return {
    exercised: true,
    workerAValid: true,
    workerBValid: true,
    siblingIsolated: true,
    parentUnaffected: true,
    ...overrides,
  }
}

function measuredWorker(label, expected, interval) {
  return {
    session: { id: `ses_${label}`, directory: expected.directory },
    tool: { status: "completed", command: expected.command },
    record: {
      ...record(label, label === "A" ? "B" : "A", interval[0], interval[1]),
      pwd: expected.directory,
      gitTopLevel: expected.directory,
      branch: expected.branch,
      gitCommonDir: expected.commonDir,
    },
  }
}

test("incomplete overlap evidence remains UNPROVEN", () => {
  assert.equal(classifyTemporalOverlap({ A: record("A", "B", 100, 300) }).status, STATUS.UNPROVEN)
})

test("completed sequential tool intervals are FAILED", () => {
  const result = classifyTemporalOverlap({
    A: record("A", "B", 100, 200),
    B: record("B", "A", 200, 300),
  })
  assert.equal(result.status, STATUS.FAILED)
  assert.equal(result.mechanicallyOverlapped, false)
})

test("completed overlapping intervals with a causal barrier are PROVEN", () => {
  const result = classifyTemporalOverlap({
    A: record("A", "B", 100, 400),
    B: record("B", "A", 200, 300),
  })
  assert.equal(result.status, STATUS.PROVEN)
  assert.equal(result.mechanicallyOverlapped, true)
  assert.equal(result.latestStart, "200")
  assert.equal(result.earliestEnd, "300")
})

test("overlap without internally consistent barrier evidence remains UNPROVEN", () => {
  const result = classifyTemporalOverlap({
    A: record("A", "B", 100, 400, { peerObserved: false }),
    B: record("B", "A", 200, 300),
  })
  assert.equal(result.status, STATUS.UNPROVEN)
  assert.equal(result.mechanicallyOverlapped, true)
})

test("cross-write mechanically fails sibling confinement", () => {
  const result = classifySiblingMutation({
    workers: {
      A: { tool: { status: "completed" }, record: { completed: true } },
      B: { tool: { status: "completed" }, record: { completed: true } },
    },
    sentinels: sentinels({ siblingIsolated: false }),
  })
  assert.equal(result.siblingMutationConfinement, STATUS.FAILED)
  assert.equal(result.parentWorkerMutationConfinement, STATUS.PROVEN)
})

test("missing worker evidence keeps mutation confinement UNPROVEN", () => {
  const result = classifySiblingMutation({
    workers: { A: { tool: { status: "completed" }, record: { completed: true } } },
    sentinels: sentinels(),
  })
  assert.equal(result.siblingMutationConfinement, STATUS.UNPROVEN)
  assert.equal(result.parentWorkerMutationConfinement, STATUS.UNPROVEN)
})

test("worker runtime requires session, intrinsic CWD, Git identity, and exact no-cd command", () => {
  const expected = {
    directory: "/tmp/probe/worktree-a",
    branch: "probe-a",
    commonDir: "/tmp/probe/base/.git",
    command: "exec node /tmp/probe/coord/worker.mjs A",
  }
  const observed = measuredWorker("A", expected, [100, 200])
  assert.equal(classifyWorkerRuntime(expected, observed), STATUS.PROVEN)
  observed.tool.command = "cd /tmp/probe/worktree-a; exec node worker.mjs A"
  assert.equal(classifyWorkerRuntime(expected, observed), STATUS.FAILED)
})

test("OMO bookkeeping failure remains independent from proven worker mutation confinement", () => {
  const expected = {
    A: { directory: "/tmp/probe/a", branch: "a", commonDir: "/tmp/probe/base/.git", command: "exec node worker.mjs A" },
    B: { directory: "/tmp/probe/b", branch: "b", commonDir: "/tmp/probe/base/.git", command: "exec node worker.mjs B" },
  }
  const result = classifyConcurrentRuntime({
    expected,
    workers: {
      A: measuredWorker("A", expected.A, [100, 400]),
      B: measuredWorker("B", expected.B, [200, 300]),
    },
    sentinels: sentinels(),
    bookkeeping: { base: ["ses_parent.json"], worktreeA: ["ses_a.json"], worktreeB: ["ses_b.json"] },
    modelRequests: [
      { provider: "openai", model: "gpt-5.6-luna", reasoning: "high" },
    ],
  })
  assert.equal(result.concurrentSiblingToolIsolation, STATUS.PROVEN)
  assert.equal(result.temporalOverlap, STATUS.PROVEN)
  assert.equal(result.siblingMutationConfinement, STATUS.PROVEN)
  assert.equal(result.parentWorkerMutationConfinement, STATUS.PROVEN)
  assert.equal(result.parentRuntimeBookkeepingCleanliness, STATUS.FAILED)
})

test("an unexpected runtime model invalidates otherwise complete evidence", () => {
  const expected = {
    A: { directory: "/tmp/probe/a", branch: "a", commonDir: "/tmp/probe/base/.git", command: "exec node worker.mjs A" },
    B: { directory: "/tmp/probe/b", branch: "b", commonDir: "/tmp/probe/base/.git", command: "exec node worker.mjs B" },
  }
  const result = classifyConcurrentRuntime({
    expected,
    workers: {
      A: measuredWorker("A", expected.A, [100, 400]),
      B: measuredWorker("B", expected.B, [200, 300]),
    },
    sentinels: sentinels(),
    bookkeeping: { base: [] },
    modelRequests: [{ provider: "example", model: "forbidden", reasoning: "low" }],
  })
  assert.equal(result.modelProviderCompliance, STATUS.FAILED)
  assert.equal(result.concurrentSiblingToolIsolation, STATUS.UNPROVEN)
  assert.equal(result.temporalOverlap, STATUS.UNPROVEN)
})
