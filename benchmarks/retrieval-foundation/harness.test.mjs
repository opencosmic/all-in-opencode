import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildRunPlan,
  categorySummary,
  loadCases,
  normalizeEvents,
  objectiveMetrics,
  qualityPass,
  validateCases,
  validateScores,
} from "./lib.mjs"

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
  assert.throws(() => validateScores([{ ...passing, primaryRootCause: "MADE_UP" }], cases), /invalid primaryRootCause/)
  assert.equal(categorySummary([], cases).simple.cases, 3)
  assert.equal(categorySummary([], cases).simple.runs, 0)
})
