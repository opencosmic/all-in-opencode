import test from "node:test"
import assert from "node:assert/strict"
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  canonicalizeUrl,
  claimStatusCounts,
  FALLBACK_CONTROLLER_ROUND_LIMIT,
  SAFE_CONTROLLER_ROUND_LIMIT,
  researchCapacity,
  transitionState,
} from "../plugins/professor/state.js"
import { createProfessorRuntime, formatDurationDisplay } from "../plugins/professor/runtime.js"
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
    libraryRoot: options.libraryRoot ?? join(root, "research-library"),
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
  return runtime.commit({
    runId,
    taskId,
    summary,
    sources: [{ url: `https://example.com/task-${taskId}` }],
  })
}

async function verifiedRun(t, { includeUnusedSource = false } = {}) {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "verified source",
    sources: [
      { url: "https://example.com/source-a", sourceKey: "source-a" },
      ...(includeUnusedSource ? [{ url: "https://example.com/source-b", sourceKey: "source-b" }] : []),
    ],
    evidence: [{ questionId: next.task.questionId, sourceKey: "source-a", fact: "Verified fact", supportingSpan: "Source A supports the verified fact.", relation: "supports" }],
    questionUpdates: [{
      questionId: next.task.questionId,
      criteriaSatisfied: [
        { criterionId: "question-0001-criterion-1", evidenceIndexes: [0] },
        { criterionId: "question-0001-criterion-2", evidenceIndexes: [0] },
      ],
    }],
  })
  await runtime.verify({
    runId: started.runId,
    claims: [{ statement: "Verified fact", evidenceIds: ["evidence-0001"], critical: true, verification: "SUPPORTED" }],
  })
  return { runtime, runId: started.runId }
}

async function prepareSupportedRun(runtime, {
  objective = "Evaluate the research objective.",
} = {}) {
  const started = await runtime.start({ objective, questions: plan() })
  const next = await runtime.next({ runId: started.runId })
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "verified source",
    sources: [{ url: "https://example.com/source-a", sourceKey: "source-a" }],
    evidence: [{ questionId: next.task.questionId, sourceKey: "source-a", fact: "Verified fact", supportingSpan: "Source A supports the verified fact.", relation: "supports" }],
    questionUpdates: [{
      questionId: next.task.questionId,
      criteriaSatisfied: [
        { criterionId: "question-0001-criterion-1", evidenceIndexes: [0] },
        { criterionId: "question-0001-criterion-2", evidenceIndexes: [0] },
      ],
    }],
  })
  await runtime.verify({
    runId: started.runId,
    claims: [{ statement: "Verified fact", evidenceIds: ["evidence-0001"], critical: true, verification: "SUPPORTED" }],
  })
  return { started }
}

