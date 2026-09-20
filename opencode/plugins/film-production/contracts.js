const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const ASPECT_RATIO = /^\d+:\d+$/

export const SHOT_SPEC_VERSION = 1
export const PRODUCTION_MANIFEST_VERSION = 1

export const PREVIS_MODES = Object.freeze(["required", "recommended", "optional"])
export const PRODUCTION_STATUSES = Object.freeze([
  "planning",
  "previs",
  "production",
  "assets-ready",
  "composition",
  "qa",
  "completed",
  "failed",
])

const GENERATION_JOB_STATUSES = new Set([
  "planned",
  "calculated",
  "awaiting_approval",
  "submitted",
  "running",
  "completed",
  "failed",
])

const ASSET_STATUSES = new Set(["required", "pending", "ready", "used", "failed"])

const PRODUCTION_TRANSITIONS = Object.freeze({
  planning: ["previs", "production", "failed"],
  previs: ["planning", "production", "failed"],
  production: ["planning", "assets-ready", "composition", "failed"],
  "assets-ready": ["production", "composition", "failed"],
  composition: ["production", "qa", "failed"],
  qa: ["production", "composition", "completed", "failed"],
  completed: [],
  failed: ["planning"],
})

const INITIAL_PRODUCTION_STATUS = "planning"

function contractError(path, message) {
  throw new Error(`${path} ${message}`)
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    contractError(path, "must be an object")
  }
  return value
}

function nonEmptyString(value, path, maxLength = 4_000) {
  if (typeof value !== "string" || !value.trim()) contractError(path, "must be a non-empty string")
  if (value.length > maxLength) contractError(path, `must be at most ${maxLength} characters`)
  return value.trim()
}

function identifier(value, path) {
  const result = nonEmptyString(value, path, 128)
  if (!SAFE_IDENTIFIER.test(result)) contractError(path, "must contain only letters, numbers, underscores, and hyphens")
  return result
}

function positiveNumber(value, path, { integer = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > maximum) {
    contractError(path, `must be a positive number no greater than ${maximum}`)
  }
  if (integer && !Number.isInteger(value)) contractError(path, "must be an integer")
  return value
}

function nullableNonNegativeNumber(value, path) {
  if (value === null) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    contractError(path, "must be null or a non-negative number")
  }
  return value
}

function stringArray(value, path) {
  if (!Array.isArray(value)) contractError(path, "must be an array of strings")
  for (const [index, item] of value.entries()) nonEmptyString(item, `${path}[${index}]`)
  return value
}

function validateShotReferences(value, path) {
  const references = object(value, path)
  for (const [name, entries] of Object.entries(references)) {
    stringArray(entries, `${path}.${name}`)
  }
  return references
}

function validateShotSpecFields(spec, path) {
  identifier(spec.shot_id, `${path}.shot_id`)
  nonEmptyString(spec.purpose, `${path}.purpose`, 240)
  positiveNumber(spec.duration_seconds, `${path}.duration_seconds`, { maximum: 3_600 })

  const subject = object(spec.subject, `${path}.subject`)
  identifier(subject.id, `${path}.subject.id`)
  nonEmptyString(subject.action, `${path}.subject.action`, 1_000)

  const camera = object(spec.camera, `${path}.camera`)
  nonEmptyString(camera.movement, `${path}.camera.movement`, 240)
  positiveNumber(camera.lens_mm, `${path}.camera.lens_mm`, { maximum: 2_000 })
  if (camera.arc_degrees !== undefined) {
    if (typeof camera.arc_degrees !== "number" || !Number.isFinite(camera.arc_degrees) || Math.abs(camera.arc_degrees) > 720) {
      contractError(`${path}.camera.arc_degrees`, "must be a finite number between -720 and 720")
    }
  }
  nonEmptyString(camera.framing_start, `${path}.camera.framing_start`, 120)
  nonEmptyString(camera.framing_end, `${path}.camera.framing_end`, 120)

  const environment = object(spec.environment, `${path}.environment`)
  identifier(environment.id, `${path}.environment.id`)

  if (spec.references !== undefined) validateShotReferences(spec.references, `${path}.references`)

  if (spec.control !== undefined) {
    const control = object(spec.control, `${path}.control`)
    if (control.previs !== undefined && !PREVIS_MODES.includes(control.previs)) {
      contractError(`${path}.control.previs`, `must be one of: ${PREVIS_MODES.join(", ")}`)
    }
  }

  if (spec.generation !== undefined) {
    const generation = object(spec.generation, `${path}.generation`)
    if (generation.intent !== undefined) nonEmptyString(generation.intent, `${path}.generation.intent`, 240)
  }

  const output = object(spec.output, `${path}.output`)
  const aspectRatio = nonEmptyString(output.aspect_ratio, `${path}.output.aspect_ratio`, 32)
  if (!ASPECT_RATIO.test(aspectRatio)) contractError(`${path}.output.aspect_ratio`, "must use a ratio such as 16:9")
  positiveNumber(output.fps, `${path}.output.fps`, { integer: true, maximum: 240 })

  if (spec.extensions !== undefined) object(spec.extensions, `${path}.extensions`)
  return spec
}

