import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import {
  createIsolatedConfig,
  detectOpenCodeVersion,
  normalizeEvents,
  resetResultsFile,
} from "../retrieval-foundation/lib.mjs"

export { createIsolatedConfig, detectOpenCodeVersion, normalizeEvents, resetResultsFile }

export const OUTER_STEP_LIMIT = 32
export const PROFESSOR_BENCHMARK_MODEL = "opencode/muse-spark-1.3-contributor-free"
export const PROFESSOR_BENCHMARK_VARIANT = "xhigh"
export const PROFESSOR_TOOL_NAMES = [
  "research_start",
  "research_next",
  "research_commit",
  "research_state",
  "research_verify",
  "research_complete",
  "research_report",
]

const REQUIRED_FIELDS = [
  "id",
  "category",
  "query",
  "requiresFreshness",
  "requiresPrimarySource",
  "expectedEvidenceMatchers",
  "critical",
  "repeatRuns",
]

export async function loadCases(path) {
  return validateCases(JSON.parse(await readFile(path, "utf8")))
}

export function validateCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error("Professor cases must be a non-empty array")
  const ids = new Set()
  for (const item of cases) {
    if (!item || typeof item !== "object") throw new Error("each Professor case must be an object")
    for (const field of REQUIRED_FIELDS) if (!(field in item)) throw new Error(`Professor case is missing ${field}`)
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(item.id)) throw new Error(`invalid Professor case id: ${item.id}`)
    if (ids.has(item.id)) throw new Error(`duplicate Professor case id: ${item.id}`)
    ids.add(item.id)
    if (typeof item.category !== "string" || !item.category.trim()) throw new Error(`${item.id}: category must be non-empty`)
    if (typeof item.query !== "string" || !item.query.trim()) throw new Error(`${item.id}: query must be non-empty`)
    for (const field of ["requiresFreshness", "requiresPrimarySource", "critical"]) {
      if (typeof item[field] !== "boolean") throw new Error(`${item.id}: ${field} must be boolean`)
    }
    if (!Array.isArray(item.expectedEvidenceMatchers) || item.expectedEvidenceMatchers.some((value) => typeof value !== "string")) {
      throw new Error(`${item.id}: expectedEvidenceMatchers must be a string array`)
    }
    if (!Number.isInteger(item.repeatRuns) || item.repeatRuns < 1 || item.repeatRuns > 3) {
      throw new Error(`${item.id}: repeatRuns must be an integer from 1 to 3`)
    }
    if (item.blind === true && !/^B[1-4]b$/.test(item.id)) throw new Error(`${item.id}: only B1b-B4b may be blind cases`)
  }
  for (const id of ["B1b", "B2b", "B3b", "B4b"]) if (!ids.has(id)) throw new Error(`missing blind case ${id}`)
  return cases
}

export function buildRunPlan(cases) {
  return cases.flatMap((item) => Array.from({ length: item.repeatRuns }, (_, index) => ({
    caseId: item.id,
    runIndex: index + 1,
    runKind: index === 0 ? "baseline" : "repeat",
  })))
}

function eventPart(event) {
  return event?.part ?? event
}

function eventTool(event) {
  return eventPart(event)?.tool ?? event?.tool
}

function eventState(event) {
  return eventPart(event)?.state ?? {}
}

function eventOutput(event) {
  return typeof eventState(event).output === "string" ? eventState(event).output : ""
}

function summarizeTaskLifecycle(events) {
  return events.flatMap((event) => {
    const part = eventPart(event)
    if (!part || !["task.completed", "task.failed", "task.superseded"].includes(part.type)) return []
    const data = part.data && typeof part.data === "object" ? part.data : {}
    return [{
      type: part.type,
      taskId: data.taskId ?? part.taskId ?? null,
      questionId: data.questionId ?? part.questionId ?? null,
      sources: Number(data.sources ?? 0),
      evidence: Number(data.evidence ?? 0),
      findings: Number(data.findings ?? 0),
      contradictions: Number(data.contradictions ?? 0),
      followUps: Number(data.followUps ?? 0),
      canonicalResult: data.canonicalResult ?? null,
      reason: data.reason ?? null,
    }]
  })
}