async function completeSupportedRun(runtime, {
  objective = "Evaluate the research objective.",
  report = "Fact is supported by [Source A](https://example.com/source-a).",
} = {}) {
  const { started } = await prepareSupportedRun(runtime, { objective })
  const completed = await runtime.complete({ runId: started.runId, report })
  return { started, completed }
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

test("concurrent research_next calls serialize against the persisted run", async (t) => {
  const { root, runtime } = await fixture(t)
  const started = await runtime.start({ objective: "Serialize task selection.", questions: plan() })
  const results = await Promise.all([
    runtime.next({ runId: started.runId }),
    runtime.next({ runId: started.runId }),
  ])
  assert.equal(results[0].task.taskId, results[1].task.taskId)
  assert.equal(results.filter((result) => result.reused === true).length, 1)
  assert.equal((await runtime.load(started.runId)).tasks.filter((task) => task.status === "running").length, 1)
  assert.equal((await runtime.load(started.runId)).questions[0].status, "researching")

  const persisted = JSON.parse(await readFile(join(root, "runs", started.runId, "state.json"), "utf8"))
  const events = (await readFile(join(root, "runs", started.runId, "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.equal(persisted.tasks.filter((task) => task.status === "running").length, 1)
  assert.equal(events.filter((event) => event.type === "task.started").length, 1)
  assert.equal(new Set(events.map((event) => event.eventId)).size, events.length)
})

test("concurrent research_commit calls cannot complete one task twice", async (t) => {
  const { root, runtime, started, next } = await startAndNext(t)
  const results = await Promise.allSettled([
    runtime.commit({ runId: started.runId, taskId: next.task.taskId, summary: "first commit", sources: [{ url: "https://example.com/concurrent-first" }] }),
    runtime.commit({ runId: started.runId, taskId: next.task.taskId, summary: "second commit", sources: [{ url: "https://example.com/concurrent-second" }] }),
  ])
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1)
  assert.equal(results.filter((result) => result.status === "rejected").length, 1)
  assert.match(results.find((result) => result.status === "rejected").reason.message, /not running/)

  const persisted = JSON.parse(await readFile(join(root, "runs", started.runId, "state.json"), "utf8"))
  const events = (await readFile(join(root, "runs", started.runId, "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.equal(persisted.tasks[0].status, "completed")
  assert.equal(persisted.counters.tasksCompleted, 1)
  assert.equal(events.filter((event) => event.type === "task.completed").length, 1)
  assert.equal(new Set(events.map((event) => event.eventId)).size, events.length)
})

test("starting the first task moves a pending question to researching", async (t) => {
  const { runtime } = await fixture(t)
  const before = await runtime.start({ objective: "Track question lifecycle.", questions: plan() })
  assert.equal((await runtime.load(before.runId)).questions[0].status, "pending")
  await runtime.next({ runId: before.runId })
  assert.equal((await runtime.load(before.runId)).questions[0].status, "researching")
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

test("controller capacity is derived from the outer-step ceiling and reserves closure", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  assert.equal(started.digest.budget.outerStepLimit, 32)
  assert.equal(started.digest.budget.maxControllerRounds, SAFE_CONTROLLER_ROUND_LIMIT)
  assert.equal(started.digest.budget.capacity.controllerRoundLimit, FALLBACK_CONTROLLER_ROUND_LIMIT)
  assert.equal(started.digest.budget.capacity.outerStepObservationAvailable, false)
  assert.equal(started.digest.budget.capacity.completionReserve, 2)
  assert.equal(next.capacity.controllerRoundsUsed, 1)
  assert.equal(next.capacity.researchRoundsRemaining, FALLBACK_CONTROLLER_ROUND_LIMIT - 2 - 1)
  assert.equal(researchCapacity(await runtime.load(started.runId)).researchRoundsRemaining, next.capacity.researchRoundsRemaining)

  const clamped = await runtime.start({ objective: "A clamped budget.", questions: plan(), budget: { maxControllerRounds: 500 } })
  assert.equal((await runtime.load(clamped.runId)).budget.maxControllerRounds, SAFE_CONTROLLER_ROUND_LIMIT)

  const bounded = await startAndNext(t, 2, { start: { budget: { maxControllerRounds: 3, completionReserve: 1, maxTasks: 4 } } })
  await bounded.runtime.commit({
    runId: bounded.started.runId,
    taskId: bounded.next.task.taskId,
    summary: "bounded first result",
    sources: [{ url: "https://example.com/bounded-first" }],
  })
  const second = await bounded.runtime.next({ runId: bounded.started.runId })
  await bounded.runtime.commit({
    runId: bounded.started.runId,
    taskId: second.task.taskId,
    summary: "bounded second result",
    sources: [{ url: "https://example.com/bounded-second" }],
  })
  const stopped = await bounded.runtime.next({ runId: bounded.started.runId })
  assert.equal(stopped.status, "verifying")
  assert.equal(stopped.task, null)
  assert.equal(stopped.budgetExhausted, true)
  assert.equal(stopped.capacity.researchRoundsRemaining, 0)
  assert.equal((await bounded.runtime.load(bounded.started.runId)).budget.exhaustionReason, "completion_reserve")
})

test("an empty successful commit is rejected without closing the running task", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await assert.rejects(runtime.commit({ runId: started.runId, taskId: next.task.taskId, summary: "I looked around" }), /canonical research result/)
  const state = await runtime.load(started.runId)
  assert.equal(state.tasks[0].status, "running")
  assert.equal(state.sources.length, 0)
  assert.equal(state.evidence.length, 0)
  assert.equal((await runtime.store.readEvents(started.runId)).filter((event) => event.type === "task.completed").length, 0)
})

test("a duplicate source does not count as canonical progress", async (t) => {
  const { runtime, started, next } = await startAndNext(t, 2)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "first source",
    sources: [{ url: "https://example.com/duplicate-source" }],
  })
  const second = await runtime.next({ runId: started.runId })
  await assert.rejects(runtime.commit({
    runId: started.runId,
    taskId: second.task.taskId,
    summary: "same source again",
    sources: [{ url: "https://example.com/duplicate-source" }],
  }), /canonical research result/)
  const state = await runtime.load(started.runId)
  assert.equal(state.sources.length, 1)
  assert.equal(state.tasks[1].status, "running")
  assert.equal((await runtime.store.readEvents(started.runId)).filter((event) => event.type === "task.completed").length, 1)
})

test("an observed URL alias does not count as canonical source progress", async (t) => {
  const { runtime, started, next } = await startAndNext(t, 2)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "canonical source",
    sources: [{ url: "https://example.com/alias-only?utm_source=first" }],
  })
  const second = await runtime.next({ runId: started.runId })
  await assert.rejects(runtime.commit({
    runId: started.runId,
    taskId: second.task.taskId,
    summary: "alias only",
    sources: [{ url: "https://example.com/alias-only#section" }],
  }), /canonical research result/)
  const state = await runtime.load(started.runId)
  assert.equal(state.sources.length, 1)
  assert.equal(state.sources[0].canonicalUrl, "https://example.com/alias-only")
  assert.equal(state.tasks[1].status, "running")
  assert.equal((await runtime.store.readEvents(started.runId)).filter((event) => event.type === "task.completed").length, 1)
})

test("a question status-only update does not count as canonical research progress", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await assert.rejects(runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "blocked without a research result",
    questionUpdates: [{ questionId: next.task.questionId, status: "blocked" }],
  }), /canonical research result/)
  const state = await runtime.load(started.runId)
  assert.equal(state.tasks[0].status, "running")
  assert.equal(state.questions[0].status, "researching")
  assert.equal((await runtime.store.readEvents(started.runId)).filter((event) => event.type === "task.completed").length, 0)
})

test("question status changes remain valid alongside canonical research progress", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "blocked source result",
    sources: [{ url: "https://example.com/status-with-result" }],
    questionUpdates: [{ questionId: next.task.questionId, status: "blocked" }],
  })
  const state = await runtime.load(started.runId)
  assert.equal(state.tasks[0].status, "completed")
  assert.equal(state.questions[0].status, "blocked")
  const completed = (await runtime.store.readEvents(started.runId)).find((event) => event.type === "task.completed")
  assert.equal(completed.data.criteria, 0)
  assert.equal(completed.data.canonicalResult, true)
})

test("criterion-only progress is durable completion progress", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "record evidence before coverage update",
    sources: [{ url: "https://example.com/criterion-only", sourceKey: "criterion-only" }],
    evidence: [{ questionId: next.task.questionId, sourceKey: "criterion-only", fact: "Criterion fact", supportingSpan: "The source supports the criterion.", relation: "supports" }],
  })
  const gap = await runtime.next({ runId: started.runId })
  await runtime.commit({
    runId: started.runId,
    taskId: gap.task.taskId,
    summary: "apply existing evidence to criterion",
    questionUpdates: [{
      questionId: gap.task.questionId,
      criteriaSatisfied: [{ criterionId: "question-0001-criterion-1", evidenceIds: ["evidence-0001"] }],
    }],
  })
  const completed = (await runtime.store.readEvents(started.runId)).filter((event) => event.type === "task.completed").at(-1)
  assert.equal(completed.data.sources, 0)
  assert.equal(completed.data.evidence, 0)
  assert.equal(completed.data.criteria, 1)
  assert.equal(completed.data.canonicalResult, true)
})