export function validateShotSpec(spec, path = "ShotSpec") {
  object(spec, path)
  if (spec.schema_version !== undefined && spec.schema_version !== SHOT_SPEC_VERSION) {
    contractError(`${path}.schema_version`, `must be ${SHOT_SPEC_VERSION}`)
  }
  return validateShotSpecFields(spec, path)
}

export function normalizeShotSpec(spec) {
  validateShotSpec(spec)
  return structuredClone({
    schema_version: SHOT_SPEC_VERSION,
    ...spec,
  })
}

export function createShotSpec(spec) {
  return normalizeShotSpec(spec)
}

export function validateShotSpecs(shots, path = "ProductionManifest.shots") {
  if (!Array.isArray(shots)) contractError(path, "must be an array")
  const seen = new Set()
  for (const [index, shot] of shots.entries()) {
    validateShotSpec(shot, `${path}[${index}]`)
    if (seen.has(shot.shot_id)) contractError(`${path}[${index}].shot_id`, `duplicates ${shot.shot_id}`)
    seen.add(shot.shot_id)
  }
  return shots
}

function validateAsset(asset, path) {
  object(asset, path)
  identifier(asset.asset_id, `${path}.asset_id`)
  if (asset.kind !== undefined) nonEmptyString(asset.kind, `${path}.kind`, 120)
  if (asset.status !== undefined && !ASSET_STATUSES.has(asset.status)) {
    contractError(`${path}.status`, `must be one of: ${[...ASSET_STATUSES].join(", ")}`)
  }
  for (const field of ["path", "uri", "role", "source"]) {
    if (asset[field] !== undefined) nonEmptyString(asset[field], `${path}.${field}`)
  }
  if (asset.shot_ids !== undefined) {
    stringArray(asset.shot_ids, `${path}.shot_ids`)
    for (const [index, shotId] of asset.shot_ids.entries()) identifier(shotId, `${path}.shot_ids[${index}]`)
  }
  if (asset.metadata !== undefined) object(asset.metadata, `${path}.metadata`)
}

function validateGenerationJob(job, path) {
  object(job, path)
  identifier(job.job_id, `${path}.job_id`)
  identifier(job.shot_id, `${path}.shot_id`)
  if (job.status !== undefined && !GENERATION_JOB_STATUSES.has(job.status)) {
    contractError(`${path}.status`, `must be one of: ${[...GENERATION_JOB_STATUSES].join(", ")}`)
  }
  for (const field of ["request_digest", "output", "error"]) {
    if (job[field] !== undefined && job[field] !== null) {
      if (field === "output" && typeof job[field] === "object" && !Array.isArray(job[field])) continue
      nonEmptyString(job[field], `${path}.${field}`)
    }
  }
  if (job.estimated_usd !== undefined) nullableNonNegativeNumber(job.estimated_usd, `${path}.estimated_usd`)
  if (job.actual_usd !== undefined) nullableNonNegativeNumber(job.actual_usd, `${path}.actual_usd`)
}

