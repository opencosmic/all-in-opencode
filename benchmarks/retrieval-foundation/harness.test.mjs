import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import {
  buildRunPlan,
  canonicalSourceKey,
  categorySummary,
  evaluateExtractionDecision,
  extractionMetrics,
  loadExtractionCases,
  loadCases,
  normalizeEvents,
  normalizeUrl,
  objectiveMetrics,
  parseOpenCodeVersion,
  qualityPass,
  resetResultsFile,
  validateCases,
  validateExtractionScores,
  validateScores,
} from "./lib.mjs"
import { buildChildEnvironment } from "./run.mjs"

const here = dirname(fileURLToPath(import.meta.url))

test("case schema and frozen repeat plan are deterministic", async () => {
  const cases = await loadCases(join(here, "cases.json"))
  assert.equal(cases.length, 24)
  assert.equal(buildRunPlan(cases).length, 36)
  assert.equal(cases.filter((item) => item.repeatRuns === 3).length, 6)
  assert.throws(() => validateCases([{ ...cases[0] }, { ...cases[1], id: cases[0].id }]), /duplicate case id/)
})

test("event normalization captures native retrieval evidence without raw page bodies", async () => {
  const events = JSON.parse(await readFile(join(here, "fixtures/events.json"), "utf8"))
  const record = normalizeEvents({
    caseItem: (await loadCases(join(here, "fixtures/cases.valid.json")))[0],
    runIndex: 1,
    runKind: "baseline",
    stdout: events.map((event) => JSON.stringify(event)).join("\n"),
    stderr: "",
    exitCode: 0,
    signal: null,
    durationMs: 123,
  })
  assert.equal(record.searchCalls, 1)
  assert.equal(record.fetchCalls, 1)
  assert.deepEqual(record.searchQueries, ["fixture query"])
  assert.deepEqual(record.retrievedDomains, ["docs.example.test"])
  assert.deepEqual(record.citedUrls, ["https://docs.example.test/guide"])
  assert.equal(record.stepCount, 1)
  assert.equal(record.tokens.total, 42)
  assert.equal(record.retrieval[0].outputChars > 0, true)
  assert.equal(Object.hasOwn(record.retrieval[0], "rawOutput"), false)
})

test("objective metrics calculate duplicate URLs, domains, fan-out, and step boundary", () => {
  const base = {
    processExitCode: 0,
    timedOut: false,
    toolErrors: 0,
    errorEvents: 0,
    retrieval: [],
    retrievedUrls: ["https://a.example/x", "https://b.example/y"],
    retrievedDomains: ["a.example", "b.example"],
    searchCalls: 2,
    fetchCalls: 1,
    stepCount: 6,
    stepCapAtBoundary: true,
  }
  const metrics = objectiveMetrics([base, { ...base, retrievedUrls: ["https://a.example/x"], retrievedDomains: ["a.example"], stepCount: 2, stepCapAtBoundary: false }])
  assert.equal(metrics.runs, 2)
  assert.equal(metrics.successfulRuns, 2)
  assert.equal(metrics.duplicateUrlOccurrences, 1)
  assert.equal(metrics.sameRunDuplicateSearchUrlOccurrences, 0)
  assert.equal(metrics.stepCapBoundaryRuns, 1)
  assert.equal(metrics.totalSearchCalls, 4)
  assert.equal(metrics.totalFetchCalls, 2)
  assert.equal(metrics.fetchToSearchRatio, 0.5)
  assert.equal(metrics.domainCounts["a.example"], 2)
})

test("quality pass and root-cause validation enforce pre-registered rules", async () => {
  const cases = await loadCases(join(here, "cases.json"))
  const current = cases.find((item) => item.id === "current-01")
  const passing = {
    caseId: current.id,
    correctness: 5,
    coverage: 4,
    citationGrounding: 4,
    sourceQuality: 3,
    freshness: 4,
    retrievalEfficiency: 3,
    primaryRootCause: "OTHER",
    evidenceNote: "fixture evidence",
  }
  assert.equal(qualityPass(passing, current), true)
  assert.doesNotThrow(() => validateScores([passing], [current]))
  assert.throws(() => validateScores([], [current]), /missing score case/)
  assert.throws(() => validateScores([passing, { ...passing }], [current]), /duplicate score case/)
  assert.throws(() => validateScores([{ ...passing, caseId: "unknown" }], [current]), /unknown score case/)
  assert.throws(() => validateScores([{ ...passing, primaryRootCause: "MADE_UP" }], [current]), /invalid primaryRootCause/)
  assert.equal(categorySummary([], cases).simple.cases, 3)
  assert.equal(categorySummary([], cases).simple.runs, 0)
})