test("a duplicate evidence record does not count as canonical progress", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "first evidence",
    sources: [{ url: "https://example.com/duplicate-evidence", sourceKey: "duplicate-evidence" }],
    evidence: [{
      questionId: next.task.questionId,
      sourceKey: "duplicate-evidence",
      fact: "A durable fact",
      supportingSpan: "The source states the durable fact.",
      relation: "supports",
    }],
  })
  const second = await runtime.next({ runId: started.runId })
  await assert.rejects(runtime.commit({
    runId: started.runId,
    taskId: second.task.taskId,
    summary: "same evidence again",
    sources: [{ url: "https://example.com/duplicate-evidence", sourceKey: "duplicate-evidence" }],
    evidence: [{
      questionId: next.task.questionId,
      sourceKey: "duplicate-evidence",
      fact: "A durable fact",
      supportingSpan: "The source states the durable fact.",
      relation: "supports",
    }],
  }), /canonical research result/)
  const state = await runtime.load(started.runId)
  assert.equal(state.sources.length, 1)
  assert.equal(state.evidence.length, 1)
  assert.equal(state.tasks[1].status, "running")
  assert.equal((await runtime.store.readEvents(started.runId)).filter((event) => event.type === "task.completed").length, 1)
})

test("an unchanged criterion update does not count as canonical progress", async (t) => {
  const { runtime, started, next } = await startAndNext(t, 2)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "close the first question",
    sources: [{ url: "https://example.com/criterion-no-op", sourceKey: "criterion-source" }],
    evidence: [{ questionId: "question-0001", sourceKey: "criterion-source", fact: "A durable fact", supportingSpan: "The source states the durable fact.", relation: "supports" }],
    questionUpdates: [{
      questionId: "question-0001",
      criteriaSatisfied: [
        { criterionId: "question-0001-criterion-1", evidenceIndexes: [0] },
        { criterionId: "question-0001-criterion-2", evidenceIndexes: [0] },
      ],
    }],
  })
  const second = await runtime.next({ runId: started.runId })
  await assert.rejects(runtime.commit({
    runId: started.runId,
    taskId: second.task.taskId,
    summary: "repeat the same coverage",
    questionUpdates: [{
      questionId: "question-0001",
      criteriaSatisfied: [
        { criterionId: "question-0001-criterion-1", evidenceIds: ["evidence-0001"] },
        { criterionId: "question-0001-criterion-2", evidenceIds: ["evidence-0001"] },
      ],
    }],
  }), /canonical research result/)
  assert.equal((await runtime.load(started.runId)).tasks[1].status, "running")
})

test("an unchanged contradiction update does not count as canonical progress", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "record the conflict",
    sources: [
      { url: "https://example.com/contradiction-a", sourceKey: "a" },
      { url: "https://example.com/contradiction-b", sourceKey: "b" },
    ],
    evidence: [
      { questionId: "question-0001", sourceKey: "a", fact: "Side A", supportingSpan: "Source A states side A.", relation: "supports" },
      { questionId: "question-0001", sourceKey: "b", fact: "Side B", supportingSpan: "Source B states side B.", relation: "contradicts" },
    ],
    contradictions: [{
      questionId: "question-0001",
      proposition: "The sources disagree",
      critical: true,
      sideA: { evidenceIndexes: [0] },
      sideB: { evidenceIndexes: [1] },
    }],
  })
  const second = await runtime.next({ runId: started.runId })
  await assert.rejects(runtime.commit({
    runId: started.runId,
    taskId: second.task.taskId,
    summary: "repeat the open status",
    contradictionUpdates: [{ contradictionId: "contradiction-0001", status: "open" }],
  }), /canonical research result/)
  const state = await runtime.load(started.runId)
  assert.equal(state.contradictions[0].status, "open")
  assert.equal(state.tasks[1].status, "running")
})

test("a follow-up that cannot be created does not count as canonical progress", async (t) => {
  const { runtime, started, next } = await startAndNext(t, 1, { start: { budget: { maxTasks: 1 } } })
  await assert.rejects(runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "no available task slot",
    followUpTasks: [{ questionId: next.task.questionId, objective: "Unavailable follow-up", reason: "test" }],
  }), /canonical research result/)
  const state = await runtime.load(started.runId)
  assert.equal(state.tasks.length, 1)
  assert.equal(state.tasks[0].status, "running")
  assert.equal(state.budget.exhausted, false)
})