function validateArtifact(value, path) {
  if (value === null) return
  if (typeof value === "string") {
    nonEmptyString(value, path)
    return
  }
  const artifact = object(value, path)
  if (artifact.path === undefined && artifact.uri === undefined && artifact.asset_id === undefined) {
    contractError(path, "must identify a path, URI, or asset_id")
  }
  for (const field of ["path", "uri", "asset_id", "kind"]) {
    if (artifact[field] !== undefined) nonEmptyString(artifact[field], `${path}.${field}`)
  }
}

function validateHistory(value, path) {
  if (!Array.isArray(value)) contractError(path, "must be an array")
  for (const [index, event] of value.entries()) {
    const entry = object(event, `${path}[${index}]`)
    const from = nonEmptyString(entry.from, `${path}[${index}].from`, 80)
    const status = nonEmptyString(entry.status, `${path}[${index}].status`, 80)
    if (!PRODUCTION_STATUSES.includes(from)) {
      contractError(`${path}[${index}].from`, `must be one of: ${PRODUCTION_STATUSES.join(", ")}`)
    }
    if (!PRODUCTION_STATUSES.includes(status)) {
      contractError(`${path}[${index}].status`, `must be one of: ${PRODUCTION_STATUSES.join(", ")}`)
    }
    if (index === 0 && from !== INITIAL_PRODUCTION_STATUS) {
      contractError(`${path}[${index}].from`, `must start from ${INITIAL_PRODUCTION_STATUS}`)
    }
    if (index > 0 && from !== value[index - 1].status) {
      contractError(`${path}[${index}].from`, `must match previous status ${value[index - 1].status}`)
    }
    if (!PRODUCTION_TRANSITIONS[from].includes(status)) {
      contractError(`${path}[${index}]`, `cannot transition from ${from} to ${status}`)
    }
    if (entry.at !== undefined) nonEmptyString(entry.at, `${path}[${index}].at`, 80)
    if (entry.note !== undefined) nonEmptyString(entry.note, `${path}[${index}].note`, 1_000)
  }
  return value
}

export function validateProductionManifest(manifest, path = "ProductionManifest") {
  object(manifest, path)
  if (manifest.schema_version !== undefined && manifest.schema_version !== PRODUCTION_MANIFEST_VERSION) {
    contractError(`${path}.schema_version`, `must be ${PRODUCTION_MANIFEST_VERSION}`)
  }

  const project = object(manifest.project, `${path}.project`)
  identifier(project.id, `${path}.project.id`)
  if (!PRODUCTION_STATUSES.includes(project.status)) {
    contractError(`${path}.project.status`, `must be one of: ${PRODUCTION_STATUSES.join(", ")}`)
  }

  if (!Object.hasOwn(manifest, "revision")) contractError(`${path}.revision`, "must be present")
  if (!Number.isInteger(manifest.revision) || manifest.revision < 0) {
    contractError(`${path}.revision`, "must be a non-negative integer")
  }
  if (!Object.hasOwn(manifest, "history")) contractError(`${path}.history`, "must be present")
  const history = validateHistory(manifest.history, `${path}.history`)
  if (manifest.revision !== history.length) {
    contractError(`${path}.revision`, `must equal history.length (${history.length})`)
  }
  if (history.length === 0 && project.status !== INITIAL_PRODUCTION_STATUS) {
    contractError(`${path}.project.status`, `must be ${INITIAL_PRODUCTION_STATUS} when history is empty`)
  }
  if (history.length > 0 && history.at(-1).status !== project.status) {
    contractError(`${path}.project.status`, `must match history[last].status (${history.at(-1).status})`)
  }

  validateShotSpecs(manifest.shots, `${path}.shots`)
  const shotIds = new Set(manifest.shots.map((shot) => shot.shot_id))
  if (!Array.isArray(manifest.assets)) contractError(`${path}.assets`, "must be an array")
  const assetIds = new Set()
  for (const [index, asset] of manifest.assets.entries()) {
    validateAsset(asset, `${path}.assets[${index}]`)
    if (assetIds.has(asset.asset_id)) contractError(`${path}.assets[${index}].asset_id`, `duplicates ${asset.asset_id}`)
    for (const [shotIndex, shotId] of (asset.shot_ids ?? []).entries()) {
      if (!shotIds.has(shotId)) {
        contractError(
          `${path}.assets[${index}].shot_ids[${shotIndex}]`,
          `asset "${asset.asset_id}" references unknown shot "${shotId}"`,
        )
      }
    }
    assetIds.add(asset.asset_id)
  }

  if (!Array.isArray(manifest.generation_jobs)) contractError(`${path}.generation_jobs`, "must be an array")
  const jobIds = new Set()
  for (const [index, job] of manifest.generation_jobs.entries()) {
    validateGenerationJob(job, `${path}.generation_jobs[${index}]`)
    if (jobIds.has(job.job_id)) contractError(`${path}.generation_jobs[${index}].job_id`, `duplicates ${job.job_id}`)
    if (!shotIds.has(job.shot_id)) {
      contractError(
        `${path}.generation_jobs[${index}].shot_id`,
        `generation job "${job.job_id}" references unknown shot "${job.shot_id}"`,
      )
    }
    jobIds.add(job.job_id)
  }

  const costs = object(manifest.costs, `${path}.costs`)
  for (const field of ["estimated_usd", "approved_usd", "actual_usd"]) {
    if (!(field in costs)) contractError(`${path}.costs.${field}`, "must be present")
    nullableNonNegativeNumber(costs[field], `${path}.costs.${field}`)
  }

  const outputs = object(manifest.outputs, `${path}.outputs`)
  for (const field of ["rough_cut", "final"]) {
    if (!(field in outputs)) contractError(`${path}.outputs.${field}`, "must be present")
    validateArtifact(outputs[field], `${path}.outputs.${field}`)
  }

  for (const field of ["created_at", "updated_at", "request_digest"]) {
    if (manifest[field] !== undefined && manifest[field] !== null) nonEmptyString(manifest[field], `${path}.${field}`, 4_000)
  }
  return manifest
}

