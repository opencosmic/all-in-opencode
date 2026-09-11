import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, writeFile, appendFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { assertSafeId, validateResearchState } from "./state.js"

export function resolveProfessorDataRoot(options = {}) {
  const explicit = options.stateDirectory ?? options.dataRoot
  if (explicit) return resolve(String(explicit))
  const configuredRoot = process.env.OPENCODE_WORKFLOW_DATA_ROOT
  if (configuredRoot) return resolve(configuredRoot, "professor")
  const xdgDataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  return resolve(xdgDataHome, "opencode-workflow", "professor")
}

function runPaths(dataRoot, runId) {
  assertSafeId(runId, "runId")
  const directory = join(dataRoot, "runs", runId)
  return {
    directory,
    state: join(directory, "state.json"),
    events: join(directory, "events.jsonl"),
    report: join(directory, "report.md"),
  }
}
async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
}

async function atomicWrite(path, contents) {
  await ensureDirectory(dirname(path))
  const temporary = join(dirname(path), `.${path.split("/").pop()}.${process.pid}.${randomUUID()}.tmp`)
  const handle = await open(temporary, "w", 0o600)
  try {
    await handle.writeFile(contents, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
}

export function createProfessorStore(root) {
  const dataRoot = resolve(root)
  return {
    dataRoot,
    paths(runId) {
      return runPaths(dataRoot, runId)
    },
    async ensureRoot() {
      await ensureDirectory(join(dataRoot, "runs"))
    },
    async createRun(state) {
      validateResearchState(state)
      const paths = runPaths(dataRoot, state.runId)
      await ensureDirectory(paths.directory)
      await atomicWrite(paths.state, `${JSON.stringify(state, null, 2)}\n`)
      await writeFile(paths.events, "", { encoding: "utf8", mode: 0o600, flag: "wx" }).catch((error) => {
        if (error.code !== "EEXIST") throw error
      })
      return paths
    },
    async loadState(runId) {
      const paths = runPaths(dataRoot, runId)
      const state = JSON.parse(await readFile(paths.state, "utf8"))
      validateResearchState(state)
      return state
    },
    async saveState(state) {
      validateResearchState(state)
      const paths = runPaths(dataRoot, state.runId)
      await atomicWrite(paths.state, `${JSON.stringify(state, null, 2)}\n`)
      return paths
    },
    async appendEvents(runId, events) {
      if (!Array.isArray(events) || events.length === 0) return
      const paths = runPaths(dataRoot, runId)
      await ensureDirectory(paths.directory)
      const payload = events.map((event) => JSON.stringify(event)).join("\n") + "\n"
      await appendFile(paths.events, payload, { encoding: "utf8", mode: 0o600 })
    },
    async readEvents(runId) {
      const paths = runPaths(dataRoot, runId)
      const contents = await readFile(paths.events, "utf8")
      return contents
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    },
    async writeReport(runId, report) {
      const paths = runPaths(dataRoot, runId)
      await atomicWrite(paths.report, report.endsWith("\n") ? report : `${report}\n`)
      return paths.report
    },
  }
}