test("bounded multi-round research reaches commit, verification, and completion before the outer cap", async (t) => {
  const { runtime, started, next } = await startAndNext(t, 3, { start: { budget: { maxControllerRounds: 5, completionReserve: 1, maxTasks: 6 } } })
  const taskResults = [
    { url: "https://example.com/b6-one", questionId: "question-0001", criteria: ["question-0001-criterion-1", "question-0001-criterion-2"] },
    { url: "https://example.com/b6-two", questionId: "question-0002", criteria: ["question-0002-criterion-1"] },
    { url: "https://example.com/b6-three", questionId: "question-0003", criteria: ["question-0003-criterion-1"] },
  ]
  let current = next
  for (const [index, item] of taskResults.entries()) {
    await runtime.commit({
      runId: started.runId,
      taskId: current.task.taskId,
      summary: `bounded result ${index + 1}`,
      sources: [{ url: item.url, sourceKey: `b6-${index + 1}` }],
      evidence: [{ questionId: item.questionId, sourceKey: `b6-${index + 1}`, fact: `Bounded fact ${index + 1}`, supportingSpan: `The source supports bounded fact ${index + 1}.`, relation: "supports" }],
      questionUpdates: [{ questionId: item.questionId, criteriaSatisfied: item.criteria.map((criterionId) => ({ criterionId, evidenceIndexes: [0] })) }],
    })
    if (index < taskResults.length - 1) current = await runtime.next({ runId: started.runId })
  }
  const ready = await runtime.next({ runId: started.runId })
  assert.equal(ready.status, "verifying")
  const verification = await runtime.verify({
    runId: started.runId,
    claims: taskResults.map((item, index) => ({
      statement: `Bounded fact ${index + 1}`,
      evidenceIds: [`evidence-${String(index + 1).padStart(4, "0")}`],
      critical: index === 0,
      verification: "SUPPORTED",
    })),
  })
  assert.equal(verification.status, "writing")
  const completed = await runtime.complete({ runId: started.runId, report: "The bounded research run completed with supported findings." })
  assert.equal(completed.status, "completed")
  assert.equal(completed.metrics.claimStatusCounts.supported, 3)
  assert.ok(completed.digest.budget.capacity.controllerRoundsUsed < completed.digest.budget.outerStepLimit)
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

test("evidence citation URLs must identify their declared source document", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "canonical citations",
    sources: [{ url: "https://example.com/doc", sourceKey: "doc" }],
    evidence: [
      { questionId: next.task.questionId, sourceKey: "doc", citationUrl: "https://example.com/doc#section-4", fact: "A", supportingSpan: "Document section 4.", relation: "supports" },
      { questionId: next.task.questionId, sourceKey: "doc", citationUrl: "https://example.com/doc?utm_source=test", fact: "B", supportingSpan: "Document body.", relation: "supports" },
    ],
  })
  const state = await runtime.load(started.runId)
  assert.equal(state.evidence.length, 2)
  assert.equal(state.evidence[0].citationUrl, "https://example.com/doc#section-4")
  assert.equal(state.evidence[1].citationUrl, "https://example.com/doc?utm_source=test")
})

test("evidence rejects a citation URL from a different canonical document", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await assert.rejects(runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "bad citation",
    sources: [{ url: "https://example.com/doc", sourceKey: "doc" }],
    evidence: [{
      questionId: next.task.questionId,
      sourceKey: "doc",
      citationUrl: "https://unrelated.example.org/page",
      fact: "A",
      supportingSpan: "Unrelated citation.",
      relation: "supports",
    }],
  }), /citationUrl must identify source/)
})

test("invalid evidence is rejected atomically and leaves no source or evidence residue", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await assert.rejects(runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "missing source-local support",
    sources: [{ url: "https://example.com/atomic" }],
    evidence: [{
      questionId: next.task.questionId,
      sourceIndex: 0,
      fact: "A fact without a source span",
      supportingSpan: "   ",
      relation: "supports",
    }],
  }), /supportingSpan must be a non-empty string/)
  const state = await runtime.load(started.runId)
  assert.equal(state.tasks[0].status, "running")
  assert.equal(state.sources.length, 0)
  assert.equal(state.evidence.length, 0)
  assert.equal((await runtime.store.readEvents(started.runId)).some((event) => event.type === "source.added"), false)
})

test("sufficient-question supersession is durable and removes redundant work from the frontier", async (t) => {
  const { runtime, started, next } = await startAndNext(t, 2)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "evidence closes both planned questions",
    sources: [
      { url: "https://example.com/supersede-one", sourceKey: "one" },
      { url: "https://example.com/supersede-two", sourceKey: "two" },
    ],
    evidence: [
      { questionId: "question-0001", sourceKey: "one", fact: "Question one is answered.", supportingSpan: "Source one answers question one.", relation: "supports" },
      { questionId: "question-0002", sourceKey: "two", fact: "Question two is answered.", supportingSpan: "Source two answers question two.", relation: "supports" },
    ],
    questionUpdates: [
      { questionId: "question-0001", criteriaSatisfied: [
        { criterionId: "question-0001-criterion-1", evidenceIndexes: [0] },
        { criterionId: "question-0001-criterion-2", evidenceIndexes: [0] },
      ] },
      { questionId: "question-0002", criteriaSatisfied: [{ criterionId: "question-0002-criterion-1", evidenceIndexes: [1] }] },
    ],
  })
  const state = await runtime.load(started.runId)
  assert.equal(state.tasks[0].status, "completed")
  assert.equal(state.tasks[1].status, "superseded")
  assert.equal(state.counters.tasksSuperseded, 1)
  assert.match(state.tasks[1].supersededReason, /sufficient evidence/)
  assert.equal((await runtime.state({ runId: started.runId })).digest.pendingTasks.length, 0)
  const events = await runtime.store.readEvents(started.runId)
  assert.equal(events.filter((event) => event.type === "task.superseded").length, 1)
  const nextResult = await runtime.next({ runId: started.runId })
  assert.equal(nextResult.status, "verifying")
  assert.equal(nextResult.task, null)
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
    sources: [{ url: "https://example.com/coverage", sourceKey: "coverage" }],
    evidence: [{ questionId: next.task.questionId, sourceKey: "coverage", fact: "Primary fact", supportingSpan: "The source supports the primary criterion.", relation: "supports" }],
    questionUpdates: [{
      questionId: next.task.questionId,
      criteriaSatisfied: [{ criterionId: "question-0001-criterion-1", evidenceIndexes: [0] }],
    }],
  })
  const digest = (await runtime.state({ runId: started.runId })).digest
  assert.deepEqual(digest.questions[0].coverage, { satisfied: 1, total: 2, percentage: 50, complete: false })
})

