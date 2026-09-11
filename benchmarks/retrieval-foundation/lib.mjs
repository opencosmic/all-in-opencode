import { mkdtemp, mkdir, readFile, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

export const ROOT_CAUSES = [
  "SEARCH_PROVIDER",
  "SEARCH_ORCHESTRATION",
  "SOURCE_SELECTION",
  "FETCH_EXTRACTION",
  "FRESHNESS",
  "CITATION_GROUNDING",
  "MODEL_REASONING",
  "TOOL_RUNTIME",
  "PROMPT_POLICY",
  "CASE_INVALID",
  "OTHER",
]

export const QUALITY_DIMENSIONS = [
  "correctness",
  "coverage",
  "citationGrounding",
  "sourceQuality",
  "freshness",
  "retrievalEfficiency",
]

export const PASS_THRESHOLDS = {
  correctness: 4,
  coverage: 4,
  citationGrounding: 4,
  sourceQuality: 3,
  freshness: 4,
}

const REQUIRED_CASE_FIELDS = [
  "id",
  "category",
  "query",
  "requiresFreshness",
  "requiresPrimarySource",
  "expectedRetrievalPattern",
  "evaluationNotes",
  "critical",
  "repeatRuns",
]

export async function loadCases(path) {
  return validateCases(JSON.parse(await readFile(path, "utf8")))
}

export function validateCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error("cases must be a non-empty array")
  const ids = new Set()
  for (const item of cases) {
    if (!item || typeof item !== "object") throw new Error("each case must be an object")
    for (const field of REQUIRED_CASE_FIELDS) {
      if (!(field in item)) throw new Error(`case is missing ${field}`)
    }
    if (!/^[a-z0-9-]+$/.test(item.id)) throw new Error(`invalid case id: ${item.id}`)
    if (ids.has(item.id)) throw new Error(`duplicate case id: ${item.id}`)
    ids.add(item.id)
    if (typeof item.query !== "string" || item.query.trim() === "") throw new Error(`${item.id}: query must be non-empty`)
    if (typeof item.category !== "string" || item.category.trim() === "") throw new Error(`${item.id}: category must be non-empty`)
    if (typeof item.repeatRuns !== "number" || !Number.isInteger(item.repeatRuns) || item.repeatRuns < 1 || item.repeatRuns > 3) {
      throw new Error(`${item.id}: repeatRuns must be an integer from 1 to 3`)
    }
    for (const field of ["requiresFreshness", "requiresPrimarySource", "critical"]) {
      if (typeof item[field] !== "boolean") throw new Error(`${item.id}: ${field} must be boolean`)
    }
  }
  return cases
}

export function buildRunPlan(cases) {
  return cases.flatMap((item) => Array.from({ length: item.repeatRuns }, (_, index) => ({
    caseId: item.id,
    runIndex: index + 1,
    runKind: index === 0 ? "baseline" : "repeat",
  })))
}

export function validateScores(scores, cases = []) {
  if (!Array.isArray(scores)) throw new Error("scores must be an array")
  const ids = new Set(cases.map((item) => item.id))
  for (const score of scores) {
    if (!score || typeof score !== "object") throw new Error("each score must be an object")
    if (!score.caseId || (ids.size > 0 && !ids.has(score.caseId))) throw new Error(`unknown score case: ${score.caseId}`)
    if (!score.primaryRootCause || !ROOT_CAUSES.includes(score.primaryRootCause)) throw new Error(`${score.caseId}: invalid primaryRootCause`)
    for (const dimension of QUALITY_DIMENSIONS) {
      if (dimension === "freshness" && score[dimension] === null) continue
      if (!Number.isInteger(score[dimension]) || score[dimension] < 0 || score[dimension] > 5) {
        throw new Error(`${score.caseId}: ${dimension} must be an integer from 0 to 5 or null for freshness`)
      }
    }
    if (typeof score.evidenceNote !== "string" || score.evidenceNote.trim() === "") throw new Error(`${score.caseId}: evidenceNote is required`)
  }
  return scores
}

