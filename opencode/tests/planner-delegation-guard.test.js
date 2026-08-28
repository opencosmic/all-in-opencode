import test from "node:test"
import assert from "node:assert/strict"

import {
  default as createGuard,
  evaluatePlannerDelegation,
  extractAgentName,
  isPlannerIdentity,
} from "../plugins/planner-delegation-guard.js"

test("extracts string and object agent names defensively", () => {
  assert.equal(extractAgentName("Planner"), "Planner")
  assert.equal(extractAgentName({ name: "Planner" }), "Planner")
  assert.equal(extractAgentName({ name: 42 }), "")
  assert.equal(extractAgentName(undefined), "")
})

test("matches only the exact normalized Planner identity", () => {
  assert.equal(isPlannerIdentity("Planner"), true)
  assert.equal(isPlannerIdentity("planner"), true)
  assert.equal(isPlannerIdentity({ name: "Planner" }), true)
  assert.equal(isPlannerIdentity("\u200BPlanner\u2060"), true)
  assert.equal(isPlannerIdentity("My Planner Helper"), false)
  assert.equal(isPlannerIdentity({ name: "Plan Reviewer" }), false)
  assert.equal(isPlannerIdentity("Plan"), false)
  assert.equal(isPlannerIdentity("Prometheus - Plan Builder"), false)
  assert.equal(isPlannerIdentity(undefined), false)
})

test("allows only explicit consultation task targets", () => {
  for (const target of ["Plan Reviewer", "Explore", "Librarian", "Oracle"]) {
    assert.equal(evaluatePlannerDelegation("task", { subagent_type: target }).allowed, true)
  }
})

test("blocks every task_id continuation shape before target evaluation", () => {
  for (const args of [
    { task_id: "ses_x" },
    { task_id: "" },
    { task_id: null, subagent_type: "Explore" },
    { task_id: "ses_x", subagent_type: "Explore" },
    { task_id: "ses_x", subagent_type: "Librarian" },
    { task_id: "ses_x", subagent_type: "Oracle" },
    { task_id: "ses_x", subagent_type: "Plan Reviewer" },
    { task_id: "ses_x", category: "quick" },
    { task_id: "ses_x", category: "deep", subagent_type: "Explore" },
  ]) {
    assert.equal(evaluatePlannerDelegation("task", args).allowed, false)
  }
})

test("blocks categories, implementation agents, and missing fresh targets", () => {
  assert.equal(evaluatePlannerDelegation("task", { category: "quick" }).allowed, false)
  assert.equal(evaluatePlannerDelegation("task", { subagent_type: "sisyphus-junior" }).allowed, false)
  assert.equal(evaluatePlannerDelegation("task", { subagent_type: "hephaestus" }).allowed, false)
  assert.equal(evaluatePlannerDelegation("task", {}).allowed, false)
})

test("call_omo_agent remains bounded to its read-only runtime targets", () => {
  assert.equal(evaluatePlannerDelegation("call_omo_agent", { subagent_type: "explore" }).allowed, true)
  assert.equal(evaluatePlannerDelegation("call_omo_agent", { subagent_type: "librarian" }).allowed, true)
  assert.equal(evaluatePlannerDelegation("call_omo_agent", { subagent_type: "oracle" }).allowed, false)
})

test("does not alter non-delegation tools", () => {
  assert.equal(evaluatePlannerDelegation("read", { filePath: "src/app.js" }).allowed, true)
})

test("runtime hook blocks only the exact planner session", async () => {
  const hooks = await createGuard()
  await hooks["chat.params"]({ sessionID: "planner-string", agent: "Planner" })
  await hooks["chat.params"]({ sessionID: "planner-object", agent: { name: "Planner" } })
  await hooks["chat.params"]({ sessionID: "executor", agent: "Executor" })
  await hooks["chat.params"]({ sessionID: "prometheus", agent: "Prometheus - Plan Builder" })

  await assert.rejects(
    hooks["tool.execute.before"](
      { sessionID: "planner-string", tool: "task" },
      { args: { category: "quick", prompt: "implement" } },
    ),
    /cannot dispatch category implementation workers/,
  )

  await assert.rejects(
    hooks["tool.execute.before"](
      { sessionID: "planner-object", tool: "task" },
      { args: { task_id: "ses_impl", subagent_type: "Explore", prompt: "continue" } },
    ),
    /cannot continue task sessions/,
  )

  await assert.doesNotReject(
    hooks["tool.execute.before"](
      { sessionID: "planner-string", tool: "task" },
      { args: { subagent_type: "Plan Reviewer", prompt: "review" } },
    ),
  )

  await assert.doesNotReject(
    hooks["tool.execute.before"](
      { sessionID: "executor", tool: "task" },
      { args: { category: "quick", prompt: "implement" } },
    ),
  )

  await assert.doesNotReject(
    hooks["tool.execute.before"](
      { sessionID: "prometheus", tool: "task" },
      { args: { category: "quick", prompt: "native behavior" } },
    ),
  )
})