test("a completion criterion cannot be satisfied without evidence", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await assert.rejects(runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "unsupported coverage",
    questionUpdates: [{
      questionId: next.task.questionId,
      criteriaSatisfied: [{ criterionId: "question-0001-criterion-1" }],
    }],
  }), /must reference at least one evidence record/)
  const state = await runtime.load(started.runId)
  assert.equal(state.questions[0].completionCriteria[0].satisfied, false)
  assert.equal(state.tasks[0].status, "running")
})

test("a completion criterion cannot use evidence belonging to another question", async (t) => {
  const { runtime, started, next } = await startAndNext(t, 2)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "evidence for the second question",
    sources: [{ url: "https://example.com/second", sourceKey: "second" }],
    evidence: [{ questionId: "question-0002", sourceKey: "second", fact: "Second question fact", supportingSpan: "Second question source.", relation: "supports" }],
  })
  const second = await runtime.next({ runId: started.runId })
  await assert.rejects(runtime.commit({
    runId: started.runId,
    taskId: second.task.taskId,
    summary: "cross-question coverage",
    questionUpdates: [{
      questionId: "question-0001",
      criteriaSatisfied: [{ criterionId: "question-0001-criterion-1", evidenceIds: ["evidence-0001"] }],
    }],
  }), /evidence from another question/)
})

test("same-commit evidence can back a completion criterion through its key", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "evidence-backed criterion",
    sources: [{ url: "https://example.com/criterion", sourceKey: "criterion-source" }],
    evidence: [{ questionId: next.task.questionId, sourceKey: "criterion-source", evidenceKey: " criterion-evidence ", fact: "Criterion fact", supportingSpan: "The source supports the criterion.", relation: "supports" }],
    questionUpdates: [{
      questionId: next.task.questionId,
      criteriaSatisfied: [{ criterionId: "question-0001-criterion-1", evidenceKeys: ["criterion-evidence"] }],
    }],
  })
  const state = await runtime.load(started.runId)
  assert.deepEqual(state.questions[0].completionCriteria[0].evidenceIds, ["evidence-0001"])
  assert.equal(state.questions[0].completionCriteria[0].satisfied, true)
})

test("same-commit evidence keys normalize whitespace and reject logical duplicates", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await assert.rejects(runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "duplicate evidence keys",
    sources: [{ url: "https://example.com/duplicate-key", sourceKey: "duplicate-source" }],
    evidence: [
      { questionId: next.task.questionId, sourceKey: "duplicate-source", evidenceKey: "key", fact: "A", supportingSpan: "First key.", relation: "supports" },
      { questionId: next.task.questionId, sourceKey: "duplicate-source", evidenceKey: " key ", fact: "B", supportingSpan: "Second key.", relation: "supports" },
    ],
  }), /duplicate evidenceKey: key/)
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
    questionUpdates: [{
      questionId: next.task.questionId,
      criteriaSatisfied: [
        { criterionId: "question-0001-criterion-1", evidenceIndexes: [0] },
        { criterionId: "question-0001-criterion-2", evidenceIndexes: [1] },
      ],
    }],
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
    questionUpdates: [{
      questionId: next.task.questionId,
      criteriaSatisfied: [
        { criterionId: "question-0001-criterion-1", evidenceIndexes: [0] },
        { criterionId: "question-0001-criterion-2", evidenceIndexes: [0] },
      ],
    }],
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

test("completion keeps one canonical report and exposes an idempotent human-facing symlink", async (t) => {
  const { root, runtime } = await fixture(t)
  const { completed } = await completeSupportedRun(runtime, {
    objective: "../../OpenCut: OpenCode integration?",
  })
  const libraryInfo = await lstat(completed.libraryPath)
  assert.equal(libraryInfo.isSymbolicLink(), true)
  assert.equal(await realpath(completed.libraryPath), await realpath(completed.reportPath))
  assert.equal(completed.reportPath, join(root, "runs", completed.runId, "report.md"))
  assert.notEqual(completed.libraryPath, completed.reportPath)
  assert.match(completed.libraryPath, /\d{4}-\d{2}-\d{2}-opencut-opencode-integration\.md$/)
  assert.equal((await lstat(completed.reportPath)).isFile(), true)

  const reused = await runtime.store.ensureLibraryLink(await runtime.load(completed.runId))
  assert.equal(reused.path, completed.libraryPath)
  assert.equal(reused.created, false)
  assert.equal(await realpath(reused.path), await realpath(completed.reportPath))
})

test("library collisions use suffixes without repointing unrelated links", async (t) => {
  const { root, runtime } = await fixture(t)
  const objective = "A repeatable collision-safe research topic"
  const first = await completeSupportedRun(runtime, { objective })
  const second = await completeSupportedRun(runtime, { objective })
  const third = await completeSupportedRun(runtime, { objective })
  assert.match(first.completed.libraryPath, /-a-repeatable-collision-safe-research-topic\.md$/)
  assert.match(second.completed.libraryPath, /-a-repeatable-collision-safe-research-topic-2\.md$/)
  assert.match(third.completed.libraryPath, /-a-repeatable-collision-safe-research-topic-3\.md$/)
  for (const completed of [first.completed, second.completed, third.completed]) {
    assert.equal(await realpath(completed.libraryPath), await realpath(completed.reportPath))
    assert.equal(completed.reportPath, join(root, "runs", completed.runId, "report.md"))
  }
})

test("library-link failure does not lose a completed canonical report", async (t) => {
  const { root, runtime } = await fixture(t)
  const libraryRoot = join(root, "library-root-file")
  await writeFile(libraryRoot, "not a directory", "utf8")
  const failedLinkRuntime = createProfessorRuntime({
    stateDirectory: root,
    libraryRoot,
    generateRunId: () => "run-link-failure",
  })
  const { completed } = await completeSupportedRun(failedLinkRuntime, { objective: "A report with a safe link failure" })
  assert.equal(completed.status, "completed")
  assert.equal(completed.libraryPath, null)
  assert.match(completed.libraryLinkError, /EEXIST|not a directory|directory/i)
  assert.equal(await readFile(completed.reportPath, "utf8") !== "", true)
  assert.equal((await failedLinkRuntime.load(completed.runId)).status, "completed")
})

