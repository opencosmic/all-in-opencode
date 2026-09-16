import { URL } from "node:url"

export const PHASES = ["planning", "researching", "verifying", "writing", "completed"]
export const QUESTION_PRIORITIES = ["critical", "high", "normal"]
export const QUESTION_STATUSES = ["pending", "researching", "sufficient", "blocked"]
export const TASK_STATUSES = ["pending", "running", "completed", "failed", "superseded"]
export const TASK_TYPES = ["initial", "follow-up", "verification", "conflict-resolution", "gap-filling"]
export const CONTRADICTION_STATUSES = ["open", "resolved", "accepted_uncertainty"]
export const VERIFICATION_RESULTS = ["SUPPORTED", "PARTIAL", "UNSUPPORTED", "CONTRADICTED"]
export const CONFIDENCE_LEVELS = ["low", "medium", "high"]

// Professor's agent definition is intentionally kept at a modest outer step
// ceiling. The runtime observes completed outer steps when the host exposes
// them. This fixed controller limit is only the conservative fallback for
// hosts where that observation is unavailable; it is deliberately not derived
// from an optimistic steps-per-round average.
export const PROFESSOR_OUTER_STEP_LIMIT = 32
export const COMPLETION_STEP_RESERVE = 8
// Retained in the persisted budget for compatibility and diagnostics. It is
// not used to derive the fallback controller limit.
export const ESTIMATED_STEPS_PER_CONTROLLER_ROUND = 3
export const FALLBACK_CONTROLLER_ROUND_LIMIT = 5
// This is the maximum configured controller ceiling when the host has
// demonstrated that actual outer-step events are available. It is still
// gated by the observed outer-step reserve rather than a steps-per-round
// estimate. Keep the old export name for callers and persisted-state tests.
export const SAFE_CONTROLLER_ROUND_LIMIT = 8
export const DEFAULT_COMPLETION_RESERVE = 2

const PRIORITY_WEIGHT = { critical: 3, high: 2, normal: 1 }
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "mkt_tok",
])

function emptyCompletionMetrics() {
  return {
    durationMs: null,
    durationDisplay: null,
    citationCount: null,
    searchCount: 0,
    questionsTotal: null,
    questionsResolved: null,
    sourcesDiscovered: null,
    sourcesUsed: null,
    remainingUncertainties: null,
    contradictionCount: null,
    outerStepsObserved: 0,
    claimStatusCounts: emptyClaimStatusCounts(),
  }
}

export function emptyClaimStatusCounts() {
  return {
    supported: 0,
    partial: 0,
    unsupported: 0,
    contradicted: 0,
  }
}

export function claimStatusCounts(claims = []) {
  const counts = emptyClaimStatusCounts()
  for (const claim of claims) {
    const key = String(claim?.verification ?? "").toLowerCase()
    if (key in counts) counts[key] += 1
  }
  return counts
}

function normalizeClaimStatusCounts(value) {
  const defaults = emptyClaimStatusCounts()
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults
  return Object.fromEntries(Object.keys(defaults).map((key) => [key, value[key] ?? defaults[key]]))
}

function defaultCompletionReserve(maxControllerRounds) {
  return Math.min(DEFAULT_COMPLETION_RESERVE, Math.max(0, maxControllerRounds - 1))
}

function outerStepObservationAvailable(state) {
  return Number.isInteger(state?.metrics?.outerStepsObserved) && state.metrics.outerStepsObserved > 0
}

function effectiveControllerRoundLimit(state, maxControllerRounds) {
  return outerStepObservationAvailable(state)
    ? maxControllerRounds
    : Math.min(maxControllerRounds, FALLBACK_CONTROLLER_ROUND_LIMIT)
}

function normalizeBudgetShape(budget) {
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) return budget
  const maxControllerRounds = Number.isInteger(budget.maxControllerRounds)
    ? Math.max(1, Math.min(budget.maxControllerRounds, SAFE_CONTROLLER_ROUND_LIMIT))
    : SAFE_CONTROLLER_ROUND_LIMIT
  budget.maxControllerRounds = maxControllerRounds
  if (budget.outerStepLimit === undefined) budget.outerStepLimit = PROFESSOR_OUTER_STEP_LIMIT
  if (budget.completionStepReserve === undefined) budget.completionStepReserve = COMPLETION_STEP_RESERVE
  if (budget.estimatedStepsPerControllerRound === undefined) budget.estimatedStepsPerControllerRound = ESTIMATED_STEPS_PER_CONTROLLER_ROUND
  if (budget.completionReserve === undefined) budget.completionReserve = defaultCompletionReserve(maxControllerRounds)
  else if (Number.isInteger(budget.completionReserve)) budget.completionReserve = Math.max(0, Math.min(budget.completionReserve, maxControllerRounds - 1))
  return budget
}

