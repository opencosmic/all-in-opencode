#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  categorySummary,
  loadCases,
  objectiveMetrics,
  validateScores,
} from "./lib.mjs"

const benchmarkDir = dirname(fileURLToPath(import.meta.url))
const resultsPath = join(benchmarkDir, "results/runs.jsonl")
const summaryPath = join(benchmarkDir, "results/summary.json")
const scoresPath = join(benchmarkDir, "results/scores.json")

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function readRecords() {
  const content = await readFile(resultsPath, "utf8")
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

async function main() {
  const records = await readRecords()
  const cases = await loadCases(join(benchmarkDir, "cases.json"))
  let scores = []
  try {
    scores = validateScores(JSON.parse(await readFile(scoresPath, "utf8")), cases)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baselineCommit: "9e91fe032e7e48d4c440b0d7081c2a02f0819fac",
    opencodeVersion: "1.18.30",
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
  const outputPath = readOption("--out") ?? summaryPath
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
}

function qualityPassForCase(score, cases) {
  const caseItem = cases.find((item) => item.id === score.caseId)
  if (!caseItem) return false
  if (score.correctness < 4 || score.coverage < 4 || score.citationGrounding < 4 || score.sourceQuality < 3) return false
  return !caseItem.requiresFreshness || score.freshness >= 4
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