test("research_report returns only the completed run's canonical report", async (t) => {
  const { runtime } = await fixture(t)
  const { completed } = await completeSupportedRun(runtime)
  const loaded = await runtime.report({ runId: completed.runId })
  assert.equal(loaded.runId, completed.runId)
  assert.equal(loaded.status, "completed")
  assert.equal(loaded.report, await readFile(completed.reportPath, "utf8"))
  assert.equal(loaded.reportPath, completed.reportPath)
  assert.equal(loaded.libraryPath, completed.libraryPath)

  const statePath = runtime.store.paths(completed.runId).state
  const tamperedState = JSON.parse(await readFile(statePath, "utf8"))
  tamperedState.reportPath = "/etc/passwd"
  await writeFile(statePath, `${JSON.stringify(tamperedState)}\n`, "utf8")
  const stillCanonical = await runtime.report({ runId: completed.runId })
  assert.equal(stillCanonical.reportPath, completed.reportPath)
  assert.equal(stillCanonical.report, loaded.report)

  const incomplete = await runtime.start({ objective: "An incomplete run.", questions: plan() })
  await assert.rejects(runtime.report({ runId: incomplete.runId }), /requires a completed run/)
  await assert.rejects(runtime.report({ runId: "missing-run" }), /run not found/)
  await assert.rejects(runtime.report({ runId: "../../outside" }), /safe generated identifier/)
})

test("completion metrics use runtime timestamps and report citation occurrences", async (t) => {
  let current = new Date("2026-09-12T00:00:00.000Z")
  const { runtime } = await fixture(t, { clock: () => current })
  const first = await prepareSupportedRun(runtime)
  const completed = await runtime.complete({ runId: first.started.runId, report: [
    "Claim A [Source A](https://example.com/source-a).",
    "Claim B again cites [Source A](https://example.com/source-a).",
    "Claim C repeats [Source A](https://example.com/source-a).",
  ].join("\n\n") })
  assert.equal(completed.durationMs, 0)
  assert.equal(completed.durationDisplay, "0s")
  assert.equal(completed.citationCount, 3)
  current = new Date("2026-09-12T00:05:07.000Z")

  const later = await prepareSupportedRun(runtime, {
    objective: "A second timed research run",
  })
  current = new Date("2026-09-12T00:10:14.000Z")
  const laterCompleted = await runtime.complete({ runId: later.started.runId, report: "A timed fact [Source A](https://example.com/source-a)." })
  assert.equal(laterCompleted.durationMs, 307000)
  assert.equal(laterCompleted.durationDisplay, "5m 7s")
  assert.equal(laterCompleted.citationCount, 1)
  const persisted = await runtime.load(laterCompleted.runId)
  assert.equal(persisted.startedAt, "2026-09-12T00:05:07.000Z")
  assert.equal(persisted.completedAt, "2026-09-12T00:10:14.000Z")
  assert.equal(persisted.metrics.durationMs, 307000)
  assert.equal(persisted.metrics.durationDisplay, "5m 7s")
})

test("formatDurationDisplay uses compact rounded whole-second units", () => {
  const cases = [
    [999, "1s"],
    [12_000, "12s"],
    [60_000, "1m"],
    [61_000, "1m 1s"],
    [201_267, "3m 21s"],
    [3_600_000, "1h"],
    [3_661_000, "1h 1m 1s"],
  ]
  for (const [durationMs, expected] of cases) assert.equal(formatDurationDisplay(durationMs), expected)
})

test("citationCount counts rendered citation occurrences rather than raw URL strings", async (t) => {
  const cases = [
    { report: "[Source](https://example.com/source-a)", expected: 1 },
    { report: "[https://example.com/source-a](https://example.com/source-a)", expected: 1 },
    { report: "[Source](https://example.com/source-a)\n\nLater [Source](https://example.com/source-a)", expected: 2 },
    { report: "<https://example.com/source-a>", expected: 1 },
    { report: "https://example.com/source-a", expected: 1 },
  ]

  for (const { report, expected } of cases) {
    const ready = await verifiedRun(t)
    const completed = await ready.runtime.complete({ runId: ready.runId, report })
    assert.equal(completed.citationCount, expected, report)
  }

  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "verified distinct sources",
    sources: [
      { url: "https://example.com/source-a", sourceKey: "source-a" },
      { url: "https://example.com/source-b", sourceKey: "source-b" },
    ],
    evidence: [
      { questionId: next.task.questionId, sourceKey: "source-a", fact: "Fact A", supportingSpan: "Source A supports fact A.", relation: "supports" },
      { questionId: next.task.questionId, sourceKey: "source-b", fact: "Fact B", supportingSpan: "Source B supports fact B.", relation: "supports" },
    ],
    questionUpdates: [{
      questionId: next.task.questionId,
      criteriaSatisfied: [
        { criterionId: "question-0001-criterion-1", evidenceIndexes: [0] },
        { criterionId: "question-0001-criterion-2", evidenceIndexes: [1] },
      ],
    }],
  })
  await runtime.verify({
    runId: started.runId,
    claims: [
      { statement: "Fact A", evidenceIds: ["evidence-0001"], critical: true, verification: "SUPPORTED" },
      { statement: "Fact B", evidenceIds: ["evidence-0002"], critical: false, verification: "SUPPORTED" },
    ],
  })
  const completed = await runtime.complete({
    runId: started.runId,
    report: "[Source A](https://example.com/source-a) and [Source B](https://example.com/source-b).",
  })
  assert.equal(completed.citationCount, 2)
})