export function normalizeProductionManifest(manifest) {
  object(manifest, "ProductionManifest")
  const normalized = structuredClone({
    schema_version: PRODUCTION_MANIFEST_VERSION,
    revision: 0,
    shots: [],
    assets: [],
    generation_jobs: [],
    costs: {
      estimated_usd: null,
      approved_usd: null,
      actual_usd: null,
    },
    outputs: {
      rough_cut: null,
      final: null,
    },
    history: [],
    ...manifest,
  })
  normalized.costs = {
    estimated_usd: null,
    approved_usd: null,
    actual_usd: null,
    ...(manifest.costs ?? {}),
  }
  normalized.outputs = {
    rough_cut: null,
    final: null,
    ...(manifest.outputs ?? {}),
  }
  validateProductionManifest(normalized)
  return normalized
}

export function createProductionManifest({ project, ...rest } = {}) {
  return normalizeProductionManifest({
    project: typeof project === "string" ? { id: project, status: INITIAL_PRODUCTION_STATUS } : project,
    ...rest,
  })
}

export function transitionProductionManifest(manifest, nextStatus, { at, note } = {}) {
  const current = normalizeProductionManifest(manifest)
  if (!PRODUCTION_STATUSES.includes(nextStatus)) {
    contractError("nextStatus", `must be one of: ${PRODUCTION_STATUSES.join(", ")}`)
  }
  if (!PRODUCTION_TRANSITIONS[current.project.status]?.includes(nextStatus)) {
    throw new Error(`ProductionManifest cannot transition from ${current.project.status} to ${nextStatus}`)
  }
  const next = {
    ...current,
    project: { ...current.project, status: nextStatus },
    revision: current.revision + 1,
    history: [
      ...current.history,
      {
        ...(at === undefined ? {} : { at: nonEmptyString(at, "at", 80) }),
        from: current.project.status,
        status: nextStatus,
        ...(note === undefined ? {} : { note: nonEmptyString(note, "note", 1_000) }),
      },
    ],
    ...(at === undefined ? {} : { updated_at: at }),
  }
  return normalizeProductionManifest(next)
}

export function isShotSpec(value) {
  try {
    validateShotSpec(value)
    return true
  } catch {
    return false
  }
}

export function isProductionManifest(value) {
  try {
    validateProductionManifest(value)
    return true
  } catch {
    return false
  }
}

export { PRODUCTION_TRANSITIONS }