export async function createIsolatedConfig(repoRoot) {
  const root = await mkdtemp(join(tmpdir(), "opencode-retrieval-config-"))
  const configDir = join(root, "opencode")
  await mkdir(configDir)
  const links = [
    ["agents", join(repoRoot, "opencode/agents")],
    ["commands", join(repoRoot, "opencode/commands")],
    ["plugins", join(repoRoot, "opencode/plugins")],
    ["tests", join(repoRoot, "opencode/tests")],
    ["categories.json", join(repoRoot, "opencode/categories.json")],
    ["tui.json", join(repoRoot, "opencode/tui.json")],
    ["opencode.jsonc", join(repoRoot, "opencode/opencode.jsonc")],
  ]
  for (const [name, target] of links) await symlink(target, join(configDir, name))
  return {
    root,
    configDir,
    env: {
      XDG_CONFIG_HOME: root,
      OPENCODE_CONFIG: join(repoRoot, "opencode/opencode.jsonc"),
    },
  }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null)
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

function outputText(event) {
  const state = eventState(event)
  return typeof state.output === "string" ? state.output : ""
}

function eventInput(event) {
  const state = eventState(event)
  return firstDefined(state.input, eventPart(event)?.input, {})
}

function extractUrls(value) {
  if (typeof value !== "string") return []
  return [...value.matchAll(/https?:\/\/[^\s)<\]"']+/g)].map((match) => match[0].replace(/[.,;:]+$/, ""))
}

function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

function extractSources(output) {
  const sources = []
  const pattern = /Title:\s*(.*?)\nURL:\s*(https?:\/\/[^\s]+)/g
  for (const match of output.matchAll(pattern)) {
    const url = match[2].replace(/[.,;:]+$/, "")
    sources.push({ title: match[1].trim(), url, domain: domainOf(url) })
  }
  return sources
}

function extractProvider(output, event) {
  const metadataProvider = eventState(event)?.metadata?.provider
    ?? eventPart(event)?.metadata?.provider
    ?? event?.metadata?.provider
  if (metadataProvider) return metadataProvider
  return output.match(/"provider"\s*:\s*"([^"]+)"/)?.[1] ?? null
}

function extractCitedUrls(answer) {
  const markdown = [...answer.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1])
  return [...new Set([...markdown, ...extractUrls(answer)])]
}

export function normalizeEvents({ caseItem, runIndex, runKind, stdout, stderr, exitCode, signal, durationMs, startedAt, endedAt, timedOut = false }) {
  const events = []
  const parseErrors = []
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      events.push(JSON.parse(line))
    } catch {
      parseErrors.push(line.slice(0, 240))
    }
  }

  const toolEvents = events.filter((event) => event.type === "tool_use" || eventTool(event))
  const searches = toolEvents.filter((event) => String(eventTool(event) ?? "").toLowerCase().startsWith("websearch"))
  const fetches = toolEvents.filter((event) => String(eventTool(event) ?? "").toLowerCase() === "webfetch")
  const retrieval = [...searches, ...fetches].map((event) => {
    const input = eventInput(event)
    const output = outputText(event)
    const urls = [...new Set([...extractUrls(typeof input === "object" ? input.url : ""), ...extractUrls(output)])]
    return {
      tool: eventTool(event),
      status: eventState(event).status ?? null,
      query: typeof input === "object" ? input.query ?? null : null,
      url: typeof input === "object" ? input.url ?? null : null,
      provider: extractProvider(output, event),
      outputChars: output.length,
      urls,
      domains: [...new Set(urls.map(domainOf).filter(Boolean))],
      sources: extractSources(output),
    }
  })

  const textEvents = events.filter((event) => event.type === "text" && typeof eventPart(event)?.text === "string")
  const answerCandidates = textEvents.filter((event) => eventPart(event)?.metadata?.openai?.phase !== "commentary")
  const finalAnswer = (answerCandidates.at(-1) ?? textEvents.at(-1))?.part?.text ?? ""
  const stepStarts = events.filter((event) => event.type === "step_start").length
  const stepFinishes = events.filter((event) => event.type === "step_finish")
  const tokenTotals = stepFinishes.reduce((totals, event) => {
    const tokens = eventPart(event)?.tokens
    for (const key of ["total", "input", "output", "reasoning"]) {
      if (typeof tokens?.[key] === "number") totals[key] += tokens[key]
    }
    return totals
  }, { total: 0, input: 0, output: 0, reasoning: 0 })
  const citedUrls = extractCitedUrls(finalAnswer)
  const allUrls = [...new Set(retrieval.flatMap((item) => item.urls))]
  const allDomains = [...new Set(allUrls.map(domainOf).filter(Boolean))]
  const toolErrors = retrieval.filter((item) => ["error", "failed"].includes(item.status)).length
  const errorEvents = events.filter((event) => event.type === "error")
  const finalReasons = stepFinishes.map((event) => eventPart(event)?.reason).filter(Boolean)

  return {
    schemaVersion: 1,
    caseId: caseItem.id,
    category: caseItem.category,
    runIndex,
    runKind,
    query: caseItem.query,
    requiresFreshness: caseItem.requiresFreshness,
    requiresPrimarySource: caseItem.requiresPrimarySource,
    critical: caseItem.critical,
    startedAt: startedAt ?? new Date(Date.now() - durationMs).toISOString(),
    endedAt: endedAt ?? new Date().toISOString(),
    durationMs,
    processExitCode: exitCode,
    processSignal: signal,
    timedOut,
    sessionId: events.find((event) => event.sessionID)?.sessionID ?? null,
    searchCalls: searches.length,
    fetchCalls: fetches.length,
    searchQueries: searches.map((event) => eventInput(event)?.query ?? null).filter(Boolean),
    retrieval,
    citedUrls,
    citedDomains: [...new Set(citedUrls.map(domainOf).filter(Boolean))],
    retrievedUrls: allUrls,
    retrievedDomains: allDomains,
    retrievedSourceCount: retrieval.reduce((count, item) => count + item.sources.length, 0),
    stepCount: stepStarts,
    stepCapAtBoundary: stepStarts >= 6,
    stepFinishReasons: finalReasons,
    tokens: tokenTotals,
    answer: finalAnswer.slice(0, 16000),
    answerChars: finalAnswer.length,
    toolErrors,
    errorEvents: errorEvents.length,
    jsonParseErrors: parseErrors.length,
    jsonParseErrorPreview: parseErrors.slice(0, 3),
    stderr: stderr.slice(-2000),
    rawStdoutBytes: Buffer.byteLength(stdout),
    rawStderrBytes: Buffer.byteLength(stderr),
  }
}