test("final report citations are limited to sources used by supported claims", async (t) => {
  const valid = await verifiedRun(t)
  const completed = await valid.runtime.complete({
    runId: valid.runId,
    report: "Verified fact is supported by [Source A](https://example.com/source-a#details).",
  })
  assert.equal(completed.status, "completed")

  const unrelated = await verifiedRun(t)
  await assert.rejects(unrelated.runtime.complete({
    runId: unrelated.runId,
    report: "Verified fact is supported by [another page](https://unrelated.example.org/page).",
  }), /not backed by a verified claim source/)
  assert.equal((await unrelated.runtime.load(unrelated.runId)).status, "writing")

  const unused = await verifiedRun(t, { includeUnusedSource: true })
  await assert.rejects(unused.runtime.complete({
    runId: unused.runId,
    report: "Verified fact is supported by [Source B](https://example.com/source-b).",
  }), /not backed by a verified claim source/)
  assert.equal((await unused.runtime.load(unused.runId)).status, "writing")
})

test("final report citations accept supported Markdown URL forms", async (t) => {
  const reports = [
    "Plain https://example.com/source-a",
    "[Source](https://example.com/source-a)",
    "[https://example.com/source-a](https://example.com/source-a)",
    "<https://example.com/source-a>",
  ]
  for (const report of reports) {
    const ready = await verifiedRun(t)
    const completed = await ready.runtime.complete({ runId: ready.runId, report })
    assert.equal(completed.status, "completed")
  }
})

async function uncertaintyReadyRun(t, { verification, critical = false, budget, contradictionStatus } = {}) {
  const { runtime, started, next } = await startAndNext(t, 1, budget ? { start: { budget } } : {})
  const hasContradiction = contradictionStatus !== undefined
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "structured uncertainty",
    sources: [
      { url: "https://example.com/uncertainty-a", sourceKey: "uncertainty-a" },
      ...(hasContradiction ? [{ url: "https://example.com/uncertainty-b", sourceKey: "uncertainty-b" }] : []),
    ],
    evidence: [
      { questionId: next.task.questionId, sourceKey: "uncertainty-a", fact: "Evidence A", supportingSpan: "Source A records the first result.", relation: "supports" },
      ...(hasContradiction ? [{ questionId: next.task.questionId, sourceKey: "uncertainty-b", fact: "Evidence B", supportingSpan: "Source B records the conflicting result.", relation: "contradicts" }] : []),
    ],
    questionUpdates: [{
      questionId: next.task.questionId,
      criteriaSatisfied: [
        { criterionId: "question-0001-criterion-1", evidenceIndexes: [0] },
        { criterionId: "question-0001-criterion-2", evidenceIndexes: [0] },
      ],
    }],
    contradictions: hasContradiction ? [{
      questionId: next.task.questionId,
      proposition: "The sources agree on the result.",
      sideA: { evidenceIndexes: [0] },
      sideB: { evidenceIndexes: [1] },
      critical: contradictionStatus === "open",
      status: contradictionStatus,
      resolution: contradictionStatus === "open" ? undefined : "The disagreement remains documented for the report.",
    }] : undefined,
  })
  await runtime.verify({
    runId: started.runId,
    claims: [{
      statement: "The result remains uncertain.",
      evidenceIds: ["evidence-0001"],
      critical,
      verification,
    }],
  })
  return { runtime, runId: started.runId }
}

test("final reports may cite evidence behind partial, unsupported, and contradicted claims", async (t) => {
  const partial = await uncertaintyReadyRun(t, { verification: "PARTIAL" })
  assert.equal((await partial.runtime.complete({
    runId: partial.runId,
    report: "The evidence is partial: [Source A](https://example.com/uncertainty-a).",
  })).status, "completed")

  const unsupported = await uncertaintyReadyRun(t, {
    verification: "UNSUPPORTED",
    critical: true,
    budget: { maxControllerRounds: 1, maxTasks: 2 },
  })
  assert.equal((await unsupported.runtime.complete({
    runId: unsupported.runId,
    report: "The budget left this claim unsupported: [Source A](https://example.com/uncertainty-a).",
  })).status, "completed")

  const contradicted = await uncertaintyReadyRun(t, { verification: "CONTRADICTED", contradictionStatus: "resolved" })
  assert.equal((await contradicted.runtime.complete({
    runId: contradicted.runId,
    report: "The sources conflict: [Source A](https://example.com/uncertainty-a) and [Source B](https://example.com/uncertainty-b).",
  })).status, "completed")
})

test("final reports may cite evidence from reportable contradictions but not unrelated sources", async (t) => {
  const accepted = await uncertaintyReadyRun(t, { verification: "PARTIAL", contradictionStatus: "accepted_uncertainty" })
  assert.equal((await accepted.runtime.complete({
    runId: accepted.runId,
    report: "The uncertainty is documented by [Source B](https://example.com/uncertainty-b).",
  })).status, "completed")

  const open = await uncertaintyReadyRun(t, {
    verification: "UNSUPPORTED",
    critical: true,
    budget: { maxControllerRounds: 1, maxTasks: 2 },
    contradictionStatus: "open",
  })
  assert.equal((await open.runtime.complete({
    runId: open.runId,
    report: "The exhausted budget leaves an open contradiction: [Source B](https://example.com/uncertainty-b).",
  })).status, "completed")

  const unused = await verifiedRun(t, { includeUnusedSource: true })
  await assert.rejects(unused.runtime.complete({
    runId: unused.runId,
    report: "The report cites an unused source: [Source B](https://example.com/source-b).",
  }), /not backed by a verified claim source/)
})

