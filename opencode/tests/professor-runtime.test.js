import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  canonicalizeUrl,
  transitionState,
} from "../plugins/professor/state.js"
import { createProfessorRuntime } from "../plugins/professor/runtime.js"
import { createProfessorStore } from "../plugins/professor/store.js"

function plan(questionCount = 1) {
  return Array.from({ length: questionCount }, (_, index) => ({
    question: `Question ${index + 1}`,
    priority: index === 0 ? "critical" : index === 1 ? "high" : "normal",
    evidenceNeeded: [`evidence ${index + 1}`],
    completionCriteria: index === 0 ? ["primary source", "independent confirmation"] : ["sufficient evidence"],
  }))
}

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "professor-runtime-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  let runNumber = 0
  const runtime = createProfessorRuntime({
    stateDirectory: root,
    generateRunId: () => `run-test-${++runNumber}`,
    ...options,
  })
  return { root, runtime }
}

async function startAndNext(t, questionCount = 1, options = {}) {
  const fixtureState = await fixture(t, options)
  const started = await fixtureState.runtime.start({ objective: "Evaluate the research objective.", questions: plan(questionCount), ...options.start })
  const next = await fixtureState.runtime.next({ runId: started.runId })
  return { ...fixtureState, started, next }
}

async function commitSummary(runtime, runId, taskId, summary = "completed") {
  return runtime.commit({ runId, taskId, summary })
}

test("run creation assigns internal IDs, persists state, and writes initial events", async (t) => {
  const { root, runtime } = await fixture(t)
  const started = await runtime.start({ objective: "Plan a grounded investigation.", questions: plan(2) })
  const state = await runtime.load(started.runId)
  const events = await runtime.store.readEvents(started.runId)

  assert.match(started.runId, /^run-test-1$/)
  assert.equal(state.status, "researching")
  assert.equal(state.questions.length, 2)
  assert.equal(state.tasks.length, 2)
  assert.deepEqual(events.map((event) => event.type), [
    "research.started",
    "plan.created",
    "task.created",
    "task.created",
  ])
  assert.equal(JSON.parse(await readFile(join(root, "runs", started.runId, "state.json"), "utf8")).runId, started.runId)
})

test("invalid objectives, plans, criteria, and budgets fail closed", async (t) => {
  const { runtime } = await fixture(t)
  await assert.rejects(runtime.start({ objective: "", questions: plan() }), /objective must be a non-empty string/)
  await assert.rejects(runtime.start({ objective: "x", questions: [] }), /at least one question/)
  await assert.rejects(runtime.start({ objective: "x", questions: [{ ...plan()[0], completionCriteria: ["same", "same"] }] }), /duplicate completion criterion/)
  await assert.rejects(runtime.start({ objective: "x", questions: [{ ...plan()[0], completionCriteria: [""] }] }), /completion criterion/)
  await assert.rejects(runtime.start({ objective: "x", questions: plan(), budget: { maxControllerRounds: 0 } }), /budget.maxControllerRounds/)
  await assert.rejects(runtime.start({ objective: "x", questions: plan(2), budget: { maxTasks: 1 } }), /maxTasks cannot be smaller/)
})

test("frontier ordering is priority-first with stable FIFO ties and one running task", async (t) => {
  const { runtime, started } = await (async () => {
    const value = await fixture(t)
    const result = await value.runtime.start({ objective: "Order tasks.", questions: [
      { question: "Critical one", priority: "critical", evidenceNeeded: ["a"], completionCriteria: ["a"] },
      { question: "Critical two", priority: "critical", evidenceNeeded: ["b"], completionCriteria: ["b"] },
      { question: "High", priority: "high", evidenceNeeded: ["c"], completionCriteria: ["c"] },
    ] })
    return { ...value, started: result }
  })()
  const first = await runtime.next({ runId: started.runId })
  const reused = await runtime.next({ runId: started.runId })
  assert.equal(first.task.objective, "Critical one")
  assert.equal(reused.reused, true)
  await commitSummary(runtime, started.runId, first.task.taskId)
  const second = await runtime.next({ runId: started.runId })
  assert.equal(second.task.objective, "Critical two")
  await commitSummary(runtime, started.runId, second.task.taskId)
  const third = await runtime.next({ runId: started.runId })
  assert.equal(third.task.objective, "High")
})

test("task lifecycle rejects unknown, non-running, and duplicate completion", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await assert.rejects(runtime.commit({ runId: started.runId, taskId: "task-9999", summary: "x" }), /unknown task/)
  await commitSummary(runtime, started.runId, next.task.taskId)
  await assert.rejects(runtime.commit({ runId: started.runId, taskId: next.task.taskId, summary: "again" }), /not running/)
})

