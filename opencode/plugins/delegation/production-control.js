import { lstat, mkdir, realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative, sep } from "node:path"

import {
  createProductionManifest,
  normalizeProductionManifest,
  transitionProductionManifest,
  validateCanonicalProductionPath,
  validateProductionManifest,
} from "../film-production/contracts.js"
import { readJson } from "./json-store.js"
import { createProductionManifestIfMissing, updateProductionManifest } from "./production-manifest-store.js"

export const PRODUCTION_ROOT = "production"
export const PRODUCTION_MANIFEST_PATH = "production/production-manifest.json"
const MAX_ARTIFACTS = 64
const CHECKPOINT_INPUT_FIELDS = new Set([
  "current_focus", "completed", "remaining", "verification", "important_artifacts",
])
const TRANSITION_INPUT_FIELDS = new Set(["to_status", "note"])
const GENERATION_APPROVAL_INPUT_FIELDS = new Set(["job_id", "request_digest", "approved_max_usd"])

async function existing(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

function inside(root, path) {
  const offset = relative(root, path)
  return offset === "" || (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
}

async function workspaceRoot(directory) {
  if (typeof directory !== "string" || !directory.trim()) throw new Error("production tools require an active project directory")
  const root = await realpath(directory)
  if (!(await stat(root)).isDirectory()) throw new Error("active project directory is not a directory")
  return root
}

async function productionRoot(workspace, { create = false } = {}) {
  const path = join(workspace, PRODUCTION_ROOT)
  let info = await existing(path)
  if (!info && create) {
    try {
      await mkdir(path)
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
    }
    info = await existing(path)
  }
  if (!info) return null
  if (info.isSymbolicLink()) throw new Error("production root must not be a symlink")
  if (!info.isDirectory()) throw new Error("production root must be a directory")
  const physical = await realpath(path)
  if (!inside(workspace, physical)) throw new Error("production root escapes the active workspace")
  return physical
}

async function canonicalManifest(production, { required = false } = {}) {
  if (!production) {
    if (required) throw new Error("canonical production manifest is missing; run production_preflight first")
    return null
  }
  const path = join(production, "production-manifest.json")
  const info = await existing(path)
  if (!info) {
    if (required) throw new Error("canonical production manifest is missing; run production_preflight first")
    return null
  }
  if (info.isSymbolicLink()) throw new Error("canonical production manifest must not be a symlink")
  if (!info.isFile()) throw new Error("canonical production manifest must be a regular file")
  const manifest = await readJson(path)
  validateProductionManifest(manifest)
  return { path, manifest }
}

function newManifest(projectID) {
  if (typeof projectID !== "string" || !projectID.trim()) {
    throw new Error("production_preflight requires project_id when the canonical manifest is missing")
  }
  const timestamp = new Date().toISOString()
  return createProductionManifest({ project: projectID, created_at: timestamp, updated_at: timestamp })
}

export async function productionPreflight({ project_id: projectID } = {}, directory) {
  const workspace = await workspaceRoot(directory)
  let production = await productionRoot(workspace)
  let current = await canonicalManifest(production)
  let created = false
  if (!current) {
    const manifest = newManifest(projectID)
    production ??= await productionRoot(workspace, { create: true })
    const path = join(production, "production-manifest.json")
    const initialized = await createProductionManifestIfMissing(path, manifest)
    current = { path, manifest: initialized.manifest }
    created = initialized.created
  }
  if (projectID !== undefined && projectID !== current.manifest.project.id) {
    throw new Error(`project_id ${projectID} does not match canonical production ${current.manifest.project.id}`)
  }
  const normalized = normalizeProductionManifest(current.manifest)
  return {
    created,
    project_id: normalized.project.id,
    project_status: normalized.project.status,
    manifest_revision: normalized.revision,
    workspace_root: workspace,
    production_root: production,
    manifest: { canonical_path: PRODUCTION_MANIFEST_PATH, runtime_path: current.path },
    latest_checkpoint: normalized.latest_checkpoint,
    checkpoint_stale: Boolean(normalized.latest_checkpoint && normalized.latest_checkpoint.phase !== normalized.project.status),
  }
}

async function requiredProduction(directory) {
  const workspace = await workspaceRoot(directory)
  const production = await productionRoot(workspace)
  const current = await canonicalManifest(production, { required: true })
  return { workspace, production, ...current }
}

function artifactPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_ARTIFACTS) {
    throw new Error(`production_prepare_artifacts requires 1 to ${MAX_ARTIFACTS} canonical file paths`)
  }
  return paths.map((path, index) => {
    validateCanonicalProductionPath(path, `paths[${index}]`)
    if (path === PRODUCTION_MANIFEST_PATH) throw new Error("the canonical production manifest is reserved")
    return path
  })
}

