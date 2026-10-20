import { lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"
import { setTimeout as delay } from "node:timers/promises"

import { validateProductionManifest } from "../film-production/contracts.js"
import { readJson, writeJson } from "./json-store.js"

const DEFAULT_LOCK_TIMEOUT_MS = 5_000
const LOCK_RETRY_MS = 10

async function acquireManifestLock(manifestPath, timeoutMs) {
  const lockPath = `${manifestPath}.lock`
  const token = randomUUID()
  const deadline = performance.now() + timeoutMs
  const contents = `${JSON.stringify({ token, pid: process.pid, acquired_at: new Date().toISOString() })}\n`

  await mkdir(dirname(manifestPath), { recursive: true })
  for (;;) {
    try {
      await writeFile(lockPath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" })
      break
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
      const remaining = deadline - performance.now()
      if (remaining <= 0) {
        throw new Error(`timed out after ${timeoutMs}ms waiting for the ProductionManifest update lock`)
      }
      await delay(Math.min(LOCK_RETRY_MS, remaining))
    }
  }

  return async () => {
    let owner
    try {
      owner = JSON.parse(await readFile(lockPath, "utf8"))
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error("ProductionManifest update lock disappeared before release")
      }
      throw new Error(`could not verify ProductionManifest update lock ownership: ${error.message}`)
    }
    if (owner?.token !== token) {
      throw new Error("ProductionManifest update lock ownership changed; refusing to remove another writer's lock")
    }
    await unlink(lockPath)
  }
}

async function withManifestLock(manifestPath, operation, { timeoutMs = DEFAULT_LOCK_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
    throw new Error("ProductionManifest lock timeout must be a non-negative integer")
  }
  const release = await acquireManifestLock(manifestPath, timeoutMs)
  try {
    return await operation()
  } finally {
    await release()
  }
}

async function readCurrentManifest(manifestPath, { allowMissing = false } = {}) {
  let information
  try {
    information = await lstat(manifestPath)
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null
    throw error
  }
  if (information.isSymbolicLink()) throw new Error("canonical production manifest must not be a symlink")
  if (!information.isFile()) throw new Error("canonical production manifest must be a regular file")
  const manifest = await readJson(manifestPath)
  if (!manifest) throw new Error(`ProductionManifest not found at ${manifestPath}`)
  validateProductionManifest(manifest)
  return manifest
}

/**
 * Serialize one short canonical ProductionManifest read/validate/write transaction.
 * The updater must be synchronous and must not perform provider, filesystem, or agent work.
 */
export async function updateProductionManifest(manifestPath, updater, {
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  persist = writeJson,
} = {}) {
  if (typeof updater !== "function") throw new Error("ProductionManifest updater must be a function")
  return withManifestLock(manifestPath, async () => {
    const current = await readCurrentManifest(manifestPath)
    const next = structuredClone(current)
    const result = updater(next)
    if (result && typeof result.then === "function") {
      throw new Error("ProductionManifest updater must be synchronous")
    }
    validateProductionManifest(next)
    await persist(manifestPath, next)
    return { manifest: next, result }
  }, { timeoutMs })
}

/** Create the canonical manifest once, without replacing a concurrent initializer. */
export async function createProductionManifestIfMissing(manifestPath, initialManifest, {
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
} = {}) {
  return withManifestLock(manifestPath, async () => {
    const current = await readCurrentManifest(manifestPath, { allowMissing: true })
    if (current) {
      return { manifest: current, created: false }
    }
    validateProductionManifest(initialManifest)
    await writeJson(manifestPath, initialManifest)
    return { manifest: initialManifest, created: true }
  }, { timeoutMs })
}
