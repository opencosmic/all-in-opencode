#!/usr/bin/env node
import { appendFile, mkdir, readFile, rm } from "node:fs/promises"
import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildRunPlan,
  createIsolatedConfig,
  detectOpenCodeVersion,
  loadCases,
  normalizeProfessorRun,
  repoRootFromBenchmark,
  resetResultsFile,
} from "./lib.mjs"

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url))
const repoRoot = repoRootFromBenchmark(benchmarkDirectory)
const timeoutMs = 180_000
const environmentKeysToClear = [
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_PURE",
  "AIO_DATA_ROOT",
  "OPENCODE_WORKFLOW_DATA_ROOT",
]

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function hasOption(name) {
  return process.argv.includes(name)
}

function childEnvironment(inherited, config) {
  const environment = { ...inherited }
  for (const key of environmentKeysToClear) delete environment[key]
  return { ...environment, ...config.env, OPENCODE_CONFIG_DIR: config.configDir }
}

async function existingKeys(resultsPath) {
  try {
    const content = await readFile(resultsPath, "utf8")
    return new Set(content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const record = JSON.parse(line)
        return [`${record.caseId}/${record.runIndex}`]
      } catch {
        return []
      }
    }))
  } catch (error) {
    if (error.code === "ENOENT") return new Set()
    throw error
  }
}

function executeProfessor(caseItem, run, config) {
  return new Promise((resolvePromise) => {
    const started = Date.now()
    const stdout = []
    const stderr = []
    const child = spawn("opencode", [
      "run",
      "--agent", "Professor",
      "--dir", repoRoot,
      "--format", "json",
      caseItem.query,
    ], {
      cwd: repoRoot,
      env: childEnvironment(process.env, config),
      stdio: ["ignore", "pipe", "pipe"],
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref()
    }, timeoutMs)
    child.stdout.on("data", (chunk) => stdout.push(chunk))
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    child.on("error", (error) => {
      clearTimeout(timer)
      resolvePromise({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}\n${error.stack ?? error}`,
        exitCode: null,
        signal: null,
        durationMs: Date.now() - started,
        startedAt: new Date(started).toISOString(),
        endedAt: new Date().toISOString(),
        timedOut,
      })
    })
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer)
      resolvePromise({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        signal,
        durationMs: Date.now() - started,
        startedAt: new Date(started).toISOString(),
        endedAt: new Date().toISOString(),
        timedOut,
      })
    })
  })
}

async function main() {
  const casesPath = resolve(benchmarkDirectory, option("--cases") ?? "cases.json")
  const resultsPath = resolve(benchmarkDirectory, option("--out") ?? "results/runs.jsonl")
  const selectedCase = option("--case")
  const cases = await loadCases(casesPath)
  if (selectedCase && !cases.some((item) => item.id === selectedCase)) throw new Error(`unknown Professor case: ${selectedCase}`)
  const plan = buildRunPlan(cases).filter((run) => !selectedCase || run.caseId === selectedCase)
  const version = await detectOpenCodeVersion()
  await mkdir(dirname(resultsPath), { recursive: true })
  if (hasOption("--fresh")) await resetResultsFile(resultsPath)
  const keys = hasOption("--fresh") ? new Set() : await existingKeys(resultsPath)
  const isolated = await createIsolatedConfig(repoRoot, process.env)
  const caseById = new Map(cases.map((item) => [item.id, item]))
  try {
    console.log(`evaluation worktree: ${repoRoot}`)
    console.log(`OpenCode version: ${version}`)
    console.log(`isolated config: ${isolated.root}`)
    console.log(`planned runs: ${plan.length}`)
    for (const item of plan) {
      const key = `${item.caseId}/${item.runIndex}`
      if (keys.has(key)) {
        console.log(`skip ${key}`)
        continue
      }
      const caseItem = caseById.get(item.caseId)
      console.log(`run ${key}: ${caseItem.query}`)
      const raw = await executeProfessor(caseItem, item, isolated)
      const record = await normalizeProfessorRun({ caseItem, ...raw, config: isolated })
      record.opencodeVersion = version
      record.configIsolation = "temporary XDG config/data/state/cache homes plus OPENCODE_CONFIG"
      record.benchmarkName = option("--label") ?? "professor-quality"
      await appendFile(resultsPath, `${JSON.stringify(record)}\n`)
      console.log(`  exit=${record.processExitCode} status=${record.finalStatus} completed=${record.completed} rounds=${record.controllerRounds} tasks=${JSON.stringify(record.taskStatusCounts)} searches=${record.searchCount} fetches=${record.fetchCount} steps=${record.stepCount} durationMs=${record.durationMs}`)
    }
  } finally {
    await rm(isolated.root, { recursive: true, force: true })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()

export { executeProfessor }