test("completion records every claim verdict and surfaces noncritical weak claims as uncertainty", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "complete criterion evidence",
    sources: [{ url: "https://example.com/claim-counts", sourceKey: "claims" }],
    evidence: [{ questionId: next.task.questionId, sourceKey: "claims", fact: "A bounded fact", supportingSpan: "The source states the bounded fact.", relation: "supports", qualifiers: ["current scope"] }],
    questionUpdates: [{
      questionId: next.task.questionId,
      criteriaSatisfied: [
        { criterionId: "question-0001-criterion-1", evidenceIndexes: [0] },
        { criterionId: "question-0001-criterion-2", evidenceIndexes: [0] },
      ],
    }],
  })
  const verification = await runtime.verify({
    runId: started.runId,
    claims: [
      { statement: "Supported claim", evidenceIds: ["evidence-0001"], critical: true, verification: "SUPPORTED" },
      { statement: "Partial claim", evidenceIds: ["evidence-0001"], verification: "PARTIAL" },
      { statement: "Unsupported claim", evidenceIds: ["evidence-0001"], verification: "UNSUPPORTED" },
      { statement: "Contradicted claim", evidenceIds: ["evidence-0001"], verification: "CONTRADICTED" },
    ],
  })
  assert.deepEqual(verification.claimStatusCounts, { supported: 1, partial: 1, unsupported: 1, contradicted: 1 })
  assert.equal(verification.blockers.claimStatusCounts.unsupported, 1)
  assert.equal(verification.status, "writing")
  assert.equal(verification.digest.verification.evidence[0].citationUrl, "https://example.com/claim-counts")
  assert.equal(verification.digest.verification.evidence[0].supportingSpan, "The source states the bounded fact.")
  const completed = await runtime.complete({ runId: started.runId, report: "The bounded fact is recorded; the weaker claims remain uncertain." })
  assert.deepEqual(completed.metrics.claimStatusCounts, { supported: 1, partial: 1, unsupported: 1, contradicted: 1 })
  assert.equal(completed.claimStatusCounts.contradicted, 1)
  assert.equal(completed.remainingUncertainties.filter((item) => item.startsWith("- Reportable claim")).length, 3)
  assert.match(await readFile(completed.reportPath, "utf8"), /Reportable claim claim-0002 is PARTIAL/)
  assert.deepEqual(claimStatusCounts((await runtime.load(started.runId)).claims), completed.metrics.claimStatusCounts)
})

test("a sufficient question is not implicitly regressed by a verification follow-up", async (t) => {
  const { runtime, started, next } = await startAndNext(t)
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    summary: "complete initial question",
    sources: [{ url: "https://example.com/sufficient", sourceKey: "sufficient" }],
    evidence: [{ questionId: next.task.questionId, sourceKey: "sufficient", fact: "Sufficient fact", supportingSpan: "The source supports the question.", relation: "supports" }],
    questionUpdates: [{
      questionId: next.task.questionId,
      criteriaSatisfied: [
        { criterionId: "question-0001-criterion-1", evidenceIndexes: [0] },
        { criterionId: "question-0001-criterion-2", evidenceIndexes: [0] },
      ],
    }],
    followUpTasks: [{ questionId: next.task.questionId, objective: "Recheck the sufficient answer", type: "verification", priority: "critical", reason: "explicit verification follow-up" }],
  })
  assert.equal((await runtime.load(started.runId)).questions[0].status, "sufficient")
  const followUp = await runtime.next({ runId: started.runId })
  assert.equal(followUp.status, "verifying")
  assert.equal(followUp.task, null)
  assert.equal((await runtime.load(started.runId)).tasks.at(-1).status, "superseded")
  assert.equal((await runtime.load(started.runId)).questions[0].status, "sufficient")
})

test("budget-exhausted completion appends an explicit limitation for unresolved claims", async (t) => {
  const { runtime, started, next } = await startAndNext(t, 1, { start: { budget: { maxControllerRounds: 1, maxTasks: 2 } } })
  await runtime.commit({
    runId: started.runId,
    taskId: next.task.taskId,
    failed: true,
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
    "- Critical question question-0001 remains researching at 0/2 required criteria.",
    "- Critical claim claim-0001 is UNSUPPORTED: An unsupported conclusion",
  ])
  assert.match(await readFile(completed.reportPath, "utf8"), /## Research limitations/)
})

test("older Professor state receives safe closure, task, and claim-count defaults on load", async (t) => {
  const { root, runtime, started } = await (async () => {
    const value = await fixture(t)
    const result = await value.runtime.start({ objective: "Load an older state shape.", questions: plan() })
    return { ...value, started: result }
  })()
  const statePath = join(root, "runs", started.runId, "state.json")
  const oldState = JSON.parse(await readFile(statePath, "utf8"))
  oldState.schemaVersion = 1
  oldState.budget.maxControllerRounds = 30
  delete oldState.budget.outerStepLimit
  delete oldState.budget.completionStepReserve
  delete oldState.budget.estimatedStepsPerControllerRound
  delete oldState.budget.completionReserve
  delete oldState.metrics.claimStatusCounts
  delete oldState.counters.tasksSuperseded
  for (const task of oldState.tasks) {
    delete task.supersededAt
    delete task.supersededReason
    delete task.supersedeWhenSufficient
  }
  await writeFile(statePath, `${JSON.stringify(oldState)}\n`, "utf8")
  const loaded = await runtime.load(started.runId)
  assert.equal(loaded.schemaVersion, 1)
  assert.equal(loaded.budget.maxControllerRounds, SAFE_CONTROLLER_ROUND_LIMIT)
  assert.equal(loaded.budget.outerStepLimit, 32)
  assert.equal(loaded.budget.completionReserve, 2)
  assert.deepEqual(loaded.metrics.claimStatusCounts, { supported: 0, partial: 0, unsupported: 0, contradicted: 0 })
  assert.equal(loaded.counters.tasksSuperseded, 0)
  assert.equal(loaded.tasks[0].supersedeWhenSufficient, true)
  assert.doesNotThrow(() => researchCapacity(loaded))
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