async function preparedParent(workspace, production, parts) {
  let parent = production
  for (const part of parts) {
    const candidate = join(parent, part)
    let info = await existing(candidate)
    if (!info) {
      try {
        await mkdir(candidate)
      } catch (error) {
        if (error?.code !== "EEXIST") throw error
      }
      info = await existing(candidate)
    }
    if (info.isSymbolicLink()) throw new Error(`artifact parent must not be a symlink: ${candidate}`)
    if (!info.isDirectory()) throw new Error(`artifact parent must be a directory: ${candidate}`)
    parent = await realpath(candidate)
    if (!inside(workspace, parent)) throw new Error(`artifact parent escapes the active workspace: ${candidate}`)
  }
  return parent
}

export async function productionPrepareArtifacts({ paths } = {}, directory) {
  const { workspace, production } = await requiredProduction(directory)
  const canonical = artifactPaths(paths)
  const artifacts = []
  for (const path of canonical) {
    const parts = path.split("/")
    const parent = await preparedParent(workspace, production, parts.slice(1, -1))
    const runtimePath = join(parent, parts.at(-1))
    if (!inside(workspace, runtimePath)) throw new Error(`artifact destination escapes the active workspace: ${path}`)
    const info = await existing(runtimePath)
    if (info?.isSymbolicLink()) throw new Error(`artifact destination must not be a symlink: ${path}`)
    if (info && !info.isFile()) throw new Error(`artifact destination must be a regular file: ${path}`)
    artifacts.push({
      canonical_path: path,
      runtime_path: runtimePath,
      parent_runtime_path: parent,
      existed: Boolean(info),
    })
  }
  return { artifacts }
}

export async function productionSetShots(args = {}, directory) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("production_set_shots input must be an object")
  }
  for (const field of Object.keys(args)) {
    if (field !== "shots") throw new Error(`production_set_shots does not accept ${field}`)
  }
  if (!Array.isArray(args.shots)) throw new Error("production_set_shots requires a complete ShotSpec array in shots")

  const { path } = await requiredProduction(directory)
  const { manifest: next } = await updateProductionManifest(path, (manifest) => {
    manifest.shots = structuredClone(args.shots)
  })
  return {
    project_id: next.project.id,
    project_status: next.project.status,
    manifest_revision: next.revision,
    shot_count: next.shots.length,
    shot_ids: next.shots.map((shot) => shot.shot_id),
    manifest: { canonical_path: PRODUCTION_MANIFEST_PATH, runtime_path: path },
  }
}

export async function productionTransition(args = {}, directory) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("production_transition input must be an object")
  }
  for (const field of Object.keys(args)) {
    if (!TRANSITION_INPUT_FIELDS.has(field)) throw new Error(`production_transition does not accept ${field}`)
  }
  const { path } = await requiredProduction(directory)
  const { manifest: next, result: previousStatus } = await updateProductionManifest(path, (manifest) => {
    const previous = manifest.project.status
    const transitioned = transitionProductionManifest(manifest, args.to_status, {
      at: new Date().toISOString(),
      ...(args.note === undefined ? {} : { note: args.note }),
    })
    Object.assign(manifest, transitioned)
    return previous
  })
  return {
    project_id: next.project.id,
    previous_status: previousStatus,
    status: next.project.status,
    revision: next.revision,
    history_entry: next.history.at(-1),
    manifest: { canonical_path: PRODUCTION_MANIFEST_PATH, runtime_path: path },
  }
}

