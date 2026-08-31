import test from "node:test"
import assert from "node:assert/strict"

import {
  classifyNestedRuntime,
  nestedDirectoryWasOmitted,
} from "../../scripts/probes/worktree-nested-runtime.mjs"
import { STATUS } from "../../scripts/probes/worktree-isolation.mjs"

const paths = {
  base: "/tmp/probe/base",
  a: "/tmp/probe/worktree-a",
  b: "/tmp/probe/worktree-b",
  common: "/tmp/probe/base/.git",
}

function expected() {
  return {
    outer: {
      directory: paths.a,
      branch: "probe-a",
      commonDir: paths.common,
      command: "exec node /tmp/probe/identity.mjs OUTER",
    },
    nested: {
      directory: paths.a,
      branch: "probe-a",
      commonDir: paths.common,
      command: "exec node /tmp/probe/identity.mjs NESTED",
    },
  }
}

function measuredWorker(role, sessionID, parentID, expectedWorker, overrides = {}) {
  return {
    session: {
      id: sessionID,
      parent_id: parentID,
      directory: expectedWorker.directory,
    },
    tool: {
      status: "completed",
      command: expectedWorker.command,
    },
    record: {
      role,
      completed: true,
      pid: role === "OUTER" ? 101 : 202,
      pwd: expectedWorker.directory,
      gitTopLevel: expectedWorker.directory,
      branch: expectedWorker.branch,
      gitCommonDir: expectedWorker.commonDir,
    },
    ...overrides,
  }
}

function completeInput() {
  const exp = expected()
  return {
    expected: exp,
    outer: measuredWorker("OUTER", "ses_outer", "ses_parent", exp.outer),
    nested: measuredWorker("NESTED", "ses_nested", "ses_outer", exp.nested),
    delegations: {
      outer: { count: 1, input: { subagent_type: "plan", directory: paths.a } },
      nested: { count: 1, input: { category: "nested-probe", run_in_background: false } },
    },
    permissions: {
      outer: { task: true, bash: true },
      nested: { task: false, bash: true },
    },
    sentinels: {
      exercised: true,
      outerConfined: true,
      nestedConfined: true,
      parentUnaffected: true,
      siblingUnaffected: true,
    },
    bookkeeping: { base: [], worktreeA: [], worktreeB: [] },
    modelRequests: [{ provider: "openai", model: "gpt-5.6-luna", reasoning: "high" }],
  }
}

test("complete two-level inherited chain is PROVEN", () => {
  const result = classifyNestedRuntime(completeInput())
  assert.equal(result.nestedRuntimePreservation, STATUS.PROVEN)
  assert.equal(result.nestedMutationConfinement, STATUS.PROVEN)
  assert.equal(result.parentWorkerMutationConfinement, STATUS.PROVEN)
  assert.equal(result.proof.nestedDirectoryOmitted, true)
  assert.equal(result.proof.parentageProven, true)
  assert.equal(result.proof.sessionInheritanceProven, true)
  assert.equal(result.proof.outerToolIntrinsic, true)
  assert.equal(result.proof.nestedToolIntrinsic, true)
})

test("explicit nested directory invalidates inheritance proof", () => {
  const input = completeInput()
  input.delegations.nested.input.directory = paths.a
  assert.equal(nestedDirectoryWasOmitted(input.delegations.nested), false)
  assert.equal(classifyNestedRuntime(input).nestedRuntimePreservation, STATUS.UNPROVEN)
})

test("nested execution from base is FAILED", () => {
  const input = completeInput()
  input.nested.session.directory = paths.base
  input.nested.record.pwd = paths.base
  input.nested.record.gitTopLevel = paths.base
  input.nested.record.branch = "master"
  input.sentinels.nestedConfined = false
  assert.equal(classifyNestedRuntime(input).nestedRuntimePreservation, STATUS.FAILED)
})

test("nested execution from sibling B is FAILED", () => {
  const input = completeInput()
  input.nested.session.directory = paths.b
  input.nested.record.pwd = paths.b
  input.nested.record.gitTopLevel = paths.b
  input.nested.record.branch = "probe-b"
  input.sentinels.nestedConfined = false
  assert.equal(classifyNestedRuntime(input).nestedRuntimePreservation, STATUS.FAILED)
})

test("missing nested tool remains UNPROVEN", () => {
  const input = completeInput()
  input.nested.tool = null
  input.nested.record = null
  assert.equal(classifyNestedRuntime(input).nestedRuntimePreservation, STATUS.UNPROVEN)
  assert.equal(classifyNestedRuntime(input).nestedMutationConfinement, STATUS.UNPROVEN)
})

test("missing nested parentID remains UNPROVEN", () => {
  const input = completeInput()
  input.nested.session.parent_id = null
  assert.equal(classifyNestedRuntime(input).nestedRuntimePreservation, STATUS.UNPROVEN)
})

test("missing proof of omitted directory remains UNPROVEN", () => {
  const input = completeInput()
  input.delegations.nested = { count: 0 }
  assert.equal(classifyNestedRuntime(input).nestedRuntimePreservation, STATUS.UNPROVEN)
})

test("agent prose alone cannot prove nested inheritance", () => {
  const input = completeInput()
  input.outer = { assistantProse: "I ran from worktree A" }
  input.nested = { assistantProse: "I inherited worktree A" }
  input.delegations = {}
  input.sentinels = undefined
  assert.equal(classifyNestedRuntime(input).nestedRuntimePreservation, STATUS.UNPROVEN)
})

test("nested task permission must be mechanically denied", () => {
  const input = completeInput()
  input.permissions.nested.task = true
  assert.equal(classifyNestedRuntime(input).nestedRuntimePreservation, STATUS.UNPROVEN)
})

test("tool-level workdir override invalidates intrinsic CWD proof", () => {
  const input = completeInput()
  input.nested.tool.workdir = paths.a
  const result = classifyNestedRuntime(input)
  assert.equal(result.nestedActualCwd, STATUS.UNPROVEN)
  assert.equal(result.nestedRuntimePreservation, STATUS.UNPROVEN)
  assert.equal(result.nestedMutationConfinement, STATUS.UNPROVEN)
})

test("OMO bookkeeping remains independent from nested confinement", () => {
  const input = completeInput()
  input.bookkeeping.base = ["ses_parent.json"]
  const result = classifyNestedRuntime(input)
  assert.equal(result.nestedRuntimePreservation, STATUS.PROVEN)
  assert.equal(result.nestedMutationConfinement, STATUS.PROVEN)
  assert.equal(result.parentWorkerMutationConfinement, STATUS.PROVEN)
  assert.equal(result.parentRuntimeBookkeepingCleanliness, STATUS.FAILED)
})

test("unexpected runtime model invalidates otherwise complete evidence", () => {
  const input = completeInput()
  input.modelRequests.push({ provider: "example", model: "forbidden", reasoning: "low" })
  const result = classifyNestedRuntime(input)
  assert.equal(result.modelProviderCompliance, STATUS.FAILED)
  assert.equal(result.nestedRuntimePreservation, STATUS.UNPROVEN)
})

test("unrecorded reasoning invalidates otherwise complete evidence", () => {
  const input = completeInput()
  delete input.modelRequests[0].reasoning
  const result = classifyNestedRuntime(input)
  assert.equal(result.modelProviderCompliance, STATUS.FAILED)
  assert.equal(result.nestedRuntimePreservation, STATUS.UNPROVEN)
})