test("fresh output reset is scoped to the selected result file", async () => {
  const root = await mkdtemp(join(tmpdir(), "retrieval-harness-"))
  try {
    const selected = join(root, "selected-runs.jsonl")
    const unrelated = join(root, "baseline-runs.jsonl")
    await writeFile(unrelated, "preserve\n")
    await writeFile(selected, "old\n")
    await resetResultsFile(selected)
    assert.equal(await readFile(selected, "utf8"), "")
    assert.equal(await readFile(unrelated, "utf8"), "preserve\n")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("installed OpenCode version parsing is explicit and deterministic", () => {
  assert.equal(parseOpenCodeVersion("opencode 1.18.30\n"), "1.18.30")
  assert.equal(parseOpenCodeVersion("1.19.0-beta.2"), "1.19.0-beta.2")
  assert.throws(() => parseOpenCodeVersion("OpenCode version unavailable"), /could not parse/)
})

test("benchmark child environment clears inherited overrides and preserves runner config", () => {
  const processEnvironmentBefore = { ...process.env }
  const childEnvironment = buildChildEnvironment({
    ...process.env,
    OPENCODE_CONFIG: "/user/config.jsonc",
    OPENCODE_CONFIG_DIR: "/user/config",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: ["external-plugin"] }),
    OPENCODE_PURE: "1",
    AIO_DATA_ROOT: "/user/aio-data",
    OPENCODE_WORKFLOW_DATA_ROOT: "/user/legacy-data",
    PATH: "/preserved/path",
  }, {
    XDG_CONFIG_HOME: "/tmp/benchmark-config",
    OPENCODE_CONFIG: "/tmp/benchmark-config/opencode.jsonc",
  })

  for (const key of [
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_PURE",
    "AIO_DATA_ROOT",
    "OPENCODE_WORKFLOW_DATA_ROOT",
  ]) assert.equal(childEnvironment[key], undefined, `${key} leaked into child environment`)
  assert.equal(childEnvironment.OPENCODE_CONFIG, "/tmp/benchmark-config/opencode.jsonc")
  assert.equal(childEnvironment.OPENCODE_CONFIG_DIR, undefined)
  assert.equal(childEnvironment.PATH, "/preserved/path")
  assert.deepEqual({ ...process.env }, processEnvironmentBefore)
})

test("citation URL normalization removes presentation punctuation without changing balanced URL syntax", () => {
  for (const suffix of ["`", ")", "]", ",", ".", ";", ":"]) {
    assert.equal(normalizeUrl(`https://example.test/path${suffix}`), "https://example.test/path")
  }
  assert.equal(normalizeUrl("https://example.test/a(b)"), "https://example.test/a(b)")
  assert.equal(normalizeUrl("https://example.test/path?x=1,;"), "https://example.test/path?x=1")
  assert.equal(canonicalSourceKey("https://www.iana.org/assignments/http-status-codes/http-status-codes.txt"), canonicalSourceKey("https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml"))
  assert.equal(canonicalSourceKey("https://ar5iv.labs.arxiv.org/html/1706.03762"), canonicalSourceKey("https://arxiv.org/html/1706.03762v7"))
})

test("supplemental cases and extraction metrics remain deterministic", async () => {
  const cases = await loadExtractionCases(join(here, "extraction/cases.json"))
  assert.equal(cases.length, 8)
  assert.equal(cases.every((item) => item.repeatRuns === 3), true)
  const caseItem = cases[0]
  const source = caseItem.expectedSourceUrls[0]
  const records = [{
    caseId: caseItem.id,
    runIndex: 1,
    processExitCode: 0,
    timedOut: false,
    errorEvents: 0,
    toolErrors: 0,
    stepCount: 6,
    stepCapAtBoundary: true,
    tokens: { total: 12 },
    answer: "The target rule is supported by the RFC citation.",
    citedUrls: [source],
    retrieval: [
      { sequence: 1, tool: "websearch", url: null, urls: [source], outputChars: 10, evidenceMatches: [] },
      { sequence: 2, tool: "webfetch", url: source, urls: [source], outputChars: 12000, evidenceMatches: ["Content-Range"] },
      { sequence: 3, tool: "webfetch", url: source, urls: [source], outputChars: 12000, evidenceMatches: ["Content-Range"] },
      { sequence: 4, tool: "websearch", url: null, urls: [], outputChars: 10, evidenceMatches: [] },
    ],
  }]
  const metrics = extractionMetrics(records, [caseItem])
  assert.equal(metrics.targetFetchedRuns, 1)
  assert.equal(metrics.expectedEvidenceFoundRuns, 1)
  assert.equal(metrics.totalRepeatedTargetFetches, 1)
  assert.equal(metrics.totalExtraSearchesAfterTargetFetch, 1)
  assert.equal(metrics.stepCapBoundaryRuns, 1)
})

test("extraction score completeness and case-level decision rule are enforced", async () => {
  const cases = await loadExtractionCases(join(here, "extraction/cases.json"))
  const assessment = (extractionIssue) => [1, 2, 3].map((runIndex) => ({ runIndex, extractionIssue }))
  const scores = cases.map((item) => ({
    caseId: item.id,
    passageLocalization: 5,
    evidencePrecision: 5,
    extractionEfficiency: 5,
    failure: false,
    reproducibleIssue: false,
    materialImpact: false,
    primaryRootCause: "OTHER",
    evidenceNote: "fixture evidence",
    runAssessments: assessment(false),
  }))
  scores[0] = { ...scores[0], failure: true, reproducibleIssue: true, materialImpact: true, primaryRootCause: "FETCH_EXTRACTION", runAssessments: [
    { runIndex: 1, extractionIssue: true },
    { runIndex: 2, extractionIssue: true },
    { runIndex: 3, extractionIssue: false },
  ] }
  scores[1] = { ...scores[1], failure: true, reproducibleIssue: true, materialImpact: true, primaryRootCause: "FETCH_EXTRACTION", runAssessments: [
    { runIndex: 1, extractionIssue: true },
    { runIndex: 2, extractionIssue: false },
    { runIndex: 3, extractionIssue: true },
  ] }
  assert.doesNotThrow(() => validateExtractionScores(scores, cases))
  const decision = evaluateExtractionDecision(cases, scores)
  assert.equal(decision.decision, "C")
  assert.equal(decision.extractionFailureCases, 2)
  assert.equal(decision.reproducibleFailureCases, 2)
  assert.equal(decision.independentSourceClasses.length, 2)
  assert.throws(() => validateExtractionScores(scores.slice(1), cases), /missing extraction score case/)
  assert.throws(() => validateExtractionScores([...scores, { ...scores[0] }], cases), /duplicate extraction score case/)
})