export async function productionCheckpoint(args = {}, directory) {
  const { path } = await requiredProduction(directory)
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("production_checkpoint input must be an object")
  for (const field of Object.keys(args)) {
    if (!CHECKPOINT_INPUT_FIELDS.has(field)) throw new Error(`production_checkpoint does not accept ${field}`)
  }
  const { manifest: next, result: checkpoint } = await updateProductionManifest(path, (manifest) => {
    const currentCheckpoint = {
      phase: manifest.project.status,
      current_focus: Object.hasOwn(args, "current_focus") ? args.current_focus : null,
      completed: Object.hasOwn(args, "completed") ? args.completed : [],
      remaining: Object.hasOwn(args, "remaining") ? args.remaining : [],
      verification: Object.hasOwn(args, "verification") ? args.verification : {},
      important_artifacts: Object.hasOwn(args, "important_artifacts") ? args.important_artifacts : [],
      updated_at: new Date().toISOString(),
    }
    manifest.latest_checkpoint = currentCheckpoint
    return currentCheckpoint
  })
  return {
    project_id: next.project.id,
    project_status: next.project.status,
    manifest_revision: next.revision,
    manifest: { canonical_path: PRODUCTION_MANIFEST_PATH, runtime_path: path },
    latest_checkpoint: checkpoint,
  }
}

export async function productionApproveGeneration(args = {}, directory) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("production_approve_generation input must be an object")
  }
  for (const field of Object.keys(args)) {
    if (!GENERATION_APPROVAL_INPUT_FIELDS.has(field)) {
      throw new Error(`production_approve_generation does not accept ${field}`)
    }
  }
  if (typeof args.job_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(args.job_id)) {
    throw new Error("production_approve_generation requires a valid job_id")
  }
  if (typeof args.request_digest !== "string" || !/^[a-f0-9]{64}$/.test(args.request_digest)) {
    throw new Error("production_approve_generation requires a lowercase SHA-256 request_digest")
  }
  if (typeof args.approved_max_usd !== "number" || !Number.isFinite(args.approved_max_usd) || args.approved_max_usd < 0) {
    throw new Error("approved_max_usd must be a non-negative number")
  }

  const { path } = await requiredProduction(directory)
  const { result: approved } = await updateProductionManifest(path, (manifest) => {
    const job = manifest.generation_jobs.find((candidate) => candidate.job_id === args.job_id)
    if (!job) throw new Error(`ProductionManifest has no generation job ${args.job_id}`)
    if (job.status !== "calculated") {
      throw new Error(`generation job ${args.job_id} must be calculated before Producer approval`)
    }
    if (job.request_digest !== args.request_digest) {
      throw new Error("generation approval rejected: request_digest does not match the calculated job")
    }
    if (typeof job.estimated_usd !== "number" || !Number.isFinite(job.estimated_usd) || job.estimated_usd < 0) {
      throw new Error(`generation job ${args.job_id} has no valid calculated price to approve`)
    }
    if (args.approved_max_usd < job.estimated_usd) {
      throw new Error(`approved_max_usd ${args.approved_max_usd} is below the calculated price ${job.estimated_usd}`)
    }

    const timestamp = new Date().toISOString()
    Object.assign(job, {
      // Existing status used for a quoted job cleared by Producer and waiting for Creator submission.
      status: "awaiting_approval",
      approved_usd: args.approved_max_usd,
      approved_max_usd: args.approved_max_usd,
      approved_price_usd: job.estimated_usd,
      updated_at: timestamp,
    })
    manifest.costs.approved_usd = manifest.generation_jobs
      .map((candidate) => candidate.approved_usd)
      .filter((value) => typeof value === "number" && Number.isFinite(value))
      .reduce((total, value) => total + value, 0)
    manifest.updated_at = timestamp
    return {
      job_id: job.job_id,
      status: job.status,
      request_digest: job.request_digest,
      approved_price_usd: job.approved_price_usd,
      approved_max_usd: job.approved_max_usd,
    }
  })
  return {
    ...approved,
    manifest: { canonical_path: PRODUCTION_MANIFEST_PATH, runtime_path: path },
  }
}
