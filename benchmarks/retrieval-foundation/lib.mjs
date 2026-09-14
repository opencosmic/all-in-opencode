import { execFile } from "node:child_process"
import { copyFile, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export const ROOT_CAUSES = [
  "SEARCH_PROVIDER",
  "SEARCH_ORCHESTRATION",
  "SOURCE_SELECTION",
  "FETCH_EXTRACTION",
  "FRESHNESS",
  "CITATION_GROUNDING",
  "MODEL_REASONING",
  "TOOL_RUNTIME",
  "BROWSER_ACCESS",
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

export const EXTRACTION_DIMENSIONS = [
  "passageLocalization",
  "evidencePrecision",
  "extractionEfficiency",
]

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

const REQUIRED_EXTRACTION_CASE_FIELDS = [
  "sourceClass",
  "expectedEvidenceTarget",
  "whyExtractionSensitive",
  "negativeControl",
  "expectedSourceUrls",
  "expectedEvidenceMatchers",
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

export async function loadExtractionCases(path) {
  return validateExtractionCases(JSON.parse(await readFile(path, "utf8")))
}

export function validateExtractionCases(cases) {
  validateCases(cases)
  for (const item of cases) {
    for (const field of REQUIRED_EXTRACTION_CASE_FIELDS) {
      if (!(field in item)) throw new Error(`extraction case is missing ${field}`)
    }
    if (typeof item.sourceClass !== "string" || item.sourceClass.trim() === "") {
      throw new Error(`${item.id}: sourceClass must be non-empty`)
    }
    for (const field of ["expectedEvidenceTarget", "whyExtractionSensitive"]) {
      if (typeof item[field] !== "string" || item[field].trim() === "") {
        throw new Error(`${item.id}: ${field} must be non-empty`)
      }
    }
    if (typeof item.negativeControl !== "boolean") throw new Error(`${item.id}: negativeControl must be boolean`)
    for (const field of ["expectedSourceUrls", "expectedEvidenceMatchers"]) {
      if (!Array.isArray(item[field]) || item[field].length === 0 || item[field].some((value) => typeof value !== "string" || value.trim() === "")) {
        throw new Error(`${item.id}: ${field} must be a non-empty string array`)
      }
    }
    if (item.repeatRuns !== 3) throw new Error(`${item.id}: extraction cases must run exactly three times`)
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
  const seen = new Set()
  for (const score of scores) {
    if (!score || typeof score !== "object") throw new Error("each score must be an object")
    if (!score.caseId || (ids.size > 0 && !ids.has(score.caseId))) throw new Error(`unknown score case: ${score.caseId}`)
    if (seen.has(score.caseId)) throw new Error(`duplicate score case: ${score.caseId}`)
    seen.add(score.caseId)
    if (!score.primaryRootCause || !ROOT_CAUSES.includes(score.primaryRootCause)) throw new Error(`${score.caseId}: invalid primaryRootCause`)
    for (const dimension of QUALITY_DIMENSIONS) {
      if (dimension === "freshness" && score[dimension] === null) continue
      if (!Number.isInteger(score[dimension]) || score[dimension] < 0 || score[dimension] > 5) {
        throw new Error(`${score.caseId}: ${dimension} must be an integer from 0 to 5 or null for freshness`)
      }
    }
    if (typeof score.evidenceNote !== "string" || score.evidenceNote.trim() === "") throw new Error(`${score.caseId}: evidenceNote is required`)
  }
  if (ids.size > 0) {
    const missing = [...ids].filter((caseId) => !seen.has(caseId))
    if (missing.length > 0) throw new Error(`missing score case: ${missing.join(", ")}`)
  }
  return scores
}

export function validateExtractionScores(scores, cases = []) {
  if (!Array.isArray(scores)) throw new Error("extraction scores must be an array")
  const expected = new Map(cases.map((item) => [item.id, item]))
  const seen = new Set()
  for (const score of scores) {
    if (!score || typeof score !== "object") throw new Error("each extraction score must be an object")
    if (!expected.has(score.caseId)) throw new Error(`unknown extraction score case: ${score.caseId}`)
    if (seen.has(score.caseId)) throw new Error(`duplicate extraction score case: ${score.caseId}`)
    seen.add(score.caseId)
    for (const dimension of EXTRACTION_DIMENSIONS) {
      if (!Number.isInteger(score[dimension]) || score[dimension] < 0 || score[dimension] > 5) {
        throw new Error(`${score.caseId}: ${dimension} must be an integer from 0 to 5`)
      }
    }
    if (typeof score.failure !== "boolean") throw new Error(`${score.caseId}: failure must be boolean`)
    if (typeof score.reproducibleIssue !== "boolean") throw new Error(`${score.caseId}: reproducibleIssue must be boolean`)
    if (typeof score.materialImpact !== "boolean") throw new Error(`${score.caseId}: materialImpact must be boolean`)
    if (!ROOT_CAUSES.includes(score.primaryRootCause)) throw new Error(`${score.caseId}: invalid primaryRootCause`)
    if (typeof score.evidenceNote !== "string" || score.evidenceNote.trim() === "") throw new Error(`${score.caseId}: evidenceNote is required`)
    if (!Array.isArray(score.runAssessments) || score.runAssessments.length !== expected.get(score.caseId).repeatRuns) {
      throw new Error(`${score.caseId}: runAssessments must contain one entry per run`)
    }
    const runIndexes = new Set()
    for (const assessment of score.runAssessments) {
      if (!Number.isInteger(assessment.runIndex) || assessment.runIndex < 1 || assessment.runIndex > expected.get(score.caseId).repeatRuns) {
        throw new Error(`${score.caseId}: invalid run assessment index`)
      }
      if (runIndexes.has(assessment.runIndex)) throw new Error(`${score.caseId}: duplicate run assessment index`)
      runIndexes.add(assessment.runIndex)
      if (typeof assessment.extractionIssue !== "boolean") throw new Error(`${score.caseId}: run assessment extractionIssue must be boolean`)
    }
  }
  const missing = [...expected.keys()].filter((caseId) => !seen.has(caseId))
  if (missing.length > 0) throw new Error(`missing extraction score case: ${missing.join(", ")}`)
  return scores
}

export function resolveBenchmarkPath(baseDir, requested, fallback) {
  return resolve(baseDir, requested ?? fallback)
}

export async function resetResultsFile(path) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, "")
}

export function parseOpenCodeVersion(output) {
  const match = String(output).match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)
  if (!match) throw new Error(`could not parse an OpenCode version from: ${String(output).trim()}`)
  return match[0]
}

export async function detectOpenCodeVersion(command = "opencode") {
  let result
  try {
    result = await execFileAsync(command, ["--version"], { encoding: "utf8" })
  } catch (error) {
    throw new Error(`could not resolve OpenCode version with ${command} --version: ${error.message}`)
  }
  return parseOpenCodeVersion(`${result.stdout}\n${result.stderr}`)
}

export async function createIsolatedConfig(repoRoot, inheritedEnvironment = process.env) {
  const root = await mkdtemp(join(tmpdir(), "opencode-retrieval-config-"))
  const configHome = join(root, "config")
  const configDir = join(configHome, "opencode")
  const dataHome = join(root, "data")
  const stateHome = join(root, "state")
  const cacheHome = join(root, "cache")
  await Promise.all([
    configDir,
    join(dataHome, "opencode"),
    stateHome,
    cacheHome,
  ].map((path) => mkdir(path, { recursive: true })))
  if (!("OPENCODE_AUTH_CONTENT" in inheritedEnvironment)) {
    const sourceDataHome = inheritedEnvironment.XDG_DATA_HOME
      ?? join(inheritedEnvironment.HOME ?? homedir(), ".local", "share")
    try {
      await copyFile(
        join(sourceDataHome, "opencode", "auth.json"),
        join(dataHome, "opencode", "auth.json"),
      )
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }
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
      XDG_CONFIG_HOME: configHome,
      XDG_DATA_HOME: dataHome,
      XDG_STATE_HOME: stateHome,
      XDG_CACHE_HOME: cacheHome,
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

export function normalizeUrl(value) {
  if (typeof value !== "string") return null
  let url = value.trim()
  let previous
  do {
    previous = url
    url = url.replace(/[`. ,;:]+$/g, "")
    while (url.endsWith(")") && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) url = url.slice(0, -1)
    while (url.endsWith("]") && (url.match(/\[/g) ?? []).length < (url.match(/\]/g) ?? []).length) url = url.slice(0, -1)
  } while (url !== previous)
  return url
}

function extractUrls(value) {
  if (typeof value !== "string") return []
  return [...value.matchAll(/https?:\/\/[^\s<\]"']+/g)]
    .map((match) => normalizeUrl(match[0]))
    .filter(Boolean)
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
    const url = normalizeUrl(match[2])
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
  const markdown = [...answer.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)]
    .map((match) => normalizeUrl(match[1]))
    .filter(Boolean)
  return [...new Set([...markdown, ...extractUrls(answer)])]
}

function extractEvidenceExcerpts(output, matchers = []) {
  const matches = []
  const excerpts = []
  for (const matcher of matchers) {
    const needle = String(matcher).trim()
    if (!needle) continue
    const index = output.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase())
    if (index < 0) continue
    matches.push(needle)
    const start = Math.max(0, index - 360)
    const end = Math.min(output.length, index + needle.length + 840)
    excerpts.push(output.slice(start, end).replace(/\s+/g, " ").trim())
  }
  return { matches: [...new Set(matches)], excerpts: excerpts.slice(0, 4) }
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
  const retrieval = toolEvents.map((event, index) => ({ event, sequence: index + 1 }))
    .filter(({ event }) => {
      const tool = String(eventTool(event) ?? "").toLowerCase()
      return tool.startsWith("websearch") || tool === "webfetch"
    })
    .map(({ event, sequence }) => {
    const input = eventInput(event)
    const output = outputText(event)
    const urls = [...new Set([...extractUrls(typeof input === "object" ? input.url : ""), ...extractUrls(output)])]
    const evidence = extractEvidenceExcerpts(output, caseItem.expectedEvidenceMatchers)
    return {
      sequence,
      tool: eventTool(event),
      status: eventState(event).status ?? null,
      query: typeof input === "object" ? input.query ?? null : null,
      url: typeof input === "object" ? normalizeUrl(input.url) : null,
      provider: extractProvider(output, event),
      outputChars: output.length,
      urls,
      domains: [...new Set(urls.map(domainOf).filter(Boolean))],
      sources: extractSources(output),
      evidenceMatches: evidence.matches,
      evidenceExcerpts: evidence.excerpts,
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

function itemUrls(item) {
  return [...new Set([item.url, ...(item.urls ?? [])].map(normalizeUrl).filter(Boolean))]
}

export function canonicalSourceKey(value) {
  const normalized = normalizeUrl(value)
  if (!normalized) return null
  try {
    const parsed = new URL(normalized)
    let hostname = parsed.hostname.toLowerCase().replace(/^www\./, "")
    let pathname = parsed.pathname.replace(/\/+$/, "")
    if (hostname === "ar5iv.labs.arxiv.org") hostname = "arxiv.org"
    if (hostname === "raw.githubusercontent.com") hostname = "github.com"
    if (hostname === "github.com") {
      const parts = pathname.split("/").filter(Boolean)
      if (parts[2] === "blob" && parts.length > 3) parts.splice(2, 2)
      else if (parts.length > 3) parts.splice(2, 1)
      pathname = `/${parts.join("/")}`
    }
    pathname = pathname.replace(/(\/html\/\d+\.\d+)v\d+$/, "$1")
    pathname = pathname.replace(/\/eng$/, "")
    pathname = pathname.replace(/\.(xhtml|txt|html|md)$/, "")
    return `${hostname}${pathname}`
  } catch {
    return normalized
  }
}

function matchesExpectedSource(url, caseItem) {
  const normalized = normalizeUrl(url)
  if (!normalized) return false
  const sourceKey = canonicalSourceKey(normalized)
  return caseItem.expectedSourceUrls.some((expected) => {
    const target = normalizeUrl(expected)
    return normalized === target
      || normalized.startsWith(`${target}#`)
      || normalized.startsWith(`${target}?`)
      || sourceKey === canonicalSourceKey(target)
  })
}

export function extractionRunMetrics(record, caseItem) {
  const retrieval = Array.isArray(record.retrieval) ? record.retrieval : []
  const searches = retrieval.filter((item) => String(item.tool ?? "").toLowerCase().startsWith("websearch"))
  const fetches = retrieval.filter((item) => String(item.tool ?? "").toLowerCase() === "webfetch")
  const targetSearches = searches.filter((item) => itemUrls(item).some((url) => matchesExpectedSource(url, caseItem)))
  const targetFetches = fetches.filter((item) => itemUrls(item).some((url) => matchesExpectedSource(url, caseItem)))
  const fetchUrlCounts = new Map()
  for (const item of fetches) {
    const key = canonicalSourceKey(item.url) ?? canonicalSourceKey(itemUrls(item)[0])
    if (key) fetchUrlCounts.set(key, (fetchUrlCounts.get(key) ?? 0) + 1)
  }
  const firstTargetFetchSequence = targetFetches.length ? Math.min(...targetFetches.map((item) => item.sequence ?? 0)) : null
  const fetchOutputSizes = fetches.map((item) => item.outputChars).filter((value) => Number.isFinite(value))
  const evidenceMatches = [...new Set(targetFetches.flatMap((item) => item.evidenceMatches ?? []))]
  const answer = String(record.answer ?? "").toLocaleLowerCase()
  const answerEvidenceMatches = caseItem.expectedEvidenceMatchers.filter((matcher) => answer.includes(matcher.toLocaleLowerCase()))
  return {
    caseId: record.caseId,
    sourceClass: caseItem.sourceClass,
    runIndex: record.runIndex,
    cleanRun: record.processExitCode === 0 && !record.timedOut && record.errorEvents === 0 && record.toolErrors === 0,
    sourceFound: searches.some((item) => itemUrls(item).some((url) => matchesExpectedSource(url, caseItem))) || targetFetches.length > 0,
    targetFetched: targetFetches.length > 0,
    expectedEvidenceFound: evidenceMatches.length > 0,
    evidenceMatches,
    answerEvidenceMatches,
    citationSupportsTarget: (record.citedUrls ?? []).some((url) => matchesExpectedSource(url, caseItem)),
    fetchCalls: fetches.length,
    fetchOutputChars: fetchOutputSizes.reduce((sum, value) => sum + value, 0),
    fetchOutputSizes,
    extraSearchesAfterTargetFetch: firstTargetFetchSequence === null
      ? 0
      : searches.filter((item) => (item.sequence ?? 0) > firstTargetFetchSequence).length,
    repeatedFetches: [...fetchUrlCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    repeatedTargetFetches: targetFetches.length > 0 ? Math.max(0, targetFetches.length - 1) : 0,
    stepCount: record.stepCount,
    stepCapAtBoundary: record.stepCapAtBoundary,
    tokens: record.tokens,
  }
}

function percentile(values, fraction) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]
}

export function extractionMetrics(records, cases) {
  const caseById = new Map(cases.map((item) => [item.id, item]))
  const byRun = records.map((record) => {
    const caseItem = caseById.get(record.caseId)
    if (!caseItem) throw new Error(`record references unknown extraction case: ${record.caseId}`)
    return extractionRunMetrics(record, caseItem)
  })
  const fetchOutputSizes = byRun.flatMap((row) => row.fetchOutputSizes)
  return {
    runs: byRun.length,
    cleanRuns: byRun.filter((row) => row.cleanRun).length,
    toolFailureRuns: byRun.filter((row) => !row.cleanRun).length,
    targetSourceFoundRuns: byRun.filter((row) => row.sourceFound).length,
    targetFetchedRuns: byRun.filter((row) => row.targetFetched).length,
    expectedEvidenceFoundRuns: byRun.filter((row) => row.expectedEvidenceFound).length,
    citationSupportsTargetRuns: byRun.filter((row) => row.citationSupportsTarget).length,
    totalFetchCalls: byRun.reduce((sum, row) => sum + row.fetchCalls, 0),
    totalFetchOutputChars: byRun.reduce((sum, row) => sum + row.fetchOutputChars, 0),
    totalExtraSearchesAfterTargetFetch: byRun.reduce((sum, row) => sum + row.extraSearchesAfterTargetFetch, 0),
    totalRepeatedFetches: byRun.reduce((sum, row) => sum + row.repeatedFetches, 0),
    totalRepeatedTargetFetches: byRun.reduce((sum, row) => sum + row.repeatedTargetFetches, 0),
    stepCapBoundaryRuns: byRun.filter((row) => row.stepCapAtBoundary).length,
    fetchOutputSizeChars: {
      count: fetchOutputSizes.length,
      min: fetchOutputSizes.length ? Math.min(...fetchOutputSizes) : null,
      max: fetchOutputSizes.length ? Math.max(...fetchOutputSizes) : null,
      mean: fetchOutputSizes.length ? fetchOutputSizes.reduce((sum, value) => sum + value, 0) / fetchOutputSizes.length : null,
      p50: percentile(fetchOutputSizes, 0.5),
      p90: percentile(fetchOutputSizes, 0.9),
    },
    byRun,
  }
}

export function evaluateExtractionDecision(cases, scores) {
  const validCases = cases.filter((item) => !scores.find((score) => score.caseId === item.id)?.caseInvalid)
  const extractionFailures = scores.filter((score) => score.failure && score.primaryRootCause === "FETCH_EXTRACTION")
  const reproducibleFailures = extractionFailures.filter((score) => score.reproducibleIssue)
  const sourceClasses = new Set(reproducibleFailures.map((score) => cases.find((item) => item.id === score.caseId)?.sourceClass).filter(Boolean))
  const caseRate = validCases.length ? extractionFailures.length / validCases.length : 0
  if (reproducibleFailures.length >= 2 && sourceClasses.size >= 2 && caseRate >= 0.2) {
    return {
      decision: "C",
      validCaseCount: validCases.length,
      extractionFailureCases: extractionFailures.length,
      extractionFailureCaseRate: caseRate,
      reproducibleFailureCases: reproducibleFailures.length,
      independentSourceClasses: [...sourceClasses],
      rationale: "At least two valid cases from independent source classes have reproducible, material extraction failures and case-level prevalence meets the pre-registered threshold.",
    }
  }
  if (reproducibleFailures.length > 0 || extractionFailures.some((score) => score.materialImpact)) {
    return {
      decision: "B",
      validCaseCount: validCases.length,
      extractionFailureCases: extractionFailures.length,
      extractionFailureCaseRate: caseRate,
      reproducibleFailureCases: reproducibleFailures.length,
      independentSourceClasses: [...sourceClasses],
      rationale: "Extraction inefficiency or a limited reproducible issue remains, but the independent-case threshold for a new shared capability is not met.",
    }
  }
  return {
    decision: "A",
    validCaseCount: validCases.length,
    extractionFailureCases: extractionFailures.length,
    extractionFailureCaseRate: caseRate,
    reproducibleFailureCases: reproducibleFailures.length,
    independentSourceClasses: [...sourceClasses],
    rationale: "No material, reproducible cross-source-class extraction failure was observed.",
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
