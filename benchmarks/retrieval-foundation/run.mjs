#!/usr/bin/env node
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildRunPlan,
  createIsolatedConfig,
  detectOpenCodeVersion,
  loadCases,
  normalizeEvents,
  resetResultsFile,
  resolveBenchmarkPath,
} from "./lib.mjs"

const benchmarkDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(benchmarkDir, "../..")
const timeoutMs = 180_000

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function hasOption(name) {
  return process.argv.includes(name)
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

function executeOpenCode(caseItem, run) {
  return new Promise((resolvePromise) => {
    const started = Date.now()
    const stdout = []
    const stderr = []
    const child = spawn("opencode", [
      "run",
      "--agent", "Searcher",
      "--dir", repoRoot,
      "--format", "json",
      caseItem.query,
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...run.config.env,
      },
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
      resolvePromise(normalizeEvents({
        caseItem,
        runIndex: run.runIndex,
        runKind: run.runKind,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}\n${error.stack ?? error}`,
        exitCode: null,
        signal: null,
        durationMs: Date.now() - started,
        startedAt: new Date(started).toISOString(),
        endedAt: new Date().toISOString(),
        timedOut,
      }))
    })
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer)
      resolvePromise(normalizeEvents({
        caseItem,
        runIndex: run.runIndex,
        runKind: run.runKind,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        signal,
        durationMs: Date.now() - started,
        startedAt: new Date(started).toISOString(),
        endedAt: new Date().toISOString(),
        timedOut,
      }))
    })
  })
}

async function main() {
  const casesPath = resolveBenchmarkPath(benchmarkDir, option("--cases"), "cases.json")
  const resultsPath = resolveBenchmarkPath(benchmarkDir, option("--out"), "results/runs.jsonl")
  const benchmarkName = option("--label") ?? "retrieval-foundation"
  const cases = await loadCases(casesPath)
  const selectedCase = option("--case")
  const plan = buildRunPlan(cases).filter((run) => !selectedCase || run.caseId === selectedCase)
  if (selectedCase && !cases.some((item) => item.id === selectedCase)) throw new Error(`unknown case: ${selectedCase}`)
  const opencodeVersion = await detectOpenCodeVersion()
  await mkdir(dirname(resultsPath), { recursive: true })
  if (hasOption("--fresh")) await resetResultsFile(resultsPath)
  const keys = hasOption("--fresh") ? new Set() : await existingKeys(resultsPath)
  const isolated = await createIsolatedConfig(repoRoot)
  const caseById = new Map(cases.map((item) => [item.id, item]))
  const run = { config: isolated }
  try {
    console.log(`evaluation worktree: ${repoRoot}`)
    console.log(`isolated config: ${isolated.root}`)
    console.log(`planned runs: ${plan.length}`)
    for (const item of plan) {
      const key = `${item.caseId}/${item.runIndex}`
      if (keys.has(key)) {
        console.log(`skip ${key}`)
        continue
      }
      console.log(`run ${key}: ${caseById.get(item.caseId).query}`)
      const record = await executeOpenCode(caseById.get(item.caseId), { ...item, config: isolated })
      record.benchmarkName = benchmarkName
      record.configIsolation = "temporary XDG_CONFIG_HOME plus OPENCODE_CONFIG"
      record.opencodeVersion = opencodeVersion
      await appendFile(resultsPath, `${JSON.stringify(record)}\n`)
      console.log(`  exit=${record.processExitCode} searches=${record.searchCalls} fetches=${record.fetchCalls} steps=${record.stepCount} durationMs=${record.durationMs}`)
    }
  } finally {
    // The temporary config contains only symlinks to this worktree and is safe
    // to remove after child processes have exited. Keep normalized evidence in Git.
    const { rm } = await import("node:fs/promises")
    await rm(isolated.root, { recursive: true, force: true })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()

export { executeOpenCode }