test("a failed task is durable and does not create a second running task", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({ runId: started.runId, taskId: next.task.taskId, failed: true, summary: "The source was unavailable." })
  const state = await runtime.load(started.runId)
  assert.equal(state.tasks[0].status, "failed")
  assert.equal(state.counters.tasksFailed, 1)
  assert.equal(state.tasks.filter((task) => task.status === "running").length, 0)
})

test("follow-up tasks are runtime-assigned and reprioritized on the frontier", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  const committed = await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "initial result",
    followUpTasks: [
      { questionId: next.task.questionId, objective: "Normal follow-up", priority: "normal", type: "follow-up", reason: "context" },
      { questionId: next.task.questionId, objective: "Critical follow-up", priority: "critical", type: "gap-filling", reason: "critical gap" },
    ],
  })
  assert.equal(committed.created.followUpTasks.length, 2)
  const followUp = await runtime.next({ runId: started.runId })
  assert.equal(followUp.task.objective, "Critical follow-up")
})

test("controller budget stops new research and leaves exhaustion visible", async (t) => {
  const { runtime, started, next } = await startAndNext(t, 1, { start: { budget: { maxControllerRounds: 1, maxTasks: 4 } } })
  await commitSummary(runtime, started.runId, next.task.taskId)
  const stopped = await runtime.next({ runId: started.runId })
  assert.equal(stopped.task, null)
  assert.equal(stopped.status, "verifying")
  assert.equal(stopped.budgetExhausted, true)
  assert.equal((await runtime.load(started.runId)).budget.exhaustionReason, "max_controller_rounds")
})

test("URL canonicalization removes common tracking and fragments without erasing meaningful queries", () => {
  assert.equal(canonicalizeUrl("HTTPS://Example.com:443/docs/?utm_source=test#section"), "https://example.com/docs")
  assert.equal(canonicalizeUrl("https://example.com/docs?page=1"), "https://example.com/docs?page=1")
  assert.notEqual(canonicalizeUrl("https://example.com/docs?page=1"), canonicalizeUrl("https://example.com/docs?page=2"))
  assert.throws(() => canonicalizeUrl("https://user:pass@example.com/private"), /credentials/)
})

test("source deduplication preserves useful original citation URLs", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "sources",
    sources: [
      { url: "https://Example.com/doc?utm_medium=test#section", title: "Document", sourceKey: "one" },
      { url: "https://example.com/doc#other-section", title: "Same document", sourceKey: "two" },
      { url: "https://example.com/doc?page=1", title: "Different query" },
    ],
  })
  const state = await runtime.load(started.runId)
  assert.equal(state.sources.length, 2)
  assert.equal(state.sources[0].canonicalUrl, "https://example.com/doc")
  assert.ok(state.sources[0].observedUrls.includes("https://Example.com/doc?utm_medium=test#section"))
})

test("evidence, findings, and contradictions cannot reference unknown state", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  const base = {
    runId: started.runId,
    taskId: next.task.taskId,
    sources: [{ url: "https://example.com/source", sourceKey: "source" }],
  }
  await assert.rejects(runtime.commit({ ...base, evidence: [{ questionId: "question-9999", sourceKey: "source", fact: "x", supportingSpan: "x", relation: "supports" }] }), /unknown question/)
  await assert.rejects(runtime.commit({ ...base, evidence: [{ questionId: next.task.questionId, sourceId: "source-9999", fact: "x", supportingSpan: "x", relation: "supports" }] }), /unknown source/)
  await assert.rejects(runtime.commit({ ...base, findings: [{ questionId: next.task.questionId, evidenceIds: ["evidence-9999"], statement: "x" }] }), /unknown evidence/)
  await assert.rejects(runtime.commit({ ...base, contradictions: [{ questionId: next.task.questionId, proposition: "x", sideA: { evidenceIds: ["evidence-9999"] }, sideB: { evidenceIds: ["evidence-9999"] } }] }), /unknown evidence/)
})

test("coverage is derived from criteria rather than a model percentage", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "one criterion",
    questionUpdates: [{ questionId: next.task.questionId, criteriaSatisfied: ["primary source"] }],
  })
  const digest = (await runtime.state({ runId: started.runId })).digest
  assert.deepEqual(digest.questions[0].coverage, { satisfied: 1, total: 2, percentage: 50, complete: false })
})

test("verification blocks critical weak claims and follows the loop back to research", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "weak evidence",
    sources: [{ url: "https://example.com/weak", sourceKey: "weak" }],
    evidence: [{ questionId: next.task.questionId, sourceKey: "weak", fact: "Limited fact", supportingSpan: "A limited source statement.", relation: "context" }],
  })
  const verification = await runtime.verify({
    runId: started.runId,
    claims: [{ statement: "A strong conclusion", evidenceIds: ["evidence-0001"], critical: true, verification: "UNSUPPORTED" }],
  })
  assert.equal(verification.needsMoreResearch, true)
  assert.equal(verification.status, "researching")
  await assert.rejects(runtime.complete({ runId: started.runId, report: "premature" }), /requires writing phase/)
})

