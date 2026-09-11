import { randomUUID } from "node:crypto"

import {
  CONFIDENCE_LEVELS,
  CONTRADICTION_STATUSES,
  QUESTION_PRIORITIES,
  TASK_TYPES,
  VERIFICATION_RESULTS,
  assertEnum,
  assertNonEmptyString,
  assertSafeId,
  canonicalizeUrl,
  createResearchState,
  criticalQuestionsIncomplete,
  hasHardBudget,
  makeStateDigest,
  normalizeBudget,
  openCriticalContradictions,
  questionIsSufficient,
  sortFrontier,
  transitionState,
  validateResearchState,
} from "./state.js"
import { createProfessorStore, resolveProfessorDataRoot } from "./store.js"

const SOURCE_TYPES = ["official", "first-party", "reporting", "research", "specification", "community", "documentation", "web"]
const RELATIONS = ["supports", "contradicts", "context"]
const MAX_COMMIT_ITEMS = 80

function nowIso(clock) {
  const value = clock()
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function pad(number) {
  return String(number).padStart(4, "0")
}

function createRunId() {
  return `run-${Date.now()}-${randomUUID().slice(0, 12)}`
}

function createPerRunIdFactory() {
  const counters = new Map()
  const prefixes = {
    question: "question",
    task: "task",
  }
  return (kind) => {
    const next = (counters.get(kind) ?? 0) + 1
    counters.set(kind, next)
    return `${prefixes[kind] ?? kind}-${pad(next)}`
  }
}

function allocateId(state, kind, prefix) {
  const next = (state.counters.nextIds[kind] ?? 0) + 1
  state.counters.nextIds[kind] = next
  return `${prefix}-${pad(next)}`
}

function result(value) {
  return JSON.stringify(value, null, 2)
}

function safeArray(value, label, max = MAX_COMMIT_ITEMS) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  if (value.length > max) throw new Error(`${label} cannot contain more than ${max} items`)
  return value
}

function questionById(state, questionId) {
  assertSafeId(questionId, "questionId")
  const question = state.questions.find((candidate) => candidate.questionId === questionId)
  if (!question) throw new Error(`unknown question: ${questionId}`)
  return question
}

function taskById(state, taskId) {
  assertSafeId(taskId, "taskId")
  const task = state.tasks.find((candidate) => candidate.taskId === taskId)
  if (!task) throw new Error(`unknown task: ${taskId}`)
  return task
}

function sourceById(state, sourceId) {
  assertSafeId(sourceId, "sourceId")
  const source = state.sources.find((candidate) => candidate.sourceId === sourceId)
  if (!source) throw new Error(`unknown source: ${sourceId}`)
  return source
}

function evidenceById(state, evidenceId) {
  assertSafeId(evidenceId, "evidenceId")
  const evidence = state.evidence.find((candidate) => candidate.evidenceId === evidenceId)
  if (!evidence) throw new Error(`unknown evidence: ${evidenceId}`)
  return evidence
}

function eventData(value) {
  return value && typeof value === "object" ? value : {}
}

function normalizeQualifiers(value) {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.map((item, index) => assertNonEmptyString(item, `qualifiers[${index}]`, 1_000))
  return [assertNonEmptyString(value, "qualifiers", 1_000)]
}

