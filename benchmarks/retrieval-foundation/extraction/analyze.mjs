#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  EXTRACTION_DIMENSIONS,
  evaluateExtractionDecision,
  extractionMetrics,
  loadExtractionCases,
  objectiveMetrics,
  validateExtractionScores,
} from "../lib.mjs"

const extractionDir = dirname(fileURLToPath(import.meta.url))
const defaultResultsPath = resolve(extractionDir, "results/runs.jsonl")
const defaultScoresPath = resolve(extractionDir, "results/scores.json")
const defaultSummaryPath = resolve(extractionDir, "results/summary.json")
const casesPath = resolve(extractionDir, "cases.json")

async function readRecords(path) {
  const content = await readFile(path, "utf8")
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

async function main() {
  const cases = await loadExtractionCases(casesPath)
  const records = await readRecords(defaultResultsPath)
  const scores = validateExtractionScores(JSON.parse(await readFile(defaultScoresPath, "utf8")), cases)
  const metrics = extractionMetrics(records, cases)
  const decision = evaluateExtractionDecision(cases, scores)
  const versions = [...new Set(records.map((record) => record.opencodeVersion).filter(Boolean))]
  if (versions.length > 1) throw new Error(`multiple OpenCode versions in extraction results: ${versions.join(", ")}`)
  const runIssueCount = scores.reduce((sum, score) => sum + score.runAssessments.filter((assessment) => assessment.extractionIssue).length, 0)
  const scoreById = new Map(scores.map((score) => [score.caseId, score]))
  const caseResults = cases.map((caseItem) => {
    const score = scoreById.get(caseItem.id)
    const rows = metrics.byRun.filter((row) => row.caseId === caseItem.id)
    const issueRuns = score.runAssessments.filter((assessment) => assessment.extractionIssue).map((assessment) => assessment.runIndex)
    return {
      caseId: caseItem.id,
      sourceClass: caseItem.sourceClass,
      negativeControl: caseItem.negativeControl,
      runs: rows.length,
      extractionIssueRuns: issueRuns,
      extractionIssueRate: rows.length ? issueRuns.length / rows.length : 0,
      reproducibleIssue: score.reproducibleIssue,
      materialImpact: score.materialImpact,
      passageLocalization: score.passageLocalization,
      evidencePrecision: score.evidencePrecision,
      extractionEfficiency: score.extractionEfficiency,
      sourceFoundRuns: rows.filter((row) => row.sourceFound).length,
      targetFetchedRuns: rows.filter((row) => row.targetFetched).length,
      evidenceFoundRuns: rows.filter((row) => row.expectedEvidenceFound).length,
      citationSupportRuns: rows.filter((row) => row.citationSupportsTarget).length,
      repeatedFetches: rows.reduce((sum, row) => sum + row.repeatedFetches, 0),
      extraSearchesAfterTargetFetch: rows.reduce((sum, row) => sum + row.extraSearchesAfterTargetFetch, 0),
      stepCapRuns: rows.filter((row) => row.stepCapAtBoundary).length,
      primaryRootCause: score.primaryRootCause,
      evidenceNote: score.evidenceNote,
    }
  })
  const scoreAverages = Object.fromEntries(EXTRACTION_DIMENSIONS.map((dimension) => [
    dimension,
    scores.reduce((sum, score) => sum + score[dimension], 0) / scores.length,
  ]))
  const summary = {
    schemaVersion: 1,
    benchmarkName: "retrieval-extraction-stress",
    generatedAt: new Date().toISOString(),
    baselineCommit: "9e91fe032e7e48d4c440b0d7081c2a02f0819fac",
    opencodeVersion: versions[0] ?? null,
    cases: cases.length,
    plannedRuns: cases.reduce((sum, item) => sum + item.repeatRuns, 0),
    records: records.length,
    objective: objectiveMetrics(records),
    extraction: {
      ...metrics,
      runLevelExtractionIssueRuns: runIssueCount,
      runLevelExtractionIssueRate: records.length ? runIssueCount / records.length : 0,
      caseLevelExtractionIssueCases: scores.filter((score) => score.failure && score.primaryRootCause === "FETCH_EXTRACTION").length,
      caseLevelExtractionIssueRate: decision.extractionFailureCaseRate,
      reproducibleCaseCount: decision.reproducibleFailureCases,
      independentSourceClasses: decision.independentSourceClasses,
      scoreAverages,
    },
    decision,
    caseResults,
  }
  await mkdir(dirname(defaultSummaryPath), { recursive: true })
  await writeFile(defaultSummaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