export function normalizeResearchState(state) {
  if (!state || typeof state !== "object") return state
  if (state.schemaVersion === undefined) state.schemaVersion = 1
  if (state.startedAt === undefined) state.startedAt = state.createdAt ?? null
  if (state.completedAt === undefined) state.completedAt = null
  if (state.reportPath === undefined) state.reportPath = null
  if (state.libraryPath === undefined) state.libraryPath = null
  if (state.libraryLinkError === undefined) state.libraryLinkError = null
  normalizeBudgetShape(state.budget)
  const legacyClaimCounts = claimStatusCounts(Array.isArray(state.claims) ? state.claims : [])
  if (state.metrics === undefined || state.metrics === null) state.metrics = { ...emptyCompletionMetrics(), claimStatusCounts: legacyClaimCounts }
  else if (typeof state.metrics === "object" && !Array.isArray(state.metrics)) {
    state.metrics = {
      ...emptyCompletionMetrics(),
      ...state.metrics,
      claimStatusCounts: state.metrics.claimStatusCounts === undefined
        ? legacyClaimCounts
        : normalizeClaimStatusCounts(state.metrics.claimStatusCounts),
    }
  }
  if (state.counters && typeof state.counters === "object" && !Array.isArray(state.counters)) {
    if (state.counters.tasksSuperseded === undefined) {
      state.counters.tasksSuperseded = Array.isArray(state.tasks)
        ? state.tasks.filter((task) => task?.status === "superseded").length
        : 0
    }
  }
  if (Array.isArray(state.tasks)) {
    for (const task of state.tasks) {
      if (task.supersededAt === undefined) task.supersededAt = null
      if (task.supersededReason === undefined) task.supersededReason = null
      if (task.supersedeWhenSufficient === undefined) task.supersedeWhenSufficient = true
      if (task.status === "superseded") {
        if (task.supersededAt === null) task.supersededAt = task.completedAt ?? state.updatedAt ?? state.createdAt ?? null
        if (task.supersededReason === null) task.supersededReason = "task was superseded"
      }
    }
  }
  return state
}

export function isSafeId(value) {
  return typeof value === "string" && SAFE_ID.test(value)
}

export function assertSafeId(value, label = "id") {
  if (!isSafeId(value)) throw new Error(`${label} must be a safe generated identifier`)
  return value
}

export function assertNonEmptyString(value, label, maxLength = 20_000) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  if (value.length > maxLength) throw new Error(`${label} exceeds the maximum length of ${maxLength}`)
  return value.trim()
}

