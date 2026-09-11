#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  categorySummary,
  loadCases,
  objectiveMetrics,
  validateScores,
} from "./lib.mjs"

const benchmarkDir = dirname(fileURLToPath(import.meta.url))

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function readRecords(resultsPath) {
  const content = await readFile(resultsPath, "utf8")
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

async function main() {
  const casesPath = resolveBenchmarkPath(benchmarkDir, readOption("--cases"), "cases.json")
  const resultsPath = resolveBenchmarkPath(benchmarkDir, readOption("--runs"), "results/runs.jsonl")
  const summaryPath = resolveBenchmarkPath(benchmarkDir, readOption("--out"), "results/summary.json")
  const scoresPath = resolveBenchmarkPath(benchmarkDir, readOption("--scores"), "results/scores.json")
  const records = await readRecords(resultsPath)
  const cases = await loadCases(casesPath)
  let scores = []
  try {
    scores = validateScores(JSON.parse(await readFile(scoresPath, "utf8")), cases)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  const versions = [...new Set(records.map((record) => record.opencodeVersion).filter(Boolean))]
  if (versions.length > 1) throw new Error(`multiple OpenCode versions in results: ${versions.join(", ")}`)
  const benchmarkNames = [...new Set(records.map((record) => record.benchmarkName).filter(Boolean))]
  if (benchmarkNames.length > 1) throw new Error(`multiple benchmark names in results: ${benchmarkNames.join(", ")}`)
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baselineCommit: "9e91fe032e7e48d4c440b0d7081c2a02f0819fac",
    ...(benchmarkNames[0] ? { benchmarkName: benchmarkNames[0] } : {}),
    opencodeVersion: versions[0] ?? null,
    plannedRuns: cases.reduce((sum, item) => sum + item.repeatRuns, 0),
    records: records.length,
    objective: objectiveMetrics(records),
    byCategory: categorySummary(records, cases, scores),
    scoredCases: scores.length,
    quality: {
      passingCases: scores.filter((score) => qualityPassForCase(score, cases)).length,
      totalCases: scores.length,
      passRate: scores.length ? scores.filter((score) => qualityPassForCase(score, cases)).length / scores.length : 0,
      averages: Object.fromEntries(["correctness", "coverage", "citationGrounding", "sourceQuality", "freshness", "retrievalEfficiency"].map((dimension) => {
        const values = scores.map((score) => score[dimension]).filter((value) => value !== null)
        return [dimension, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null]
      })),
      observedFailures: scores.filter((score) => score.failure).length,
      rootCauses: Object.fromEntries(scores.filter((score) => score.failure).reduce((counts, score) => {
        counts.set(score.primaryRootCause, (counts.get(score.primaryRootCause) ?? 0) + 1)
        return counts
      }, new Map())),
      repeatAssessments: scores.filter((score) => score.repeatAssessment).map((score) => ({ caseId: score.caseId, assessment: score.repeatAssessment })),
    },
  }
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
}

function resolveBenchmarkPath(baseDir, requested, fallback) {
  return resolve(baseDir, requested ?? fallback)
}

function qualityPassForCase(score, cases) {
  const caseItem = cases.find((item) => item.id === score.caseId)
  if (!caseItem) return false
  if (score.correctness < 4 || score.coverage < 4 || score.citationGrounding < 4 || score.sourceQuality < 3) return false
  return !caseItem.requiresFreshness || score.freshness >= 4
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