function uniqueStrings(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`)
  const output = []
  const seen = new Set()
  for (const value of values) {
    const normalized = assertNonEmptyString(value, label, 1_000)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      output.push(normalized)
    }
  }
  return output
}

function taskPayload(task) {
  return {
    taskId: task.taskId,
    questionId: task.questionId,
    objective: task.objective,
    type: task.type,
    priority: task.priority,
    reason: task.reason,
    status: task.status,
  }
}

function questionCoverageSummary(question) {
  const required = question.completionCriteria.filter((criterion) => criterion.required)
  const satisfied = required.filter((criterion) => criterion.satisfied)
  return {
    questionId: question.questionId,
    status: question.status,
    satisfied: satisfied.length,
    total: required.length,
    percentage: required.length === 0 ? 0 : Math.round((satisfied.length / required.length) * 100),
  }
}

export function createProfessorRuntime(options = {}) {
  const clock = options.clock ?? (() => new Date())
  const store = options.store ?? createProfessorStore(resolveProfessorDataRoot(options))
  const generateRunId = options.generateRunId ?? createRunId

  function timestamp() {
    return nowIso(clock)
  }

  function makeEvent(state, type, data = {}) {
    const eventId = allocateId(state, "event", "event")
    state.counters.eventsRecorded += 1
    return { eventId, type, runId: state.runId, at: timestamp(), data: eventData(data) }
  }

  async function persist(state, events) {
    state.updatedAt = timestamp()
    validateResearchState(state)
    await store.saveState(state)
    await store.appendEvents(state.runId, events)
  }

  async function load(runId) {
    assertSafeId(runId, "runId")
    return store.loadState(runId)
  }

  function markBudgetExhausted(state, reason, events) {
    if (state.budget.exhausted) return
    state.budget.exhausted = true
    state.budget.exhaustionReason = reason
    if (events) events.push(makeEvent(state, "budget.exhausted", { reason }))
  }

  function canCreateTask(state) {
    return state.counters.tasksCreated < state.budget.maxTasks
  }

  function addTask(state, input, events) {
    if (!canCreateTask(state)) {
      markBudgetExhausted(state, "max_tasks", events)
      return null
    }
    const question = questionById(state, input.questionId)
    const objective = assertNonEmptyString(input.objective, "task objective", 4_000)
    const type = assertEnum(input.type ?? "follow-up", TASK_TYPES, "task type")
    const priority = assertEnum(input.priority ?? question.priority, QUESTION_PRIORITIES, "task priority")
    const reason = assertNonEmptyString(input.reason ?? "adaptive follow-up", "task reason", 2_000)
    const task = {
      taskId: allocateId(state, "task", "task"),
      questionId: question.questionId,
      objective,
      type,
      priority,
      reason,
      status: "pending",
      sequence: state.tasks.length + 1,
      createdAt: timestamp(),
      startedAt: null,
      completedAt: null,
    }
    state.tasks.push(task)
    state.counters.tasksCreated += 1
    events.push(makeEvent(state, "task.created", {
      taskId: task.taskId,
      questionId: task.questionId,
      type: task.type,
      priority: task.priority,
      reason: task.reason,
    }))
    return task
  }

  function addVerificationTaskForGap(state, question, events) {
    const incomplete = question.completionCriteria
      .filter((criterion) => criterion.required && !criterion.satisfied)
      .map((criterion) => criterion.label)
      .join(", ")
    return addTask(state, {
      questionId: question.questionId,
      objective: `Close the evidence gap for: ${question.question}`,
      type: "gap-filling",
      priority: question.priority,
      reason: `completion criteria remain unsatisfied: ${incomplete}`,
    }, events)
  }

  function addConflictTask(state, contradiction, events) {
    const question = contradiction.questionId ? questionById(state, contradiction.questionId) : state.questions.find((candidate) => candidate.priority === "critical")
    if (!question) return null
    return addTask(state, {
      questionId: question.questionId,
      objective: `Resolve the contradiction: ${contradiction.proposition}`,
      type: "conflict-resolution",
      priority: "critical",
      reason: "critical contradiction remains open",
    }, events)
  }

  function beginVerification(state, events, reason) {
    if (state.status === "researching") {
      transitionState(state, "verifying")
      events.push(makeEvent(state, "verification.started", { reason }))
    }
  }

  function resolveSourceReference(state, sourceInput, sourceRefs, sourceKeys, sourceUrls) {
    if (Number.isInteger(sourceInput.sourceIndex)) {
      const sourceId = sourceRefs[sourceInput.sourceIndex]
      if (!sourceId) throw new Error(`evidence sourceIndex is out of range: ${sourceInput.sourceIndex}`)
      return sourceId
    }
    if (sourceInput.sourceKey !== undefined) {
      const key = assertNonEmptyString(sourceInput.sourceKey, "sourceKey", 200)
      const sourceId = sourceKeys.get(key)
      if (!sourceId) throw new Error(`unknown sourceKey: ${key}`)
      return sourceId
    }
    if (sourceInput.sourceId !== undefined) return sourceById(state, sourceInput.sourceId).sourceId
    if (sourceInput.sourceUrl !== undefined) {
      const canonicalUrl = canonicalizeUrl(sourceInput.sourceUrl)
      const sourceId = sourceUrls.get(canonicalUrl) ?? state.sources.find((source) => source.canonicalUrl === canonicalUrl)?.sourceId
      if (!sourceId) throw new Error(`source URL was not declared in this commit: ${sourceInput.sourceUrl}`)
      return sourceId
    }
    throw new Error("evidence must reference a declared sourceIndex, sourceKey, sourceId, or sourceUrl")
  }

  function resolveEvidenceReferences(state, input, newEvidenceIds) {
    const evidenceIds = []
    for (const evidenceId of input.evidenceIds ?? []) evidenceIds.push(evidenceById(state, evidenceId).evidenceId)
    for (const index of input.evidenceIndexes ?? []) {
      if (!Number.isInteger(index) || index < 0 || !newEvidenceIds[index]) throw new Error(`evidence index is out of range: ${index}`)
      evidenceIds.push(newEvidenceIds[index])
    }
    return [...new Set(evidenceIds)]
  }

  function applyQuestionUpdates(state, updates, events) {
    for (const update of updates) {
      const question = questionById(state, update.questionId)
      const satisfied = update.criteriaSatisfied ?? []
      if (!Array.isArray(satisfied)) throw new Error("criteriaSatisfied must be an array")
      for (const criterionRef of satisfied) {
        const normalized = assertNonEmptyString(criterionRef, "criteriaSatisfied item", 1_000)
        const criterion = question.completionCriteria.find(
          (candidate) => candidate.criterionId === normalized || candidate.label.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
        )
        if (!criterion) throw new Error(`unknown completion criterion for ${question.questionId}: ${normalized}`)
        criterion.satisfied = true
      }
      if (questionIsSufficient(question)) question.status = "sufficient"
      else if (update.status === "blocked") question.status = "blocked"
      else question.status = "researching"
      events.push(makeEvent(state, "coverage.updated", questionCoverageSummary(question)))
    }
  }

  function normalizeSourceRecords(state, sources, events) {
    const sourceInputs = safeArray(sources, "sources")
    const sourceRefs = []
    const sourceKeys = new Map()
    const sourceUrls = new Map()
    const newRecords = []

    for (const input of sourceInputs) {
      if (!input || typeof input !== "object") throw new Error("each source must be an object")
      const url = assertNonEmptyString(input.url, "source.url", 4_000)
      const canonicalUrl = canonicalizeUrl(url)
      const normalizedSourceKey = input.sourceKey === undefined ? undefined : assertNonEmptyString(input.sourceKey, "source.sourceKey", 200)
      if (normalizedSourceKey !== undefined) {
        if (sourceKeys.has(normalizedSourceKey)) throw new Error(`duplicate sourceKey: ${normalizedSourceKey}`)
        sourceKeys.set(normalizedSourceKey, null)
      }
      const existing = state.sources.find((source) => source.canonicalUrl === canonicalUrl) ?? newRecords.find((source) => source.canonicalUrl === canonicalUrl)
      let source
      if (existing) {
        source = existing
        if (!source.observedUrls.includes(url) && source.observedUrls.length < 8) source.observedUrls.push(url)
      } else {
        if (state.sources.length + newRecords.length >= state.budget.maxSources) throw new Error("research source budget exceeded")
        source = {
          sourceId: allocateId(state, "source", "source"),
          url,
          canonicalUrl,
          title: typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 2_000) : url,
          sourceType: typeof input.sourceType === "string" && input.sourceType.trim() ? input.sourceType.trim().slice(0, 100) : "web",
          publishedAt: input.publishedAt ? assertNonEmptyString(input.publishedAt, "source.publishedAt", 200) : null,
          retrievedAt: timestamp(),
          observedUrls: [url],
        }
        newRecords.push(source)
        state.sources.push(source)
        state.counters.sourcesRecorded += 1
      }
      const index = sourceRefs.length
      sourceRefs.push(source.sourceId)
      sourceUrls.set(canonicalUrl, source.sourceId)
      if (normalizedSourceKey !== undefined) sourceKeys.set(normalizedSourceKey, source.sourceId)
      events.push(makeEvent(state, "source.added", {
        sourceId: source.sourceId,
        newRecord: newRecords.includes(source),
        index,
      }))
    }
    return { sourceRefs, sourceKeys, sourceUrls, newRecords }
  }

  function addEvidenceRecords(state, evidenceInputs, sourceContext, events) {
    const inputs = safeArray(evidenceInputs, "evidence")
    if (state.evidence.length + inputs.length > state.budget.maxEvidenceRecords) throw new Error("research evidence budget exceeded")
    const newEvidenceIds = []
    const keyMap = new Map()
    for (const input of inputs) {
      if (!input || typeof input !== "object") throw new Error("each evidence record must be an object")
      const question = questionById(state, input.questionId)
      const fact = assertNonEmptyString(input.fact, "evidence.fact", 4_000)
      const supportingSpan = assertNonEmptyString(input.supportingSpan, "evidence.supportingSpan", 8_000)
      const relation = assertEnum(input.relation, RELATIONS, "evidence.relation")
      const sourceId = resolveSourceReference(state, input, sourceContext.sourceRefs, sourceContext.sourceKeys, sourceContext.sourceUrls)
      const source = sourceById(state, sourceId)
      const citationUrl = input.citationUrl ? assertNonEmptyString(input.citationUrl, "evidence.citationUrl", 4_000) : source.url
      canonicalizeUrl(citationUrl)
      if (input.evidenceKey !== undefined) {
        const key = assertNonEmptyString(input.evidenceKey, "evidence.evidenceKey", 200)
        if (keyMap.has(key)) throw new Error(`duplicate evidenceKey: ${key}`)
        keyMap.set(key, null)
      }
      const evidence = {
        evidenceId: allocateId(state, "evidence", "evidence"),
        questionId: question.questionId,
        sourceId,
        citationUrl,
        fact,
        supportingSpan,
        relation,
        qualifiers: normalizeQualifiers(input.qualifiers),
        createdAt: timestamp(),
      }
      state.evidence.push(evidence)
      state.counters.evidenceRecorded += 1
      newEvidenceIds.push(evidence.evidenceId)
      if (input.evidenceKey !== undefined) keyMap.set(input.evidenceKey, evidence.evidenceId)
      events.push(makeEvent(state, "evidence.added", {
        evidenceId: evidence.evidenceId,
        questionId: evidence.questionId,
        sourceId: evidence.sourceId,
        relation: evidence.relation,
      }))
    }
    return { newEvidenceIds, keyMap }
  }

  function addFindings(state, findings, newEvidenceIds, events) {
    const inputs = safeArray(findings, "findings")
    const created = []
    for (const input of inputs) {
      if (!input || typeof input !== "object") throw new Error("each finding must be an object")
      const question = questionById(state, input.questionId)
      const evidenceIds = resolveEvidenceReferences(state, input, newEvidenceIds)
      if (evidenceIds.length === 0) throw new Error("a finding must reference at least one evidence record")
      const finding = {
        findingId: allocateId(state, "finding", "finding"),
        questionId: question.questionId,
        statement: assertNonEmptyString(input.statement, "finding.statement", 4_000),
        evidenceIds,
        confidence: assertEnum(input.confidence ?? "medium", CONFIDENCE_LEVELS, "finding.confidence"),
        createdAt: timestamp(),
      }
      state.findings.push(finding)
      state.counters.findingsRecorded += 1
      created.push(finding)
      events.push(makeEvent(state, "finding.added", { findingId: finding.findingId, questionId: finding.questionId, evidenceIds }))
    }
    return created
  }

  function addContradictions(state, contradictions, newEvidenceIds, events) {
    const inputs = safeArray(contradictions, "contradictions")
    const created = []
    for (const input of inputs) {
      if (!input || typeof input !== "object") throw new Error("each contradiction must be an object")
      const sideA = input.sideA && typeof input.sideA === "object" ? input.sideA : {}
      const sideB = input.sideB && typeof input.sideB === "object" ? input.sideB : {}
      const sideAEvidenceIds = resolveEvidenceReferences(state, sideA, newEvidenceIds)
      const sideBEvidenceIds = resolveEvidenceReferences(state, sideB, newEvidenceIds)
      if (sideAEvidenceIds.length === 0 || sideBEvidenceIds.length === 0) throw new Error("a contradiction needs evidence on both sides")
      const contradiction = {
        contradictionId: allocateId(state, "contradiction", "contradiction"),
        questionId: input.questionId ? questionById(state, input.questionId).questionId : null,
        proposition: assertNonEmptyString(input.proposition, "contradiction.proposition", 4_000),
        sideA: {
          summary: input.sideA.summary ? assertNonEmptyString(input.sideA.summary, "contradiction.sideA.summary", 2_000) : null,
          evidenceIds: sideAEvidenceIds,
        },
        sideB: {
          summary: input.sideB.summary ? assertNonEmptyString(input.sideB.summary, "contradiction.sideB.summary", 2_000) : null,
          evidenceIds: sideBEvidenceIds,
        },
        critical: input.critical === true,
        status: assertEnum(input.status ?? "open", CONTRADICTION_STATUSES, "contradiction.status"),
        resolution: input.resolution ? assertNonEmptyString(input.resolution, "contradiction.resolution", 4_000) : null,
        createdAt: timestamp(),
        updatedAt: timestamp(),
      }
      if (contradiction.status !== "open" && !contradiction.resolution) throw new Error("resolved or accepted contradictions need a resolution")
      state.contradictions.push(contradiction)
      state.counters.contradictionsRecorded += 1
      created.push(contradiction)
      events.push(makeEvent(state, "contradiction.added", {
        contradictionId: contradiction.contradictionId,
        questionId: contradiction.questionId,
        critical: contradiction.critical,
        status: contradiction.status,
        evidenceIds: [...new Set([...sideAEvidenceIds, ...sideBEvidenceIds])],
      }))
    }
    return created
  }

  function updateContradictions(state, updates, events) {
    const inputs = safeArray(updates, "contradictionUpdates")
    for (const input of inputs) {
      const contradiction = state.contradictions.find((candidate) => candidate.contradictionId === input.contradictionId)
      if (!contradiction) throw new Error(`unknown contradiction: ${input.contradictionId}`)
      const status = assertEnum(input.status, CONTRADICTION_STATUSES, "contradiction update status")
      const resolution = input.resolution ? assertNonEmptyString(input.resolution, "contradiction update resolution", 4_000) : contradiction.resolution
      if (status !== "open" && !resolution) throw new Error("resolved or accepted contradictions need a resolution")
      contradiction.status = status
      contradiction.resolution = resolution ?? null
      contradiction.updatedAt = timestamp()
      events.push(makeEvent(state, status === "open" ? "contradiction.updated" : "contradiction.resolved", {
        contradictionId: contradiction.contradictionId,
        status,
      }))
    }
  }

  function updateBudgetAfterCommit(state, events) {
    if (state.counters.sourcesRecorded >= state.budget.maxSources) markBudgetExhausted(state, "max_sources", events)
    if (state.counters.evidenceRecorded >= state.budget.maxEvidenceRecords) markBudgetExhausted(state, "max_evidence_records", events)
  }

  async function start(input = {}) {
    const objective = assertNonEmptyString(input.objective, "objective", 20_000)
    if (!Array.isArray(input.questions) || input.questions.length === 0) throw new Error("research_start requires at least one question")
    const runId = assertSafeId(String(generateRunId()), "generated runId")
    const state = createResearchState({
      runId,
      objective,
      questions: input.questions,
      budget: normalizeBudget(input.budget, input.questions.length),
      now: timestamp,
      makeId: createPerRunIdFactory(),
    })
    const events = []
    transitionState(state, "researching")
    events.push(makeEvent(state, "research.started", { questionCount: state.questions.length }))
    events.push(makeEvent(state, "plan.created", {
      questionIds: state.questions.map((question) => question.questionId),
      criteriaCount: state.questions.reduce((count, question) => count + question.completionCriteria.length, 0),
    }))
    for (const task of state.tasks) {
      events.push(makeEvent(state, "task.created", {
        taskId: task.taskId,
        questionId: task.questionId,
        type: task.type,
        priority: task.priority,
      }))
    }
    validateResearchState(state)
    await store.ensureRoot()
    await store.createRun(state)
    await store.appendEvents(runId, events)
    return {
      runId,
      status: state.status,
      digest: makeStateDigest(state),
    }
  }

  async function next(input = {}) {
    const state = await load(input.runId)
    const events = []
    if (state.status === "completed" || state.status === "writing") {
      return { runId: state.runId, status: state.status, task: null, digest: makeStateDigest(state) }
    }
    if (state.status === "verifying") return { runId: state.runId, status: state.status, task: null, digest: makeStateDigest(state) }
    if (state.status === "planning") transitionState(state, "researching")

    const running = state.tasks.find((task) => task.status === "running")
    if (running) return { runId: state.runId, status: state.status, task: taskPayload(running), reused: true, digest: makeStateDigest(state) }

    if (state.counters.controllerRounds >= state.budget.maxControllerRounds) {
      markBudgetExhausted(state, "max_controller_rounds", events)
      beginVerification(state, events, "controller round budget reached")
      await persist(state, events)
      return { runId: state.runId, status: state.status, task: null, budgetExhausted: true, digest: makeStateDigest(state) }
    }
    if (state.counters.sourcesRecorded >= state.budget.maxSources || state.counters.evidenceRecorded >= state.budget.maxEvidenceRecords) {
      markBudgetExhausted(state, state.counters.sourcesRecorded >= state.budget.maxSources ? "max_sources" : "max_evidence_records", events)
      beginVerification(state, events, "research record budget reached")
      await persist(state, events)
      return { runId: state.runId, status: state.status, task: null, budgetExhausted: true, digest: makeStateDigest(state) }
    }

    let pending = sortFrontier(state.tasks)
    if (pending.length === 0) {
      const incomplete = criticalQuestionsIncomplete(state).sort((left, right) => right.priority.localeCompare(left.priority))
      const openContradictions = openCriticalContradictions(state)
      let followUp = null
      if (openContradictions.length > 0) followUp = addConflictTask(state, openContradictions[0], events)
      else if (incomplete.length > 0) followUp = addVerificationTaskForGap(state, incomplete[0], events)
      if (followUp) pending = sortFrontier(state.tasks)
      else if (openContradictions.length > 0 || incomplete.length > 0) {
        markBudgetExhausted(state, "max_tasks", events)
        beginVerification(state, events, "no task capacity remains for a critical gap")
      } else {
        beginVerification(state, events, "frontier is complete")
      }
    }

    if (state.status === "verifying") {
      await persist(state, events)
      return { runId: state.runId, status: state.status, task: null, budgetExhausted: state.budget.exhausted, digest: makeStateDigest(state) }
    }

    const task = pending[0]
    task.status = "running"
    task.startedAt = timestamp()
    state.counters.controllerRounds += 1
    events.push(makeEvent(state, "task.started", {
      taskId: task.taskId,
      questionId: task.questionId,
      controllerRound: state.counters.controllerRounds,
    }))
    await persist(state, events)
    return {
      runId: state.runId,
      status: state.status,
      task: taskPayload(task),
      controllerRound: state.counters.controllerRounds,
      digest: makeStateDigest(state),
    }
  }

  async function commit(input = {}) {
    const state = await load(input.runId)
    if (state.status !== "researching") throw new Error(`research_commit requires researching phase, got ${state.status}`)
    const task = taskById(state, input.taskId)
    if (task.status !== "running") throw new Error(`task ${task.taskId} is not running`)

    const events = []
    const sources = normalizeSourceRecords(state, input.sources, events)
    const evidence = addEvidenceRecords(state, input.evidence, sources, events)
    const findings = addFindings(state, input.findings, evidence.newEvidenceIds, events)
    const contradictions = addContradictions(state, input.contradictions, evidence.newEvidenceIds, events)
    updateContradictions(state, input.contradictionUpdates, events)
    applyQuestionUpdates(state, safeArray(input.questionUpdates, "questionUpdates"), events)

    const followUpInputs = safeArray(input.followUpTasks, "followUpTasks")
    const followUpTasks = []
    for (const followUpInput of followUpInputs) {
      const followUp = addTask(state, {
        ...followUpInput,
        type: followUpInput.type ?? "follow-up",
      }, events)
      if (!followUp) break
      followUpTasks.push(followUp)
    }

    const summary = input.summary === undefined ? "" : assertNonEmptyString(input.summary, "commit summary", 4_000)
    if (sources.newRecords.length === 0 && evidence.newEvidenceIds.length === 0 && findings.length === 0 && contradictions.length === 0 && followUpTasks.length === 0 && (input.questionUpdates ?? []).length === 0 && (input.contradictionUpdates ?? []).length === 0 && !summary) {
      throw new Error("research_commit must record evidence, a finding, a contradiction, a follow-up, a question update, or a summary")
    }

    const failed = input.failed === true
    if (failed && !summary) throw new Error("a failed research task needs a failure summary")
    task.status = failed ? "failed" : "completed"
    task.completedAt = timestamp()
    if (failed) state.counters.tasksFailed += 1
    else state.counters.tasksCompleted += 1
    events.push(makeEvent(state, failed ? "task.failed" : "task.completed", {
      taskId: task.taskId,
      questionId: task.questionId,
      summaryLength: summary.length,
      sources: sources.newRecords.length,
      evidence: evidence.newEvidenceIds.length,
      findings: findings.length,
      contradictions: contradictions.length,
      followUps: followUpTasks.length,
    }))
    updateBudgetAfterCommit(state, events)
    await persist(state, events)
    return {
      runId: state.runId,
      status: state.status,
      taskId: task.taskId,
      created: {
        sources: sources.newRecords.map((source) => ({ sourceId: source.sourceId, canonicalUrl: source.canonicalUrl })),
        evidence: evidence.newEvidenceIds.map((evidenceId, index) => ({ index, evidenceId })),
        findings: findings.map((finding) => ({ findingId: finding.findingId, evidenceIds: finding.evidenceIds })),
        contradictions: contradictions.map((contradiction) => ({ contradictionId: contradiction.contradictionId })),
        followUpTasks: followUpTasks.map(taskPayload),
      },
      digest: makeStateDigest(state),
    }
  }

  async function stateView(input = {}) {
    const state = await load(input.runId)
    const view = input.view ?? "digest"
    if (view === "digest") return { runId: state.runId, view, digest: makeStateDigest(state) }
    if (view === "question") {
      const question = questionById(state, input.questionId)
      return {
        runId: state.runId,
        view,
        question,
        tasks: state.tasks.filter((task) => task.questionId === question.questionId).map(taskPayload),
        evidence: state.evidence.filter((evidence) => evidence.questionId === question.questionId).slice(-30),
        findings: state.findings.filter((finding) => finding.questionId === question.questionId).slice(-20),
      }
    }
    if (view === "evidence") {
      return {
        runId: state.runId,
        view,
        sources: state.sources.slice(-40),
        evidence: state.evidence.slice(-60),
        findings: state.findings.slice(-30),
      }
    }
    if (view === "verification") {
      return {
        runId: state.runId,
        view,
        claims: state.claims,
        contradictions: state.contradictions,
        blockers: verificationBlockers(state),
      }
    }
    throw new Error("research_state view must be digest, question, evidence, or verification")
  }

  function verificationBlockers(state) {
    return {
      criticalQuestionsIncomplete: criticalQuestionsIncomplete(state).map(questionCoverageSummary),
      openCriticalContradictions: openCriticalContradictions(state).map((contradiction) => ({
        contradictionId: contradiction.contradictionId,
        proposition: contradiction.proposition,
        resolution: contradiction.resolution,
      })),
      criticalClaims: state.claims
        .filter((claim) => claim.critical && claim.verification !== "SUPPORTED")
        .map((claim) => ({
          claimId: claim.claimId,
          statement: claim.statement,
          verification: claim.verification,
          evidenceIds: claim.evidenceIds,
        })),
    }
  }

  async function verify(input = {}) {
    const state = await load(input.runId)
    if (!["researching", "verifying"].includes(state.status)) throw new Error(`research_verify requires researching or verifying phase, got ${state.status}`)
    if (state.tasks.some((task) => task.status === "running")) throw new Error("research_verify cannot run while a task is running")
    const pending = sortFrontier(state.tasks)
    const budgetExhausted = state.budget.exhausted || hasHardBudget(state)
    if (state.status === "researching" && pending.length > 0 && !budgetExhausted) {
      throw new Error("research_verify cannot skip pending research tasks")
    }

    const events = []
    if (state.status === "researching") beginVerification(state, events, budgetExhausted ? "budget reached" : "frontier ready")
    const claimsInput = safeArray(input.claims, "claims")
    if (claimsInput.length === 0) throw new Error("research_verify requires at least one claim")
    for (const inputClaim of claimsInput) {
      if (!inputClaim || typeof inputClaim !== "object") throw new Error("each claim must be an object")
      let claim = inputClaim.claimId ? state.claims.find((candidate) => candidate.claimId === inputClaim.claimId) : null
      if (inputClaim.claimId && !claim) throw new Error(`unknown claim: ${inputClaim.claimId}`)
      if (!claim) {
        const statement = assertNonEmptyString(inputClaim.statement, "claim.statement", 4_000)
        const evidenceIds = uniqueStrings(inputClaim.evidenceIds ?? [], "claim.evidenceIds")
        for (const evidenceId of evidenceIds) evidenceById(state, evidenceId)
        const verification = assertEnum(inputClaim.verification ?? inputClaim.verdict, VERIFICATION_RESULTS, "claim.verification")
        if (verification === "SUPPORTED" && evidenceIds.length === 0) throw new Error("a SUPPORTED claim must reference evidence")
        claim = {
          claimId: allocateId(state, "claim", "claim"),
          statement,
          evidenceIds,
          critical: inputClaim.critical === true,
          verification,
          notes: inputClaim.notes ? assertNonEmptyString(inputClaim.notes, "claim.notes", 4_000) : null,
          createdAt: timestamp(),
          updatedAt: timestamp(),
        }
        state.claims.push(claim)
        state.counters.claimsRecorded += 1
      } else {
        if (inputClaim.statement !== undefined) claim.statement = assertNonEmptyString(inputClaim.statement, "claim.statement", 4_000)
        if (inputClaim.evidenceIds !== undefined) claim.evidenceIds = uniqueStrings(inputClaim.evidenceIds, "claim.evidenceIds")
        for (const evidenceId of claim.evidenceIds) evidenceById(state, evidenceId)
        if (inputClaim.critical !== undefined) claim.critical = inputClaim.critical === true
        claim.verification = assertEnum(inputClaim.verification ?? inputClaim.verdict, VERIFICATION_RESULTS, "claim.verification")
        if (inputClaim.notes !== undefined) claim.notes = assertNonEmptyString(inputClaim.notes, "claim.notes", 4_000)
        claim.updatedAt = timestamp()
      }
      if (claim.verification === "SUPPORTED" && claim.evidenceIds.length === 0) throw new Error("a SUPPORTED claim must reference evidence")
      events.push(makeEvent(state, "claim.verified", {
        claimId: claim.claimId,
        critical: claim.critical,
        verification: claim.verification,
        evidenceCount: claim.evidenceIds.length,
      }))
    }

    let blockers = verificationBlockers(state)
    const needsMoreResearch = blockers.criticalQuestionsIncomplete.length > 0 || blockers.openCriticalContradictions.length > 0 || blockers.criticalClaims.length > 0
    const followUpTasks = []
    if (needsMoreResearch && !state.budget.exhausted && !hasHardBudget(state)) {
      for (const inputTask of safeArray(input.followUpTasks, "followUpTasks")) {
        const task = addTask(state, { ...inputTask, type: inputTask.type ?? "verification" }, events)
        if (!task) break
        followUpTasks.push(task)
      }
      if (followUpTasks.length === 0) {
        for (const blocker of blockers.criticalClaims) {
          const claim = state.claims.find((candidate) => candidate.claimId === blocker.claimId)
          const questionId = claim?.evidenceIds.map((evidenceId) => evidenceById(state, evidenceId).questionId)[0] ?? criticalQuestionsIncomplete(state)[0]?.questionId
          if (!questionId) break
          const task = addTask(state, {
            questionId,
            objective: `Strengthen or revise the claim: ${claim.statement}`,
            type: "verification",
            priority: "critical",
            reason: `claim verification is ${claim.verification}`,
          }, events)
          if (!task) break
          followUpTasks.push(task)
        }
        for (const contradiction of openCriticalContradictions(state)) {
          if (!canCreateTask(state)) break
          const task = addConflictTask(state, contradiction, events)
          if (task) followUpTasks.push(task)
        }
        for (const question of criticalQuestionsIncomplete(state)) {
          if (!canCreateTask(state)) break
          const task = addVerificationTaskForGap(state, question, events)
          if (task) followUpTasks.push(task)
        }
      }
    }

    blockers = verificationBlockers(state)
    const stillBlocked = blockers.criticalQuestionsIncomplete.length > 0 || blockers.openCriticalContradictions.length > 0 || blockers.criticalClaims.length > 0
    if (stillBlocked && followUpTasks.length === 0 && !state.budget.exhausted && hasHardBudget(state)) {
      markBudgetExhausted(state, "verification_follow_up_budget", events)
    }
    if (stillBlocked && !state.budget.exhausted) {
      transitionState(state, "researching")
    } else {
      transitionState(state, "writing")
    }
    events.push(makeEvent(state, "verification.completed", {
      needsMoreResearch: stillBlocked && !state.budget.exhausted,
      criticalClaimBlockers: blockers.criticalClaims.length,
      openCriticalContradictions: blockers.openCriticalContradictions.length,
      criticalQuestionsIncomplete: blockers.criticalQuestionsIncomplete.length,
    }))
    await persist(state, events)
    return {
      runId: state.runId,
      status: state.status,
      needsMoreResearch: stillBlocked && !state.budget.exhausted,
      eligibleForCompletion: state.status === "writing",
      followUpTasks: followUpTasks.map(taskPayload),
      claims: state.claims.map((claim) => ({
        claimId: claim.claimId,
        statement: claim.statement,
        critical: claim.critical,
        verification: claim.verification,
        evidenceIds: claim.evidenceIds,
      })),
      blockers,
      digest: makeStateDigest(state),
    }
  }

  function reportLimitations(state) {
    const blockers = verificationBlockers(state)
    const lines = []
    if (state.budget.exhausted) lines.push(`- Research budget exhausted (${state.budget.exhaustionReason ?? "configured limit"}).`)
    for (const question of blockers.criticalQuestionsIncomplete) lines.push(`- Critical question ${question.questionId} remains ${question.status} at ${question.satisfied}/${question.total} required criteria.`)
    for (const contradiction of blockers.openCriticalContradictions) lines.push(`- Critical contradiction remains open: ${contradiction.proposition}`)
    for (const claim of blockers.criticalClaims) lines.push(`- Critical claim ${claim.claimId} is ${claim.verification}: ${claim.statement}`)
    for (const contradiction of state.contradictions.filter((candidate) => candidate.status === "accepted_uncertainty")) lines.push(`- Accepted uncertainty: ${contradiction.proposition} (${contradiction.resolution})`)
    return lines
  }

  async function complete(input = {}) {
    const state = await load(input.runId)
    if (state.status !== "writing") throw new Error(`research_complete requires writing phase, got ${state.status}`)
    const report = assertNonEmptyString(input.report, "report", 200_000)
    const blockers = verificationBlockers(state)
    const unresolved = blockers.criticalQuestionsIncomplete.length > 0 || blockers.openCriticalContradictions.length > 0 || blockers.criticalClaims.length > 0
    const budgetExhausted = state.budget.exhausted || hasHardBudget(state)
    if (unresolved && !budgetExhausted) throw new Error("research_complete is blocked by unresolved critical evidence")
    const limitations = reportLimitations(state)
    const finalReport = limitations.length > 0 ? `${report}\n\n## Research limitations\n${limitations.join("\n")}` : report
    const reportPath = await store.writeReport(state.runId, finalReport)
    state.reportPath = reportPath
    transitionState(state, "completed")
    const events = [
      makeEvent(state, "report.completed", { reportLength: finalReport.length, reportPath }),
      makeEvent(state, "research.completed", { reportPath, limitations: limitations.length }),
    ]
    await persist(state, events)
    return {
      runId: state.runId,
      status: state.status,
      reportPath,
      limitations,
      digest: makeStateDigest(state),
    }
  }

  return {
    dataRoot: store.dataRoot,
    start,
    next,
    commit,
    state: stateView,
    verify,
    complete,
    load,
    store,
  }
}
