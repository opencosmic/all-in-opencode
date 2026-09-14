#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { loadCases, objectiveMetrics } from "./lib.mjs"

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url))

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function loadRecords(path) {
  const content = await readFile(path, "utf8")
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

async function main() {
  const casesPath = resolve(benchmarkDirectory, option("--cases") ?? "cases.json")
  const resultsPath = resolve(benchmarkDirectory, option("--in") ?? "results/runs.jsonl")
  const outputPath = resolve(benchmarkDirectory, option("--out") ?? "results/summary.json")
  const cases = await loadCases(casesPath)
  const records = await loadRecords(resultsPath)
  const caseIds = new Set(cases.map((item) => item.id))
  for (const record of records) if (!caseIds.has(record.caseId)) throw new Error(`record references unknown Professor case: ${record.caseId}`)
  const summary = {
    schemaVersion: 1,
    benchmarkName: "professor-quality",
    generatedAt: new Date().toISOString(),
    cases: cases.map((item) => ({ id: item.id, category: item.category, blind: item.blind === true, repeatRuns: item.repeatRuns })),
    records: records.length,
    objective: objectiveMetrics(records),
    evaluation: {
      qualityJudgments: "not assigned by the runner; assess final reports against the frozen case prompts and rubric",
      blindAssessments: "B1b-B4b require manual PASS/PARTIAL/FAIL assessment with concise evidence",
    },
  }
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