export function objectiveMetrics(records) {
  const successful = records.filter((record) => record.processExitCode === 0 && !record.timedOut && record.errorEvents === 0 && record.toolErrors === 0)
  const perRunSearchMetrics = records.map((record) => {
    const searchItems = record.retrieval.filter((item) => String(item.tool ?? "").toLowerCase().startsWith("websearch"))
    const searchUrls = searchItems.flatMap((item) => item.urls)
    const searchDomains = searchUrls.map(domainOf).filter(Boolean)
    const urlCounts = new Map()
    const domainCounts = new Map()
    for (const url of searchUrls) urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1)
    for (const domain of searchDomains) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1)
    const maxDomainHits = Math.max(0, ...domainCounts.values())
    return {
      caseId: record.caseId,
      runIndex: record.runIndex,
      searchCalls: record.searchCalls,
      fetchCalls: record.fetchCalls,
      searchResultUrls: searchUrls.length,
      uniqueSearchUrls: urlCounts.size,
      duplicateSearchUrlOccurrences: [...urlCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
      duplicateSearchUrls: [...urlCounts.entries()].filter(([, count]) => count > 1).map(([url, count]) => ({ url, count })),
      uniqueSearchDomains: domainCounts.size,
      searchDomainCounts: Object.fromEntries([...domainCounts.entries()].sort((a, b) => b[1] - a[1])),
      maxSearchDomainConcentration: searchUrls.length ? maxDomainHits / searchUrls.length : 0,
    }
  })
  const urlCounts = new Map()
  const domainCounts = new Map()
  for (const record of records) {
    for (const url of record.retrievedUrls) urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1)
    for (const domain of record.retrievedDomains) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1)
  }
  const duplicateUrlOccurrences = [...urlCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
  const duplicateUrls = [...urlCounts.entries()].filter(([, count]) => count > 1).map(([url, count]) => ({ url, count }))
  const sameRunDuplicateSearchUrls = perRunSearchMetrics.flatMap((item) => item.duplicateSearchUrls)
  const byCase = Object.fromEntries([...new Set(records.map((record) => record.caseId))].map((caseId) => {
    const runs = perRunSearchMetrics.filter((item) => item.caseId === caseId)
    const searchResultUrls = runs.reduce((sum, item) => sum + item.searchResultUrls, 0)
    const duplicateSearchUrlOccurrences = runs.reduce((sum, item) => sum + item.duplicateSearchUrlOccurrences, 0)
    return [caseId, {
      runs: runs.length,
      searchCalls: runs.reduce((sum, item) => sum + item.searchCalls, 0),
      fetchCalls: runs.reduce((sum, item) => sum + item.fetchCalls, 0),
      duplicateSearchUrlOccurrences,
      runsWithDuplicateSearchUrls: runs.filter((item) => item.duplicateSearchUrlOccurrences > 0).length,
      duplicateSearchUrlRate: searchResultUrls ? duplicateSearchUrlOccurrences / searchResultUrls : 0,
      averageUniqueSearchDomains: runs.length ? runs.reduce((sum, item) => sum + item.uniqueSearchDomains, 0) / runs.length : 0,
      maxSearchDomainConcentration: Math.max(0, ...runs.map((item) => item.maxSearchDomainConcentration)),
    }]
  }))
  const maxDomainCount = Math.max(0, ...domainCounts.values())
  return {
    runs: records.length,
    successfulRuns: successful.length,
    runtimeFailures: records.length - successful.length,
    successRate: records.length ? successful.length / records.length : 0,
    searchCalls: records.map((record) => record.searchCalls),
    fetchCalls: records.map((record) => record.fetchCalls),
    stepCounts: records.map((record) => record.stepCount),
    stepCapBoundaryRuns: records.filter((record) => record.stepCapAtBoundary).length,
    totalSearchCalls: records.reduce((sum, record) => sum + record.searchCalls, 0),
    totalFetchCalls: records.reduce((sum, record) => sum + record.fetchCalls, 0),
    totalSteps: records.reduce((sum, record) => sum + record.stepCount, 0),
    uniqueRetrievedUrls: urlCounts.size,
    uniqueRetrievedDomains: domainCounts.size,
    // This cross-run metric includes expected repeated evidence from the six
    // variance cases and is retained for audit context only.
    duplicateUrlOccurrences,
    duplicateUrls,
    sameRunDuplicateSearchUrlOccurrences: perRunSearchMetrics.reduce((sum, item) => sum + item.duplicateSearchUrlOccurrences, 0),
    sameRunSearchRunsWithDuplicates: perRunSearchMetrics.filter((item) => item.duplicateSearchUrlOccurrences > 0).length,
    sameRunDuplicateSearchUrlRate: perRunSearchMetrics.reduce((sum, item) => sum + item.searchResultUrls, 0)
      ? perRunSearchMetrics.reduce((sum, item) => sum + item.duplicateSearchUrlOccurrences, 0)
        / perRunSearchMetrics.reduce((sum, item) => sum + item.searchResultUrls, 0)
      : 0,
    perCaseSearchMetrics: byCase,
    domainCounts: Object.fromEntries([...domainCounts.entries()].sort((a, b) => b[1] - a[1])),
    maxDomainConcentration: records.length ? maxDomainCount / records.length : 0,
    fetchToSearchRatio: records.reduce((sum, record) => sum + record.searchCalls, 0)
      ? records.reduce((sum, record) => sum + record.fetchCalls, 0) / records.reduce((sum, record) => sum + record.searchCalls, 0)
      : 0,
  }
}