test("open critical contradictions prevent a normal verification finish", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "conflicting evidence",
    sources: [
      { url: "https://example.com/a", sourceKey: "a" },
      { url: "https://example.com/b", sourceKey: "b" },
    ],
    evidence: [
      { questionId: next.task.questionId, sourceKey: "a", fact: "A", supportingSpan: "Source A says A.", relation: "supports" },
      { questionId: next.task.questionId, sourceKey: "b", fact: "B", supportingSpan: "Source B says B.", relation: "contradicts" },
    ],
    contradictions: [{ questionId: next.task.questionId, proposition: "A or B is current", critical: true, sideA: { evidenceIndexes: [0] }, sideB: { evidenceIndexes: [1] } }],
    questionUpdates: [{ questionId: next.task.questionId, criteriaSatisfied: ["primary source", "independent confirmation"] }],
  })
  const verification = await runtime.verify({
    runId: started.runId,
    claims: [{ statement: "The sources agree", evidenceIds: ["evidence-0001", "evidence-0002"], critical: true, verification: "SUPPORTED" }],
  })
  assert.equal(verification.needsMoreResearch, true)
  assert.equal(verification.blockers.openCriticalContradictions.length, 1)
})

test("supported claims become writing-eligible and complete persists a report", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "supported evidence",
    sources: [{ url: "https://example.com/official", sourceKey: "official" }],
    evidence: [{ questionId: next.task.questionId, sourceKey: "official", fact: "Fact", supportingSpan: "Official source supports the fact.", relation: "supports" }],
    questionUpdates: [{ questionId: next.task.questionId, criteriaSatisfied: ["primary source", "independent confirmation"] }],
  })
  const verification = await runtime.verify({
    runId: started.runId,
    claims: [{ statement: "Fact is supported", evidenceIds: ["evidence-0001"], critical: true, verification: "SUPPORTED" }],
  })
  assert.equal(verification.status, "writing")
  const completed = await runtime.complete({ runId: started.runId, report: "Fact is supported by [the official source](https://example.com/official)." })
  assert.equal(completed.status, "completed")
  assert.match(await readFile(completed.reportPath, "utf8"), /official source/)
  assert.equal((await runtime.load(started.runId)).status, "completed")
})

test("budget-exhausted completion appends an explicit limitation for unresolved claims", async (t) => {
  const { runtime, started, next } = await startAndNext(t, 1, { start: { budget: { maxControllerRounds: 1, maxTasks: 2 } } })
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "insufficient evidence",
  })
  await runtime.next({ runId: started.runId })
  const verification = await runtime.verify({
    runId: started.runId,
    claims: [{ statement: "An unsupported conclusion", evidenceIds: [], critical: true, verification: "UNSUPPORTED" }],
  })
  assert.equal(verification.status, "writing")
  const completed = await runtime.complete({ runId: started.runId, report: "The available evidence is insufficient." })
  assert.deepEqual(completed.limitations, [
    "- Research budget exhausted (max_controller_rounds).",
    "- Critical question question-0001 remains pending at 0/2 required criteria.",
    "- Critical claim claim-0001 is UNSUPPORTED: An unsupported conclusion",
  ])
  assert.match(await readFile(completed.reportPath, "utf8"), /## Research limitations/)
})

test("persistence survives runtime recreation and event order remains durable", async (t) => {
  const { root, runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "persisted",
    sources: [{ url: "https://example.com/persisted" }],
    evidence: [{ questionId: next.task.questionId, sourceIndex: 0, fact: "Persisted fact", supportingSpan: "Persisted source span.", relation: "supports" }],
  })
  const recreated = createProfessorRuntime({ store: createProfessorStore(root), generateRunId: () => "run-unused" })
  const loaded = await recreated.load(started.runId)
  const events = await recreated.store.readEvents(started.runId)
  assert.equal(loaded.evidence.length, 1)
  assert.equal(loaded.tasks[0].status, "completed")
  assert.equal(events.at(-1).type, "task.completed")
  const persisted = await readFile(join(root, "runs", started.runId, "state.json"), "utf8")
  assert.doesNotThrow(() => JSON.parse(persisted))
})

test("run IDs and persisted paths are traversal-safe", async (t) => {
  const { root, runtime } = await fixture(t, { generateRunId: () => "../escape" })
  await assert.rejects(runtime.start({ objective: "x", questions: plan() }), /safe generated identifier/)
  const store = createProfessorStore(root)
  assert.throws(() => store.paths("../../outside"), /safe generated identifier/)
})

test("phase transitions allow only the V1 lifecycle", () => {
  const state = { status: "planning" }
  transitionState(state, "researching")
  transitionState(state, "verifying")
  transitionState(state, "writing")
  transitionState(state, "completed")
  assert.throws(() => transitionState(state, "researching"), /invalid research phase transition/)
})
