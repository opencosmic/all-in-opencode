import { randomUUID } from "node:crypto"
import { appendFile, lstat, mkdir, open, readFile, readlink, rename, symlink, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"

import { resolveProjectDataRoot } from "../project-data-root.js"
import { assertSafeId, normalizeResearchState, validateResearchState } from "./state.js"

export const DEFAULT_PROFESSOR_LIBRARY_ROOT = "/Users/code/Documents/Research"

export function resolveProfessorDataRoot(options = {}) {
  const explicit = options.stateDirectory ?? options.dataRoot
  if (explicit) return resolve(String(explicit))
  return resolve(resolveProjectDataRoot(), "professor")
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

function safeObjectiveSlug(objective) {
  const slug = String(objective)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  return slug || "research"
}

function libraryFilename(state, suffix = "") {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(String(state.startedAt ?? state.createdAt ?? ""))?.[0] ?? "research"
  return `${date}-${safeObjectiveSlug(state.objective)}${suffix}.md`
}

function isInside(directory, candidate) {
  const relativePath = relative(directory, candidate)
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !relativePath.startsWith(sep))
}

function resolvedLinkTarget(linkPath, target) {
  return resolve(dirname(linkPath), target)
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

export function createProfessorStore(root, options = {}) {
  const dataRoot = resolve(root)
  const libraryRoot = resolve(options.libraryRoot ?? DEFAULT_PROFESSOR_LIBRARY_ROOT)
  return {
    dataRoot,
    libraryRoot,
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
      normalizeResearchState(state)
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
    async readReport(runId) {
      const paths = runPaths(dataRoot, runId)
      const info = await lstat(paths.report)
      if (!info.isFile()) throw new Error(`canonical report is not a regular file: ${runId}`)
      return readFile(paths.report, "utf8")
    },
    async ensureLibraryLink(state) {
      normalizeResearchState(state)
      validateResearchState(state)
      const paths = runPaths(dataRoot, state.runId)
      const canonicalReport = resolve(paths.report)
      const canonicalInfo = await lstat(canonicalReport)
      if (!canonicalInfo.isFile()) throw new Error(`canonical report is not a regular file: ${state.runId}`)

      await ensureDirectory(libraryRoot)
      const libraryInfo = await lstat(libraryRoot)
      if (!libraryInfo.isDirectory()) throw new Error("research library root is not a regular directory")
      for (let index = 1; index <= 10_000; index += 1) {
        const suffix = index === 1 ? "" : `-${index}`
        const destination = resolve(libraryRoot, libraryFilename(state, suffix))
        if (!isInside(libraryRoot, destination)) throw new Error("research library destination escaped its approved root")
        try {
          const info = await lstat(destination)
          if (info.isSymbolicLink()) {
            const target = resolvedLinkTarget(destination, await readlink(destination))
            if (target === canonicalReport) return { path: destination, created: false }
          }
          continue
        } catch (error) {
          if (error.code !== "ENOENT") throw error
        }
        try {
          await symlink(canonicalReport, destination, "file")
          return { path: destination, created: true }
        } catch (error) {
          if (error.code === "EEXIST") continue
          throw error
        }
      }
      throw new Error("research library filename collision limit exceeded")
    },
  }
}