export function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of: ${allowed.join(", ")}`)
  return value
}

export function canonicalizeUrl(value) {
  const original = assertNonEmptyString(value, "source URL", 4_000)
  let parsed
  try {
    parsed = new URL(original)
  } catch {
    throw new Error(`source URL is invalid: ${original}`)
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("source URL must use http or https")
  if (parsed.username || parsed.password) throw new Error("source URL must not contain credentials")

  parsed.hash = ""
  parsed.hostname = parsed.hostname.toLowerCase()
  if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
    parsed.port = ""
  }
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "")

  for (const key of [...parsed.searchParams.keys()]) {
    if (/^utm_/i.test(key) || TRACKING_PARAMETERS.has(key.toLowerCase())) parsed.searchParams.delete(key)
  }

  return parsed.toString()
}

export function normalizeBudget(raw, questionCount) {
  const input = raw && typeof raw === "object" ? raw : {}
  const defaults = {
    maxControllerRounds: SAFE_CONTROLLER_ROUND_LIMIT,
    maxTasks: 24,
    maxSources: 80,
    maxEvidenceRecords: 160,
  }
  const budget = {}
  for (const key of Object.keys(defaults)) {
    const value = input[key] ?? defaults[key]
    if (!Number.isInteger(value) || value < 1 || value > 500) {
      throw new Error(`budget.${key} must be an integer between 1 and 500`)
    }
    budget[key] = key === "maxControllerRounds" ? Math.min(value, SAFE_CONTROLLER_ROUND_LIMIT) : value
  }
  if (budget.maxTasks < questionCount) throw new Error("budget.maxTasks cannot be smaller than the number of research questions")
  const requestedReserve = input.completionReserve ?? DEFAULT_COMPLETION_RESERVE
  if (!Number.isInteger(requestedReserve) || requestedReserve < 0 || requestedReserve > 500) {
    throw new Error("budget.completionReserve must be an integer between 0 and 500")
  }
  return {
    ...budget,
    outerStepLimit: PROFESSOR_OUTER_STEP_LIMIT,
    completionStepReserve: COMPLETION_STEP_RESERVE,
    estimatedStepsPerControllerRound: ESTIMATED_STEPS_PER_CONTROLLER_ROUND,
    completionReserve: Math.min(requestedReserve, Math.max(0, budget.maxControllerRounds - 1)),
    exhausted: false,
    exhaustionReason: null,
  }
}

function normalizeCriteria(raw, questionId) {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("each research question needs at least one completion criterion")
  const seen = new Set()
  return raw.map((criterion, index) => {
    const label = typeof criterion === "string" ? criterion : criterion?.label
    const normalized = assertNonEmptyString(label, `completion criterion ${index + 1}`, 1_000)
    const key = normalized.toLocaleLowerCase()
    if (seen.has(key)) throw new Error(`duplicate completion criterion for ${questionId}: ${normalized}`)
    seen.add(key)
    return {
      criterionId: `${questionId}-criterion-${index + 1}`,
      label: normalized,
      required: typeof criterion === "object" && criterion !== null && criterion.required === false ? false : true,
      satisfied: false,
      evidenceIds: [],
    }
  })
}

function normalizeQuestionSpec(spec, questionId) {
  if (!spec || typeof spec !== "object") throw new Error("each research question must be an object")
  const question = assertNonEmptyString(spec.question, `${questionId}.question`, 4_000)
  const priority = assertEnum(spec.priority, QUESTION_PRIORITIES, `${questionId}.priority`)
  const evidenceNeeded = spec.evidenceNeeded
  if (!Array.isArray(evidenceNeeded) || evidenceNeeded.length === 0) {
    throw new Error(`${questionId}.evidenceNeeded must contain at least one requirement`)
  }
  const normalizedEvidenceNeeded = evidenceNeeded.map((item, index) => assertNonEmptyString(item, `${questionId}.evidenceNeeded[${index}]`, 1_000))
  const sourcePreferences = Array.isArray(spec.sourcePreferences)
    ? spec.sourcePreferences.map((item, index) => assertNonEmptyString(item, `${questionId}.sourcePreferences[${index}]`, 500))
    : []
  const completionCriteria = normalizeCriteria(spec.completionCriteria ?? spec.criteria, questionId)
  if (!completionCriteria.some((criterion) => criterion.required)) {
    throw new Error(`${questionId} must have at least one required completion criterion`)
  }
  return {
    questionId,
    question,
    priority,
    evidenceNeeded: normalizedEvidenceNeeded,
    completionCriteria,
    sourcePreferences,
    status: "pending",
  }
}

export function coverageForQuestion(question) {
  const required = question.completionCriteria.filter((criterion) => criterion.required)
  const satisfied = required.filter((criterion) => criterion.satisfied && criterion.evidenceIds.length > 0)
  const total = required.length
  return {
    satisfied: satisfied.length,
    total,
    percentage: total === 0 ? 0 : Math.round((satisfied.length / total) * 100),
    complete: total > 0 && satisfied.length === total,
  }
}

export function questionIsSufficient(question) {
  return coverageForQuestion(question).complete
}

export function priorityWeight(priority) {
  return PRIORITY_WEIGHT[priority] ?? 0
}

export function sortFrontier(tasks) {
  return [...tasks]
    .filter((task) => task.status === "pending")
    .sort((left, right) => priorityWeight(right.priority) - priorityWeight(left.priority) || left.sequence - right.sequence)
}

export function openCriticalContradictions(state) {
  return state.contradictions.filter((contradiction) => contradiction.critical && contradiction.status === "open")
}

export function criticalQuestionsIncomplete(state) {
  return state.questions.filter((question) => question.priority === "critical" && !questionIsSufficient(question))
}

export function hasHardBudget(state) {
  const outerStepLimit = Number.isInteger(state?.budget?.outerStepLimit)
    ? state.budget.outerStepLimit
    : PROFESSOR_OUTER_STEP_LIMIT
  const completionStepReserve = Number.isInteger(state?.budget?.completionStepReserve)
    ? state.budget.completionStepReserve
    : COMPLETION_STEP_RESERVE
  const outerStepsObserved = Number.isInteger(state?.metrics?.outerStepsObserved)
    ? state.metrics.outerStepsObserved
    : 0
  const maxControllerRounds = Number.isInteger(state?.budget?.maxControllerRounds)
    ? Math.max(1, Math.min(state.budget.maxControllerRounds, SAFE_CONTROLLER_ROUND_LIMIT))
    : SAFE_CONTROLLER_ROUND_LIMIT
  return Boolean(
    state.budget.exhausted ||
      state.counters.controllerRounds >= effectiveControllerRoundLimit(state, maxControllerRounds) ||
      state.counters.sourcesRecorded >= state.budget.maxSources ||
      state.counters.evidenceRecorded >= state.budget.maxEvidenceRecords ||
      outerStepsObserved + completionStepReserve >= outerStepLimit,
  )
}

export function researchCapacity(state) {
  const maxControllerRounds = Number.isInteger(state?.budget?.maxControllerRounds)
    ? Math.max(1, Math.min(state.budget.maxControllerRounds, SAFE_CONTROLLER_ROUND_LIMIT))
    : SAFE_CONTROLLER_ROUND_LIMIT
  const completionReserve = Number.isInteger(state?.budget?.completionReserve)
    ? Math.max(0, Math.min(state.budget.completionReserve, maxControllerRounds - 1))
    : defaultCompletionReserve(maxControllerRounds)
  const controllerRoundLimit = effectiveControllerRoundLimit(state, maxControllerRounds)
  const normalResearchRoundLimit = Math.max(1, controllerRoundLimit - completionReserve)
  const controllerRoundsUsed = Number.isInteger(state?.counters?.controllerRounds) ? state.counters.controllerRounds : 0
  const controllerRoundsRemaining = Math.max(0, maxControllerRounds - controllerRoundsUsed)
  const outerStepLimit = Number.isInteger(state?.budget?.outerStepLimit)
    ? state.budget.outerStepLimit
    : PROFESSOR_OUTER_STEP_LIMIT
  const completionStepReserveInBudget = Number.isInteger(state?.budget?.completionStepReserve)
    ? state.budget.completionStepReserve
    : COMPLETION_STEP_RESERVE
  const outerStepsObserved = Number.isInteger(state?.metrics?.outerStepsObserved)
    ? Math.max(0, state.metrics.outerStepsObserved)
    : 0
  const outerStepsRemaining = Math.max(0, outerStepLimit - outerStepsObserved)
  const outerResearchStepsRemaining = Math.max(0, outerStepsRemaining - completionStepReserveInBudget)
  const outerStepCapacityReached = outerResearchStepsRemaining <= 0
  const researchRoundsRemaining = outerStepCapacityReached
    ? 0
    : Math.max(0, normalResearchRoundLimit - controllerRoundsUsed)
  const taskSlotsRemaining = Math.max(0, (state?.budget?.maxTasks ?? 0) - (state?.counters?.tasksCreated ?? 0))
  const sourceRecordsRemaining = Math.max(0, (state?.budget?.maxSources ?? 0) - (state?.counters?.sourcesRecorded ?? 0))
  const evidenceRecordsRemaining = Math.max(0, (state?.budget?.maxEvidenceRecords ?? 0) - (state?.counters?.evidenceRecorded ?? 0))
  return {
    outerStepLimit,
    completionStepReserve: completionStepReserveInBudget,
    estimatedStepsPerControllerRound: state?.budget?.estimatedStepsPerControllerRound ?? ESTIMATED_STEPS_PER_CONTROLLER_ROUND,
    outerStepsObserved,
    outerStepsRemaining,
    outerResearchStepsRemaining,
    outerStepCapacityReached,
    completionReserve,
    maxControllerRounds,
    controllerRoundLimit,
    outerStepObservationAvailable: outerStepObservationAvailable(state),
    normalResearchRoundLimit,
    controllerRoundsUsed,
    controllerRoundsRemaining,
    researchRoundsRemaining,
    taskSlotsRemaining,
    sourceRecordsRemaining,
    evidenceRecordsRemaining,
    exhausted: Boolean(state?.budget?.exhausted),
    closureRecommended: researchRoundsRemaining <= 1,
  }
}

export function transitionState(state, nextStatus) {
  assertEnum(nextStatus, PHASES, "status")
  const allowed = {
    planning: ["researching"],
    researching: ["verifying"],
    verifying: ["researching", "writing"],
    writing: ["completed"],
    completed: [],
  }
  if (!allowed[state.status]?.includes(nextStatus)) {
    throw new Error(`invalid research phase transition: ${state.status} -> ${nextStatus}`)
  }
  state.status = nextStatus
  return state
}

export function createResearchState({ runId, objective, questions, budget, now, makeId }) {
  assertSafeId(runId, "runId")
  const normalizedObjective = assertNonEmptyString(objective, "objective", 20_000)
  if (!Array.isArray(questions) || questions.length === 0) throw new Error("research plan must contain at least one question")
  if (questions.length > 24) throw new Error("research plan cannot contain more than 24 questions")

  const normalizedQuestions = questions.map((question, index) => {
    const questionId = makeId("question")
    return normalizeQuestionSpec(question, questionId, index)
  })

  const startedAt = now()
  const state = {
    schemaVersion: 2,
    runId,
    objective: normalizedObjective,
    status: "planning",
    questions: normalizedQuestions,
    tasks: [],
    sources: [],
    evidence: [],
    findings: [],
    contradictions: [],
    claims: [],
    budget: { ...budget },
    counters: {
      controllerRounds: 0,
      tasksCreated: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      tasksSuperseded: 0,
      sourcesRecorded: 0,
      evidenceRecorded: 0,
      findingsRecorded: 0,
      contradictionsRecorded: 0,
      claimsRecorded: 0,
      eventsRecorded: 0,
      nextIds: {
        question: normalizedQuestions.length,
        task: 0,
        source: 0,
        evidence: 0,
        finding: 0,
        contradiction: 0,
        claim: 0,
        event: 0,
      },
    },
    createdAt: startedAt,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    reportPath: null,
    libraryPath: null,
    libraryLinkError: null,
    metrics: emptyCompletionMetrics(),
  }

  for (const question of normalizedQuestions) {
    const taskId = makeId("task")
    state.counters.nextIds.task += 1
    state.counters.tasksCreated += 1
    state.tasks.push({
      taskId,
      questionId: question.questionId,
      objective: question.question,
      type: "initial",
      priority: question.priority,
      reason: "initial research plan",
      status: "pending",
      sequence: state.counters.tasksCreated,
      createdAt: now(),
      startedAt: null,
      completedAt: null,
      supersededAt: null,
      supersededReason: null,
      supersedeWhenSufficient: true,
    })
  }
  return state
}

export function makeStateDigest(state) {
  const running = state.tasks.find((task) => task.status === "running") ?? null
  const pending = sortFrontier(state.tasks).slice(0, 8)
  const evidenceById = new Map(state.evidence.map((evidence) => [evidence.evidenceId, evidence]))
  const verificationEvidenceIds = [
    ...state.claims.flatMap((claim) => claim.evidenceIds),
    ...state.contradictions.flatMap((contradiction) => [
      ...(contradiction.sideA?.evidenceIds ?? []),
      ...(contradiction.sideB?.evidenceIds ?? []),
    ]),
  ]
  const verificationEvidence = [...new Set(verificationEvidenceIds)]
    .map((evidenceId) => evidenceById.get(evidenceId))
    .filter(Boolean)
    .slice(-30)
  return {
    runId: state.runId,
    objective: state.objective,
    status: state.status,
    questions: state.questions.map((question) => ({
      questionId: question.questionId,
      question: question.question,
      priority: question.priority,
      status: question.status,
      coverage: coverageForQuestion(question),
      completionCriteria: question.completionCriteria.map((criterion) => ({
        criterionId: criterion.criterionId,
        label: criterion.label,
        required: criterion.required,
        satisfied: criterion.satisfied,
        evidenceIds: [...criterion.evidenceIds],
      })),
    })),
    currentTask: running ? summarizeTask(running) : null,
    pendingTasks: pending.map(summarizeTask),
    openContradictions: state.contradictions
      .filter((contradiction) => contradiction.status === "open")
      .slice(-8)
      .map((contradiction) => ({
        contradictionId: contradiction.contradictionId,
        proposition: contradiction.proposition,
        critical: contradiction.critical,
        questionId: contradiction.questionId,
      })),
    recentEvidence: state.evidence.slice(-8).map((evidence) => ({
      evidenceId: evidence.evidenceId,
      questionId: evidence.questionId,
      sourceId: evidence.sourceId,
      citationUrl: evidence.citationUrl,
      fact: evidence.fact,
      supportingSpan: evidence.supportingSpan,
      relation: evidence.relation,
      qualifiers: evidence.qualifiers,
    })),
    recentFindings: state.findings.slice(-8).map((finding) => ({
      findingId: finding.findingId,
      questionId: finding.questionId,
      statement: finding.statement,
      evidenceIds: finding.evidenceIds,
      confidence: finding.confidence,
    })),
    verification: {
      claims: state.claims.length,
      claimStatusCounts: claimStatusCounts(state.claims),
      criticalBlockers: state.claims.filter((claim) => claim.critical && claim.verification !== "SUPPORTED").length,
      openCriticalContradictions: openCriticalContradictions(state).length,
      evidence: verificationEvidence.map((evidence) => ({
        evidenceId: evidence.evidenceId,
        questionId: evidence.questionId,
        sourceId: evidence.sourceId,
        citationUrl: evidence.citationUrl,
        fact: evidence.fact,
        supportingSpan: evidence.supportingSpan,
        relation: evidence.relation,
        qualifiers: evidence.qualifiers,
      })),
      claimSummaries: state.claims.slice(-12).map((claim) => ({
        claimId: claim.claimId,
        statement: claim.statement,
        critical: claim.critical,
        verification: claim.verification,
        evidenceIds: claim.evidenceIds,
      })),
    },
    budget: { ...state.budget, capacity: researchCapacity(state) },
    metrics: { ...state.metrics },
    counters: { ...state.counters, nextIds: undefined },
  }
}

function summarizeTask(task) {
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

function assertUniqueIds(items, key, label) {
  const seen = new Set()
  for (const item of items) {
    assertSafeId(item[key], `${label}.${key}`)
    if (seen.has(item[key])) throw new Error(`duplicate ${label} ID: ${item[key]}`)
    seen.add(item[key])
  }
}

export function validateResearchState(state) {
  if (!state || typeof state !== "object") throw new Error("research state must be an object")
  normalizeResearchState(state)
  if (!Number.isInteger(state.schemaVersion) || state.schemaVersion < 1 || state.schemaVersion > 2) {
    throw new Error("research state schemaVersion is invalid")
  }
  assertSafeId(state.runId, "runId")
  assertEnum(state.status, PHASES, "status")
  assertNonEmptyString(state.objective, "objective", 20_000)
  assertNonEmptyString(state.startedAt, "startedAt", 100)
  if (state.completedAt !== null) assertNonEmptyString(state.completedAt, "completedAt", 100)
  if (state.reportPath !== null) assertNonEmptyString(state.reportPath, "reportPath", 4_000)
  if (state.libraryPath !== null) assertNonEmptyString(state.libraryPath, "libraryPath", 4_000)
  if (state.libraryLinkError !== null) assertNonEmptyString(state.libraryLinkError, "libraryLinkError", 4_000)
  if (!state.metrics || typeof state.metrics !== "object" || Array.isArray(state.metrics)) {
    throw new Error("research state completion metrics are invalid")
  }
  if (!Number.isInteger(state.metrics.searchCount) || state.metrics.searchCount < 0) {
    throw new Error("research state searchCount is invalid")
  }
  if (!Number.isInteger(state.metrics.outerStepsObserved) || state.metrics.outerStepsObserved < 0) {
    throw new Error("research state outerStepsObserved is invalid")
  }
  for (const key of ["durationMs", "citationCount", "questionsTotal", "questionsResolved", "sourcesDiscovered", "sourcesUsed", "contradictionCount"]) {
    const value = state.metrics[key]
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`research state ${key} is invalid`)
    }
  }
  if (state.metrics.durationDisplay !== null) assertNonEmptyString(state.metrics.durationDisplay, "research state durationDisplay", 100)
  if (state.metrics.remainingUncertainties !== null) {
    if (!Array.isArray(state.metrics.remainingUncertainties)) throw new Error("research state remainingUncertainties is invalid")
    for (const uncertainty of state.metrics.remainingUncertainties) assertNonEmptyString(uncertainty, "remainingUncertainty", 4_000)
  }
  const claimCounts = state.metrics.claimStatusCounts
  if (!claimCounts || typeof claimCounts !== "object" || Array.isArray(claimCounts)) {
    throw new Error("research state claimStatusCounts is invalid")
  }
  for (const key of Object.keys(emptyClaimStatusCounts())) {
    if (!Number.isInteger(claimCounts[key]) || claimCounts[key] < 0) throw new Error(`research state claimStatusCounts.${key} is invalid`)
  }
  if (!state.budget || typeof state.budget !== "object" || Array.isArray(state.budget)) throw new Error("research state budget is invalid")
  for (const key of ["maxControllerRounds", "maxTasks", "maxSources", "maxEvidenceRecords"]) {
    if (!Number.isInteger(state.budget[key]) || state.budget[key] < 1 || state.budget[key] > 500) {
      throw new Error(`research state budget.${key} is invalid`)
    }
  }
  if (state.budget.maxControllerRounds > SAFE_CONTROLLER_ROUND_LIMIT) throw new Error("research state controller budget exceeds the safe outer-step limit")
  for (const key of ["outerStepLimit", "completionStepReserve", "estimatedStepsPerControllerRound", "completionReserve"]) {
    if (!Number.isInteger(state.budget[key]) || state.budget[key] < 0) throw new Error(`research state budget.${key} is invalid`)
  }
  if (state.budget.outerStepLimit !== PROFESSOR_OUTER_STEP_LIMIT) throw new Error("research state outer step limit is invalid")
  if (state.budget.completionStepReserve > state.budget.outerStepLimit) throw new Error("research state completion step reserve is invalid")
  if (state.budget.estimatedStepsPerControllerRound < 1) throw new Error("research state estimated controller round cost is invalid")
  if (state.budget.completionReserve >= state.budget.maxControllerRounds) throw new Error("research state completion reserve is invalid")
  if (!Array.isArray(state.questions) || state.questions.length === 0) throw new Error("research state must contain questions")
  if (!Array.isArray(state.tasks)) throw new Error("research state tasks must be an array")
  if (!Array.isArray(state.sources) || !Array.isArray(state.evidence) || !Array.isArray(state.findings)) {
    throw new Error("research state evidence collections are invalid")
  }
  if (!Array.isArray(state.contradictions) || !Array.isArray(state.claims)) throw new Error("research state verification collections are invalid")
  assertUniqueIds(state.questions, "questionId", "question")
  assertUniqueIds(state.tasks, "taskId", "task")
  assertUniqueIds(state.sources, "sourceId", "source")
  assertUniqueIds(state.evidence, "evidenceId", "evidence")
  assertUniqueIds(state.findings, "findingId", "finding")
  assertUniqueIds(state.contradictions, "contradictionId", "contradiction")
  assertUniqueIds(state.claims, "claimId", "claim")

  const questionIds = new Set(state.questions.map((question) => question.questionId))
  const sourceIds = new Set(state.sources.map((source) => source.sourceId))
  const evidenceIds = new Set(state.evidence.map((evidence) => evidence.evidenceId))
  const sourcesById = new Map(state.sources.map((source) => [source.sourceId, source]))
  const evidenceById = new Map(state.evidence.map((evidence) => [evidence.evidenceId, evidence]))
  const running = state.tasks.filter((task) => task.status === "running")
  if (running.length > 1) throw new Error("research state cannot have more than one running task")

  for (const source of state.sources) {
    assertSafeId(source.sourceId, "source.sourceId")
    const url = assertNonEmptyString(source.url, `source ${source.sourceId} url`, 4_000)
    const canonicalUrl = assertNonEmptyString(source.canonicalUrl, `source ${source.sourceId} canonicalUrl`, 4_000)
    if (canonicalizeUrl(url) !== canonicalUrl || canonicalizeUrl(canonicalUrl) !== canonicalUrl) {
      throw new Error(`source ${source.sourceId} has an invalid canonical URL`)
    }
    if (!Array.isArray(source.observedUrls) || source.observedUrls.length === 0) throw new Error(`source ${source.sourceId} observedUrls is invalid`)
    for (const observedUrl of source.observedUrls) assertNonEmptyString(observedUrl, `source ${source.sourceId} observedUrl`, 4_000)
  }

  for (const question of state.questions) {
    assertEnum(question.priority, QUESTION_PRIORITIES, `question ${question.questionId} priority`)
    assertEnum(question.status, QUESTION_STATUSES, `question ${question.questionId} status`)
    if (!Array.isArray(question.completionCriteria) || question.completionCriteria.length === 0) {
      throw new Error(`question ${question.questionId} has no completion criteria`)
    }
    assertUniqueIds(question.completionCriteria, "criterionId", `question ${question.questionId} criterion`)
    for (const criterion of question.completionCriteria) {
      assertNonEmptyString(criterion.label, `criterion ${criterion.criterionId} label`, 1_000)
      if (typeof criterion.required !== "boolean") throw new Error(`criterion ${criterion.criterionId} required flag is invalid`)
      if (typeof criterion.satisfied !== "boolean") throw new Error(`criterion ${criterion.criterionId} satisfied flag is invalid`)
      if (!Array.isArray(criterion.evidenceIds)) throw new Error(`criterion ${criterion.criterionId} evidenceIds must be an array`)
      for (const evidenceId of criterion.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) throw new Error(`criterion ${criterion.criterionId} references unknown evidence ${evidenceId}`)
        const evidence = evidenceById.get(evidenceId)
        if (evidence.questionId !== question.questionId) {
          throw new Error(`criterion ${criterion.criterionId} references evidence from another question`)
        }
      }
      if (criterion.satisfied && criterion.evidenceIds.length === 0) {
        throw new Error(`criterion ${criterion.criterionId} cannot be satisfied without evidence`)
      }
    }
  }
  for (const task of state.tasks) {
    assertEnum(task.status, TASK_STATUSES, `task ${task.taskId} status`)
    assertEnum(task.type, TASK_TYPES, `task ${task.taskId} type`)
    assertEnum(task.priority, QUESTION_PRIORITIES, `task ${task.taskId} priority`)
    if (!questionIds.has(task.questionId)) throw new Error(`task ${task.taskId} references unknown question ${task.questionId}`)
    if (task.supersededAt !== null) assertNonEmptyString(task.supersededAt, `task ${task.taskId} supersededAt`, 100)
    if (task.supersededReason !== null) assertNonEmptyString(task.supersededReason, `task ${task.taskId} supersededReason`, 2_000)
    if (typeof task.supersedeWhenSufficient !== "boolean") throw new Error(`task ${task.taskId} supersedeWhenSufficient is invalid`)
    if (task.status === "superseded" && (!task.supersededAt || !task.supersededReason)) {
      throw new Error(`superseded task ${task.taskId} must record a timestamp and reason`)
    }
  }
  for (const evidence of state.evidence) {
    if (!questionIds.has(evidence.questionId)) throw new Error(`evidence ${evidence.evidenceId} references unknown question`)
    if (!sourceIds.has(evidence.sourceId)) throw new Error(`evidence ${evidence.evidenceId} references unknown source ${evidence.sourceId}`)
    if (!assertEnum(evidence.relation, ["supports", "contradicts", "context"], `evidence ${evidence.evidenceId} relation`)) return false
    assertNonEmptyString(evidence.citationUrl, `evidence ${evidence.evidenceId} citationUrl`, 4_000)
    assertNonEmptyString(evidence.fact, `evidence ${evidence.evidenceId} fact`, 4_000)
    assertNonEmptyString(evidence.supportingSpan, `evidence ${evidence.evidenceId} supportingSpan`, 8_000)
    if (!Array.isArray(evidence.qualifiers)) throw new Error(`evidence ${evidence.evidenceId} qualifiers must be an array`)
    for (const qualifier of evidence.qualifiers) assertNonEmptyString(qualifier, `evidence ${evidence.evidenceId} qualifier`, 1_000)
    if (canonicalizeUrl(evidence.citationUrl) !== sourcesById.get(evidence.sourceId).canonicalUrl) {
      throw new Error(`evidence ${evidence.evidenceId} citationUrl must identify source ${evidence.sourceId}`)
    }
  }
  for (const finding of state.findings) {
    if (!questionIds.has(finding.questionId)) throw new Error(`finding ${finding.findingId} references unknown question`)
    for (const evidenceId of finding.evidenceIds) if (!evidenceIds.has(evidenceId)) throw new Error(`finding ${finding.findingId} references unknown evidence ${evidenceId}`)
  }
  for (const contradiction of state.contradictions) {
    assertEnum(contradiction.status, CONTRADICTION_STATUSES, `contradiction ${contradiction.contradictionId} status`)
    for (const side of [contradiction.sideA, contradiction.sideB]) {
      if (!side || !Array.isArray(side.evidenceIds) || side.evidenceIds.length === 0) throw new Error(`contradiction ${contradiction.contradictionId} has an empty evidence side`)
      for (const evidenceId of side.evidenceIds) if (!evidenceIds.has(evidenceId)) throw new Error(`contradiction ${contradiction.contradictionId} references unknown evidence ${evidenceId}`)
    }
  }
  for (const claim of state.claims) {
    assertEnum(claim.verification, VERIFICATION_RESULTS, `claim ${claim.claimId} verification`)
    if (!Array.isArray(claim.evidenceIds)) throw new Error(`claim ${claim.claimId} evidenceIds must be an array`)
    for (const evidenceId of claim.evidenceIds) if (!evidenceIds.has(evidenceId)) throw new Error(`claim ${claim.claimId} references unknown evidence ${evidenceId}`)
  }
  return true
}
