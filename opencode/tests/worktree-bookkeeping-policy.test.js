import test from "node:test"
import assert from "node:assert/strict"

import {
  MUTATION_PROVENANCE,
  STATUS,
  approvedOmoRuntimeBookkeepingPaths,
  assessWorkerIsolationPolicy,
  classifyOmoRuntimeBookkeeping,
} from "../../scripts/probes/worktree-isolation.mjs"

const base = "/tmp/bookkeeping-policy/base"
const laneA = "/tmp/bookkeeping-policy/worktree-a"
const laneB = "/tmp/bookkeeping-policy/worktree-b"

function marker(sessionID, overrides = {}) {
  return {
    sessionID,
    updatedAt: "2026-09-01T00:00:00.000Z",
    sources: {
      todo: { state: "idle", updatedAt: "2026-09-01T00:00:00.000Z" },
    },
    ...overrides,
  }
}

function knownSessions() {
  return [
    { id: "ses_parent", directory: base },
    { id: "ses_a", directory: laneA },
    { id: "ses_b", directory: laneB },
  ]
}

function knownParentMarker() {
  return {
    path: `${base}/.omo/run-continuation/ses_parent.json`,
    marker: marker("ses_parent"),
  }
}

test("known OMO bookkeeping leaves worker isolation proven while literal cleanliness fails", () => {
  const bookkeeping = classifyOmoRuntimeBookkeeping({
    markers: [knownParentMarker()],
    sessions: knownSessions(),
  })
  assert.equal(bookkeeping.classifications[0].kind, MUTATION_PROVENANCE.KNOWN_OMO_RUNTIME_BOOKKEEPING)
  assert.equal(bookkeeping.literalCleanliness, STATUS.FAILED)
  assert.equal(bookkeeping.policyStatus, STATUS.PROVEN)
  assert.equal(assessWorkerIsolationPolicy({
    workerMutationConfinement: STATUS.PROVEN,
    bookkeeping,
  }), STATUS.PROVEN)
  assert.deepEqual(approvedOmoRuntimeBookkeepingPaths({
    markers: [knownParentMarker()],
    sessions: knownSessions(),
  }), [`${base}/.omo/run-continuation/ses_parent.json`])
})

test("worker mutation escape remains a hard failure despite known bookkeeping", () => {
  const bookkeeping = classifyOmoRuntimeBookkeeping({
    markers: [knownParentMarker()],
    sessions: knownSessions(),
  })
  assert.equal(assessWorkerIsolationPolicy({
    workerMutationConfinement: STATUS.FAILED,
    bookkeeping,
  }), STATUS.FAILED)
})

test("cross-lane worker mutation remains a hard failure despite known bookkeeping", () => {
  const bookkeeping = classifyOmoRuntimeBookkeeping({
    markers: [{ path: `${laneA}/.omo/run-continuation/ses_a.json`, marker: marker("ses_a") }],
    sessions: knownSessions(),
  })
  assert.equal(assessWorkerIsolationPolicy({
    workerMutationConfinement: STATUS.FAILED,
    bookkeeping,
  }), STATUS.FAILED)
})

test("an unexpected .omo file is unknown and blocks a worker-isolation conclusion", () => {
  const bookkeeping = classifyOmoRuntimeBookkeeping({
    markers: [{ path: `${base}/.omo/unexpected-state.json`, marker: null }],
    sessions: knownSessions(),
  })
  assert.equal(bookkeeping.classifications[0].kind, MUTATION_PROVENANCE.UNKNOWN_MUTATION)
  assert.equal(bookkeeping.literalCleanliness, STATUS.FAILED)
  assert.equal(bookkeeping.policyStatus, STATUS.UNPROVEN)
  assert.equal(assessWorkerIsolationPolicy({
    workerMutationConfinement: STATUS.PROVEN,
    bookkeeping,
  }), STATUS.UNPROVEN)
  assert.throws(() => approvedOmoRuntimeBookkeepingPaths({
    markers: [{ path: `${base}/.omo/unexpected-state.json`, marker: null }],
    sessions: knownSessions(),
  }), /cleanup refused: unrecognized OMO runtime bookkeeping/)
})

test("an unknown continuation session is not automatically accepted", () => {
  const bookkeeping = classifyOmoRuntimeBookkeeping({
    markers: [{
      path: `${base}/.omo/run-continuation/ses_unknown.json`,
      marker: marker("ses_unknown"),
    }],
    sessions: knownSessions(),
  })
  assert.equal(bookkeeping.classifications[0].kind, MUTATION_PROVENANCE.UNKNOWN_MUTATION)
  assert.equal(bookkeeping.policyStatus, STATUS.UNPROVEN)
})

test("a marker must match its known session directory and writer shape", () => {
  const wrongContext = classifyOmoRuntimeBookkeeping({
    markers: [{ path: `${base}/.omo/run-continuation/ses_a.json`, marker: marker("ses_a") }],
    sessions: knownSessions(),
  })
  assert.equal(wrongContext.classifications[0].kind, MUTATION_PROVENANCE.UNKNOWN_MUTATION)

  const malformed = classifyOmoRuntimeBookkeeping({
    markers: [{
      path: `${laneA}/.omo/run-continuation/ses_a.json`,
      marker: { sessionID: "ses_a", updatedAt: "2026-09-01T00:00:00.000Z", sources: {} },
    }],
    sessions: knownSessions(),
  })
  assert.equal(malformed.classifications[0].kind, MUTATION_PROVENANCE.UNKNOWN_MUTATION)
})

test("a complete marker snapshot with no markers remains literally clean", () => {
  const bookkeeping = classifyOmoRuntimeBookkeeping({ markers: [], sessions: knownSessions() })
  assert.equal(bookkeeping.literalCleanliness, STATUS.PROVEN)
  assert.equal(bookkeeping.policyStatus, STATUS.PROVEN)
})