export function parseJsonOutput(value) {
  if (typeof value !== "string" || !value.trim()) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function parseEvents(stdout) {
  const events = []
  const parseErrors = []
  for (const line of String(stdout).split(/\r?\n/).filter(Boolean)) {
    try {
      events.push(JSON.parse(line))
    } catch {
      parseErrors.push(line.slice(0, 240))
    }
  }
  return { events, parseErrors }
}

export function countTaskStatuses(tasks = []) {
  const counts = { pending: 0, running: 0, completed: 0, failed: 0, superseded: 0 }
  for (const task of tasks) if (task?.status in counts) counts[task.status] += 1
  return counts
}

export function countClaimStatuses(claims = []) {
  const counts = { supported: 0, partial: 0, unsupported: 0, contradicted: 0 }
  for (const claim of claims) {
    const key = String(claim?.verification ?? "").toLowerCase()
    if (key in counts) counts[key] += 1
  }
  return counts
}

function summarizedRetrieval(retrieval) {
  return retrieval.map((item) => ({
    sequence: item.sequence,
    tool: item.tool,
    status: item.status,
    query: item.query,
    url: item.url,
    outputChars: item.outputChars,
    urls: item.urls,
    domains: item.domains,
  }))
}

export function summarizeProfessorState(state, fallback = {}) {
  const tasks = Array.isArray(state?.tasks) ? state.tasks : []
  const claims = Array.isArray(state?.claims) ? state.claims : []
  const contradictions = Array.isArray(state?.contradictions) ? state.contradictions : []
  const metrics = state?.metrics && typeof state.metrics === "object" ? state.metrics : {}
  return {
    runId: state?.runId ?? fallback.runId ?? null,
    finalStatus: state?.status ?? fallback.finalStatus ?? null,
    controllerRounds: state?.counters?.controllerRounds ?? null,
    taskStatusCounts: countTaskStatuses(tasks),
    taskStatuses: tasks.map((task) => ({ taskId: task.taskId, questionId: task.questionId, type: task.type, status: task.status })),
    sourceCount: state?.sources?.length ?? 0,
    evidenceCount: state?.evidence?.length ?? 0,
    findingCount: state?.findings?.length ?? 0,
    claimCount: claims.length,
    claimStatusCounts: metrics.claimStatusCounts ?? countClaimStatuses(claims),
    searchCount: metrics.searchCount ?? fallback.searchCount ?? 0,
    fetchCount: fallback.fetchCount ?? 0,
    retrievalCount: fallback.retrievalCount ?? 0,
    contradictions: contradictions.map((item) => ({
      contradictionId: item.contradictionId,
      questionId: item.questionId,
      proposition: item.proposition,
      critical: item.critical,
      status: item.status,
      resolution: item.resolution,
    })),
    uncertainties: Array.isArray(metrics.remainingUncertainties) ? metrics.remainingUncertainties : [],
    durationMs: metrics.durationMs ?? fallback.durationMs ?? null,
    durationDisplay: metrics.durationDisplay ?? null,
    citationCount: metrics.citationCount ?? null,
    questionsTotal: metrics.questionsTotal ?? null,
    questionsResolved: metrics.questionsResolved ?? null,
    sourcesDiscovered: metrics.sourcesDiscovered ?? state?.sources?.length ?? null,
    sourcesUsed: metrics.sourcesUsed ?? null,
    contradictionCount: metrics.contradictionCount ?? contradictions.length,
    budget: state?.budget ?? null,
  }
}

async function readProfessorState(config, runId) {
  if (!runId || !config?.env?.XDG_DATA_HOME) return { state: null, report: null }
  const runDirectory = join(config.env.XDG_DATA_HOME, "all-in-opencode", "professor", "runs", runId)
  try {
    const state = JSON.parse(await readFile(join(runDirectory, "state.json"), "utf8"))
    let report = null
    let events = []
    try {
      report = await readFile(join(runDirectory, "report.md"), "utf8")
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    try {
      const eventLines = await readFile(join(runDirectory, "events.jsonl"), "utf8")
      events = eventLines.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    return { state, report, events }
  } catch (error) {
    if (error.code === "ENOENT") return { state: null, report: null }
    throw error
  }
}

export async function normalizeProfessorRun({ caseItem, runIndex, runKind, stdout, stderr, exitCode, signal, durationMs, startedAt, endedAt, timedOut = false, config }) {
  const { events, parseErrors } = parseEvents(stdout)
  const base = normalizeEvents({
    caseItem,
    runIndex,
    runKind,
    stdout,
    stderr,
    exitCode,
    signal,
    durationMs,
    startedAt,
    endedAt,
    timedOut,
  })
  const toolEvents = events.filter((event) => PROFESSOR_TOOL_NAMES.includes(String(eventTool(event))))
  const toolOutputs = toolEvents.map((event) => ({
    tool: eventTool(event),
    status: eventState(event).status ?? null,
    output: parseJsonOutput(eventOutput(event)),
  }))
  const startOutput = toolOutputs.find((item) => item.tool === "research_start")?.output
  const runId = startOutput?.runId
    ?? toolOutputs.find((item) => item.output?.runId)?.output?.runId
    ?? stdout.match(/"runId"\s*:\s*"(run-[A-Za-z0-9_-]+)"/)?.[1]
    ?? null
  const loaded = await readProfessorState(config, runId)
  const finalText = base.answer
  const stateSummary = summarizeProfessorState(loaded.state, {
    runId,
    durationMs,
    searchCount: base.searchCalls,
    fetchCount: base.fetchCalls,
    retrievalCount: base.retrieval.length,
  })
  const taskLifecycle = summarizeTaskLifecycle([...events, ...(loaded.events ?? [])])
  const zeroValueCompletedTasks = taskLifecycle.filter((item) => item.type === "task.completed"
    && item.sources === 0
    && item.evidence === 0
    && item.findings === 0
    && item.contradictions === 0
    && item.followUps === 0)
  const completionOutput = [...toolOutputs].reverse().find((item) => item.tool === "research_complete")?.output ?? null
  const errors = events.filter((event) => event.type === "error").map((event) => eventPart(event)?.error ?? eventPart(event)?.message ?? "runtime error")
  const failureReason = stateSummary.finalStatus === "completed"
    ? null
    : stateSummary.budget?.exhaustionReason
      ?? errors.at(-1)
      ?? (stderr ? stderr.trim().slice(-2_000) : null)
      ?? (timedOut ? "benchmark timeout" : exitCode === 0 ? "Professor run did not reach completed state" : `process exited with code ${exitCode}`)
  return {
    schemaVersion: 1,
    benchmarkName: "professor-quality",
    caseId: caseItem.id,
    category: caseItem.category,
    blind: caseItem.blind === true,
    runIndex,
    runKind,
    query: caseItem.query,
    requiresFreshness: caseItem.requiresFreshness,
    requiresPrimarySource: caseItem.requiresPrimarySource,
    critical: caseItem.critical,
    startedAt,
    endedAt,
    durationMs,
    processExitCode: exitCode,
    processSignal: signal,
    timedOut,
    sessionId: events.find((event) => event.sessionID)?.sessionID ?? null,
    runId,
    finalStatus: stateSummary.finalStatus,
    completed: stateSummary.finalStatus === "completed",
    controllerRounds: stateSummary.controllerRounds,
    taskStatusCounts: stateSummary.taskStatusCounts,
    taskStatuses: stateSummary.taskStatuses,
    taskLifecycle,
    zeroValueCompletedTasks,
    sourceCount: stateSummary.sourceCount,
    evidenceCount: stateSummary.evidenceCount,
    findingCount: stateSummary.findingCount,
    claimCount: stateSummary.claimCount,
    claimStatusCounts: stateSummary.claimStatusCounts,
    searchCount: stateSummary.searchCount,
    fetchCount: stateSummary.fetchCount,
    retrievalCount: stateSummary.retrievalCount,
    retrievedUrls: base.retrievedUrls,
    retrievedDomains: base.retrievedDomains,
    retrieval: summarizedRetrieval(base.retrieval),
    contradictions: stateSummary.contradictions,
    uncertainties: stateSummary.uncertainties,
    metrics: {
      durationMs: stateSummary.durationMs,
      durationDisplay: stateSummary.durationDisplay,
      citationCount: stateSummary.citationCount,
      questionsTotal: stateSummary.questionsTotal,
      questionsResolved: stateSummary.questionsResolved,
      sourcesDiscovered: stateSummary.sourcesDiscovered,
      sourcesUsed: stateSummary.sourcesUsed,
      contradictionCount: stateSummary.contradictionCount,
    },
    finalReport: loaded.report,
    finalResponse: finalText.slice(0, 16_000),
    completionOutput,
    failureReason,
    stepCount: base.stepCount,
    outerStepLimit: OUTER_STEP_LIMIT,
    stepCapAtBoundary: base.stepCount >= OUTER_STEP_LIMIT || stateSummary.finalStatus !== "completed" && base.stepCount >= OUTER_STEP_LIMIT - 1,
    toolErrors: base.toolErrors,
    errorEvents: base.errorEvents,
    jsonParseErrors: parseErrors.length,
    jsonParseErrorPreview: parseErrors.slice(0, 3),
    stderr: stderr.slice(-2_000),
  }
}

export function objectiveMetrics(records) {
  const total = records.length
  const completed = records.filter((record) => record.completed)
  const claimStatusCounts = records.reduce((totals, record) => {
    for (const key of Object.keys(totals)) totals[key] += record.claimStatusCounts?.[key] ?? 0
    return totals
  }, { supported: 0, partial: 0, unsupported: 0, contradicted: 0 })
  return {
    runs: total,
    completedRuns: completed.length,
    incompleteRuns: total - completed.length,
    completionRate: total ? completed.length / total : 0,
    controllerRounds: records.map((record) => record.controllerRounds),
    taskStatusCounts: records.reduce((totals, record) => {
      for (const key of Object.keys(totals)) totals[key] += record.taskStatusCounts?.[key] ?? 0
      return totals
    }, { pending: 0, running: 0, completed: 0, failed: 0, superseded: 0 }),
    sources: records.reduce((sum, record) => sum + (record.sourceCount ?? 0), 0),
    evidence: records.reduce((sum, record) => sum + (record.evidenceCount ?? 0), 0),
    findings: records.reduce((sum, record) => sum + (record.findingCount ?? 0), 0),
    claims: records.reduce((sum, record) => sum + (record.claimCount ?? 0), 0),
    claimStatusCounts,
    zeroValueCompletedTasks: records.reduce((sum, record) => sum + (record.zeroValueCompletedTasks?.length ?? 0), 0),
    searchCalls: records.reduce((sum, record) => sum + (record.searchCount ?? 0), 0),
    fetchCalls: records.reduce((sum, record) => sum + (record.fetchCount ?? 0), 0),
    retrievalCalls: records.reduce((sum, record) => sum + (record.retrievalCount ?? 0), 0),
    stepCapBoundaryRuns: records.filter((record) => record.stepCapAtBoundary).length,
    failureReasons: records.filter((record) => record.failureReason).map((record) => ({ caseId: record.caseId, reason: record.failureReason })),
    byCase: Object.fromEntries([...new Set(records.map((record) => record.caseId))].map((caseId) => {
      const rows = records.filter((record) => record.caseId === caseId)
      return [caseId, {
        runs: rows.length,
        completedRuns: rows.filter((record) => record.completed).length,
        controllerRounds: rows.map((record) => record.controllerRounds),
        supersededTasks: rows.reduce((sum, record) => sum + (record.taskStatusCounts?.superseded ?? 0), 0),
        zeroValueCompletedTasks: rows.reduce((sum, record) => sum + (record.zeroValueCompletedTasks?.length ?? 0), 0),
        sources: rows.reduce((sum, record) => sum + (record.sourceCount ?? 0), 0),
        evidence: rows.reduce((sum, record) => sum + (record.evidenceCount ?? 0), 0),
        claims: rows.reduce((sum, record) => sum + (record.claimCount ?? 0), 0),
        claimStatusCounts: rows.reduce((counts, record) => {
          for (const key of Object.keys(counts)) counts[key] += record.claimStatusCounts?.[key] ?? 0
          return counts
        }, { supported: 0, partial: 0, unsupported: 0, contradicted: 0 }),
        searchCalls: rows.reduce((sum, record) => sum + (record.searchCount ?? 0), 0),
        fetchCalls: rows.reduce((sum, record) => sum + (record.fetchCount ?? 0), 0),
        durationsMs: rows.map((record) => record.durationMs),
      }]
    })),
  }
}

export function repoRootFromBenchmark(benchmarkDirectory) {
  return resolve(benchmarkDirectory, "../..")
}