export function qualityPass(score, caseItem) {
  if (score.correctness < PASS_THRESHOLDS.correctness) return false
  if (score.coverage < PASS_THRESHOLDS.coverage) return false
  if (score.citationGrounding < PASS_THRESHOLDS.citationGrounding) return false
  if (score.sourceQuality < PASS_THRESHOLDS.sourceQuality) return false
  if (caseItem.requiresFreshness && score.freshness < PASS_THRESHOLDS.freshness) return false
  return true
}

export function categorySummary(records, cases, scores = []) {
  const scoreByCase = new Map(scores.map((score) => [score.caseId, score]))
  return Object.fromEntries([...new Set(cases.map((item) => item.category))].map((category) => {
    const categoryCases = cases.filter((item) => item.category === category)
    const categoryRecords = records.filter((record) => record.category === category)
    const passingScores = categoryCases.filter((item) => {
      const score = scoreByCase.get(item.id)
      return score && qualityPass(score, item)
    }).length
    return [category, {
      cases: categoryCases.length,
      runs: categoryRecords.length,
      successfulRuns: categoryRecords.filter((record) => record.processExitCode === 0 && !record.timedOut && record.toolErrors === 0 && record.errorEvents === 0).length,
      scoredCases: categoryCases.filter((item) => scoreByCase.has(item.id)).length,
      qualityPasses: passingScores,
    }]
  }))
}

export function repoRootFromModule(moduleUrl) {
  return resolve(dirname(moduleUrl), "../..")
}
