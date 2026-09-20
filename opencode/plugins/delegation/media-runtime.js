import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path"

import { validateProductionManifest } from "../film-production/contracts.js"
import { readJson, writeJson } from "./json-store.js"
import { createAtlasClient } from "./atlas-client.js"

export const MEDIA_RUNTIME_TOOL_NAMES = Object.freeze([
  "media_calculate",
  "media_upload",
  "media_generate_image",
  "media_generate_video",
  "media_prediction",
  "media_wait_prediction",
])

export const ATLAS_IMAGE_MODEL = "bytedance/seedream-v5.0-pro/text-to-image"
export const ATLAS_VIDEO_MODEL = "bytedance/seedance-2.0-fast/reference-to-video"

const MEDIA_RUNTIME_TOOL_SET = new Set(MEDIA_RUNTIME_TOOL_NAMES)
const IMAGE_SIZES = new Set([
  "2048*2048",
  "2304*1728",
  "1728*2304",
  "2720*1530",
  "1530*2720",
  "2496*1664",
  "1664*2496",
  "1024*1024",
  "1536*1536",
  "1776*1328",
  "1328*1776",
  "2048*1152",
  "1152*2048",
])
const IMAGE_FORMATS = new Set(["jpeg", "png"])
const THINKING_MODES = new Set(["enabled", "disabled"])
const PROMPT_MODES = new Set(["standard", "fast"])
const VIDEO_DURATIONS = new Set(Array.from({ length: 12 }, (_, index) => index + 4))
const VIDEO_RESOLUTIONS = new Set(["480p", "720p", "720p-SR", "1080p-SR", "1440p-SR"])
const VIDEO_RATIOS = new Set(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"])
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif"])
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"])
const MIME_BY_EXTENSION = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/x-m4v",
})
const MIME_EXTENSIONS = Object.freeze({
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
})
const SENSITIVE_KEYS = new Set(["api_key", "apikey", "authorization", "secret", "token"])
const IMAGE_ONLY_FIELDS = Object.freeze([
  "size",
  "output_format",
  "thinking",
  "prompt_optimization_mode",
])
const VIDEO_ONLY_FIELDS = Object.freeze([
  "reference_image_asset_ids",
  "reference_video_asset_ids",
  "duration_seconds",
  "resolution",
  "ratio",
])

function shortDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)
}

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

function identifier(value, name) {
  const result = required(value, name)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(result)) {
    throw new Error(`${name} must contain only letters, numbers, underscores, and hyphens`)
  }
  return result
}

function nonNegative(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`)
  }
  return value
}

function safeProviderText(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/(?:api[_-]?key|authorization|token|secret)\s*[:=]\s*[^\s,}"']+/gi, "credential=[redacted]")
    .slice(0, 400)
}

function validateProviderURL(value, name = "provider_url") {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty provider URL`)
  let parsed
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`)
  }
  if (parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS`)
  return parsed.toString()
}

function canonicalValue(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalValue(item)).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => !SENSITIVE_KEYS.has(key.toLowerCase()) && value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
      .join(",")}}`
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("request contains a non-finite number")
  return JSON.stringify(value)
}

export function canonicalJson(value) {
  return canonicalValue(value)
}

export function requestDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function unwrapData(payload) {
  if (payload && typeof payload === "object" && payload.data && typeof payload.data === "object") {
    return payload.data
  }
  return payload
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeCost(payload) {
  const data = unwrapData(payload)
  const hasOriginPrice = data?.origin_price !== undefined && data?.origin_price !== null
  const hasDiscount = data?.discount !== undefined && data?.discount !== null
  const price = finiteNumber(data?.price)
  const originPrice = hasOriginPrice ? finiteNumber(data.origin_price) : null
  const discount = hasDiscount ? finiteNumber(data.discount) : null
  if (!data || typeof data !== "object" || price === null || price < 0) {
    throw new Error("Atlas calculate returned a malformed response: missing non-negative data.price")
  }
  if (hasOriginPrice && (originPrice === null || originPrice < 0)) {
    throw new Error("Atlas calculate returned a malformed response: origin_price must be non-negative")
  }
  if (hasDiscount && (discount === null || discount < 0 || discount > 100)) {
    throw new Error("Atlas calculate returned a malformed response: discount must be between 0 and 100")
  }
  if (data.estimated_tokens !== undefined && data.estimated_tokens !== null
    && (!Number.isInteger(data.estimated_tokens) || data.estimated_tokens < 0)) {
    throw new Error("Atlas calculate returned a malformed response: estimated_tokens must be a non-negative integer")
  }
  const cost = {
    price_usd: price,
    origin_price_usd: originPrice,
    discount,
    estimated: data.estimated === true,
  }
  if (typeof data.estimated_tokens === "number") cost.estimated_tokens = data.estimated_tokens
  return cost
}

function normalizeSubmission(payload) {
  const data = unwrapData(payload)
  const predictionId = data?.id ?? data?.prediction_id
  if (typeof predictionId !== "string" || !predictionId.trim()) {
    throw new Error("Atlas generation returned a malformed response: missing prediction ID")
  }
  return {
    prediction_id: predictionId.trim(),
    provider_status: typeof data.status === "string" ? data.status : "submitted",
  }
}

function normalizePrediction(payload, requestedPredictionID) {
  const data = unwrapData(payload)
  const predictionID = typeof data?.id === "string" && data.id.trim() ? data.id.trim() : requestedPredictionID
  if (!data || typeof data !== "object" || typeof data.status !== "string" || !predictionID) {
    throw new Error("Atlas prediction returned a malformed response: missing status or prediction ID")
  }
  const providerStatus = data.status.trim().toLowerCase()
  const status = providerStatus === "processing" || providerStatus === "queued" || providerStatus === "pending" || providerStatus === "running"
    ? "processing"
    : providerStatus === "completed" || providerStatus === "succeeded"
      ? "completed"
      : providerStatus === "failed" || providerStatus === "error"
        ? "failed"
        : providerStatus === "timeout" || providerStatus === "timed_out"
          ? "timeout"
          : null
  if (!status) throw new Error(`Atlas prediction returned unsupported status: ${safeProviderText(data.status)}`)

  const outputs = data.outputs === undefined ? [] : data.outputs
  if (!Array.isArray(outputs) || outputs.some((output) => typeof output !== "string" || !output.trim())) {
    throw new Error("Atlas prediction returned a malformed response: outputs must be an array of URLs")
  }
  const result = {
    prediction_id: predictionID,
    status,
    provider_status: data.status,
    outputs: outputs.map((output) => output.trim()),
  }
  if (data.error !== undefined && data.error !== null) {
    result.error = safeProviderText(typeof data.error === "string" ? data.error : data.error.message)
  }
  if (typeof data.price === "number" && Number.isFinite(data.price) && data.price >= 0) result.actual_usd = data.price
  return result
}

function validateChoice(value, name, choices) {
  if (value !== undefined && !choices.has(value)) throw new Error(`${name} must be one of: ${[...choices].join(", ")}`)
  return value
}

function assetIDs(value, name, maximum) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${name} must contain at most ${maximum} asset IDs`)
  const seen = new Set()
  return value.map((entry, index) => {
    const assetID = identifier(entry, `${name}[${index}]`)
    if (seen.has(assetID)) throw new Error(`${name} must not contain duplicate asset ID ${assetID}`)
    seen.add(assetID)
    return assetID
  })
}

async function buildEffectiveAtlasRequest(mediaType, args, resolveReferenceURL) {
  if (!["image", "video"].includes(mediaType)) throw new Error("media_type must be image or video")
  if (args.media_type !== undefined && args.media_type !== mediaType) {
    throw new Error(`media_type ${args.media_type} does not match ${mediaType} generation`)
  }
  const unsupportedFields = mediaType === "image" ? VIDEO_ONLY_FIELDS : IMAGE_ONLY_FIELDS
  const unsupportedField = unsupportedFields.find((field) => args[field] !== undefined)
  if (unsupportedField) throw new Error(`${unsupportedField} is not supported for ${mediaType} generation`)
  const prompt = required(args.prompt, "prompt")
  if (mediaType === "image") {
    validateChoice(args.size, "size", IMAGE_SIZES)
    validateChoice(args.output_format, "output_format", IMAGE_FORMATS)
    validateChoice(args.thinking, "thinking", THINKING_MODES)
    validateChoice(args.prompt_optimization_mode, "prompt_optimization_mode", PROMPT_MODES)
    const body = {
      model: ATLAS_IMAGE_MODEL,
      prompt,
    }
    for (const field of ["size", "output_format", "thinking", "prompt_optimization_mode"]) {
      if (args[field] !== undefined) body[field] = args[field]
    }
    return { body, inputAssetIds: [] }
  }

  const imageAssetIDs = assetIDs(args.reference_image_asset_ids, "reference_image_asset_ids", 9)
  const videoAssetIDs = assetIDs(args.reference_video_asset_ids, "reference_video_asset_ids", 3)
  if (!Number.isInteger(args.duration_seconds) || !VIDEO_DURATIONS.has(args.duration_seconds)) {
    throw new Error("duration_seconds must be an integer from 4 through 15 for Seedance reference-to-video")
  }
  validateChoice(args.resolution, "resolution", VIDEO_RESOLUTIONS)
  validateChoice(args.ratio, "ratio", VIDEO_RATIOS)
  const body = {
    model: ATLAS_VIDEO_MODEL,
    prompt,
    reference_images: imageAssetIDs.length
      ? await Promise.all(imageAssetIDs.map((assetID) => resolveReferenceURL(assetID)))
      : undefined,
    reference_videos: videoAssetIDs.length
      ? await Promise.all(videoAssetIDs.map((assetID) => resolveReferenceURL(assetID)))
      : undefined,
    duration: args.duration_seconds,
  }
  for (const field of ["resolution", "ratio"]) {
    if (args[field] !== undefined) body[field] = args[field]
  }
  for (const key of ["reference_images", "reference_videos"]) {
    if (body[key] === undefined) delete body[key]
  }
  return { body, inputAssetIds: [...imageAssetIDs, ...videoAssetIDs] }
}

function isWithin(root, target) {
  const relativePath = relative(root, target)
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

function rejectUnsafeRelativePath(value, name) {
  const pathValue = required(value, name)
  if (isAbsolute(pathValue) || /^[A-Za-z]:[\\/]/.test(pathValue) || pathValue.startsWith("~")) {
    throw new Error(`${name} must be relative to the project workspace`)
  }
  if (pathValue.split(/[\\/]/).includes("..")) throw new Error(`${name} may not contain .. path traversal`)
  return pathValue
}

async function projectRoot(defaultDirectory, context) {
  const selected = context?.directory ?? defaultDirectory
  if (!selected) throw new Error("media runtime requires a project workspace directory")
  try {
    return await realpath(selected)
  } catch {
    return resolve(selected)
  }
}

async function resolveExistingUnderRoot(root, requested, name) {
  const relativePath = rejectUnsafeRelativePath(requested, name)
  const candidate = resolve(root, relativePath)
  let resolvedPath
  try {
    resolvedPath = await realpath(candidate)
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${name} does not exist inside the project workspace`)
    throw error
  }
  if (!isWithin(root, resolvedPath)) throw new Error(`${name} resolves outside the project workspace`)
  const information = await stat(resolvedPath)
  if (!information.isFile()) throw new Error(`${name} must identify a file`)
  return resolvedPath
}

async function resolveManifestPath(root, requested) {
  if (requested === undefined) return null
  return resolveExistingUnderRoot(root, requested, "manifest_path")
}

function requireManifestArgument(args, operation) {
  if (typeof args?.manifest_path !== "string" || !args.manifest_path.trim()) {
    throw new Error(`manifest_path is required for ${operation}`)
  }
}

async function resolveKnownManifestPath(root, requested) {
  const candidate = resolve(requested)
  let resolvedPath
  try {
    resolvedPath = await realpath(candidate)
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("manifest_path does not exist inside the project workspace")
    throw error
  }
  if (!isWithin(root, resolvedPath)) throw new Error("manifest_path resolves outside the project workspace")
  const information = await stat(resolvedPath)
  if (!information.isFile()) throw new Error("manifest_path must identify a file")
  return resolvedPath
}

async function readManifest(manifestPath) {
  const manifest = await readJson(manifestPath)
  if (!manifest) throw new Error(`ProductionManifest not found at ${manifestPath}`)
  validateProductionManifest(manifest)
  return manifest
}

function nowISO(now) {
  const value = typeof now === "function" ? now() : now ?? Date.now()
  return new Date(value).toISOString()
}

function findManifestJob(manifest, jobID) {
  return manifest.generation_jobs.find((job) => job.job_id === jobID) ?? null
}

function sumNullable(values) {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value))
  return numbers.length ? numbers.reduce((total, value) => total + value, 0) : null
}

function refreshManifestCosts(manifest) {
  manifest.costs.estimated_usd = sumNullable(manifest.generation_jobs.map((job) => job.estimated_usd))
  manifest.costs.approved_usd = sumNullable(manifest.generation_jobs.map((job) => job.approved_usd))
  const actuals = manifest.generation_jobs.map((job) => job.actual_usd)
  manifest.costs.actual_usd = actuals.length && actuals.every((value) => typeof value === "number" && Number.isFinite(value))
    ? actuals.reduce((total, value) => total + value, 0)
    : null
}

async function persistManifestState(manifestPath, record, { assets = [], now } = {}) {
  if (!manifestPath) return
  const manifest = await readManifest(manifestPath)
  const existingIndex = manifest.generation_jobs.findIndex((job) => job.job_id === record.job_id)
  if (existingIndex === -1) manifest.generation_jobs.push(structuredClone(record))
  else manifest.generation_jobs[existingIndex] = { ...manifest.generation_jobs[existingIndex], ...structuredClone(record) }
  for (const asset of assets) {
    const assetIndex = manifest.assets.findIndex((candidate) => candidate.asset_id === asset.asset_id)
    if (assetIndex === -1) manifest.assets.push(structuredClone(asset))
    else manifest.assets[assetIndex] = { ...manifest.assets[assetIndex], ...structuredClone(asset) }
  }
  refreshManifestCosts(manifest)
  manifest.updated_at = nowISO(now)
  validateProductionManifest(manifest)
  await writeJson(manifestPath, manifest)
}

function outputExtension(mediaType, providerURL, contentType) {
  const normalizedContentType = String(contentType ?? "").split(";", 1)[0].trim().toLowerCase()
  if (MIME_EXTENSIONS[normalizedContentType]) return MIME_EXTENSIONS[normalizedContentType]
  try {
    const candidate = extname(new URL(providerURL).pathname).toLowerCase()
    if (/^\.[a-z0-9]{1,8}$/.test(candidate)) return candidate
  } catch {
    // The Atlas client already validates the URL; use the media fallback here.
  }
  return mediaType === "image" ? ".png" : ".mp4"
}

function sanitizeFilename(value) {
  const sanitized = String(value ?? "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return sanitized || "generated-output"
}

async function chooseOutputPath(directory, baseName, extension) {
  const safeBase = sanitizeFilename(baseName)
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`
    const candidate = resolve(directory, `${safeBase}${suffix}${extension}`)
    try {
      await stat(candidate)
    } catch (error) {
      if (error?.code === "ENOENT") return candidate
      throw error
    }
  }
  throw new Error("could not allocate a unique generated output filename")
}

async function writeAtomically(path, bytes) {
  const parent = dirname(path)
  await mkdir(parent, { recursive: true })
  const temporary = resolve(parent, `.${basename(path)}.${randomUUID()}.tmp`)
  await writeFile(temporary, bytes, { flag: "wx" })
  await rename(temporary, path)
}

export function isMediaRuntimeTool(name) {
  return MEDIA_RUNTIME_TOOL_SET.has(name)
}

export function createAtlasMediaRuntime({
  directory,
  client = createAtlasClient(),
  sleepImpl = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  now = () => Date.now(),
} = {}) {
  const jobs = new Map()
  const uploads = new Map()

  async function rootAndManifest(args, context, fallbackManifestPath = null) {
    const root = await projectRoot(directory, context)
    const hasRequestedManifest = args?.manifest_path !== undefined && args?.manifest_path !== null
    const requestedManifest = hasRequestedManifest ? args.manifest_path : fallbackManifestPath
    const manifestPath = requestedManifest === null || requestedManifest === undefined
      ? null
      : !hasRequestedManifest && fallbackManifestPath && isAbsolute(requestedManifest)
        ? await resolveKnownManifestPath(root, requestedManifest)
        : await resolveManifestPath(root, requestedManifest)
    return { root, manifestPath }
  }

  async function resolveReferenceURL(assetID, { manifestPath } = {}) {
    const uploaded = uploads.get(assetID)
    if (uploaded?.provider_url) return validateProviderURL(uploaded.provider_url, `reference asset ${assetID} provider_url`)
    if (!manifestPath) throw new Error(`reference asset ${assetID} has not been uploaded in this media runtime`)
    const manifest = await readManifest(manifestPath)
    const asset = manifest.assets.find((candidate) => candidate.asset_id === assetID)
    const uploadedURL = asset?.metadata?.atlascloud?.provider_url ?? asset?.metadata?.provider_url
    if (typeof uploadedURL !== "string" || !uploadedURL.trim()) {
      throw new Error(`reference asset ${assetID} has no Atlas upload URL; call media_upload first`)
    }
    return validateProviderURL(uploadedURL, `reference asset ${assetID} provider_url`)
  }

  async function calculate(args = {}, context) {
    requireManifestArgument(args, "media_calculate")
    const shotID = identifier(args.shot_id, "shot_id")
    const { root, manifestPath } = await rootAndManifest(args, context)
    const manifest = await readManifest(manifestPath)
    const { body, inputAssetIds } = await buildEffectiveAtlasRequest(
      args.media_type,
      args,
      (assetID) => resolveReferenceURL(assetID, { manifestPath }),
    )
    const digest = requestDigest(body)
    const cost = normalizeCost(await client.calculate(body))
    const reusable = manifest.generation_jobs.find((job) =>
      job.shot_id === shotID
      && job.media_type === args.media_type
      && job.request_digest === digest
      && ["calculated", "awaiting_approval"].includes(job.status))
    const jobID = reusable?.job_id ?? `job_${randomUUID()}`
    const record = {
      ...(reusable ?? {}),
      job_id: jobID,
      shot_id: shotID,
      media_type: args.media_type,
      model: body.model,
      request_digest: digest,
      status: "calculated",
      estimated_usd: cost.price_usd,
      origin_price_usd: cost.origin_price_usd,
      discount: cost.discount,
      estimated: cost.estimated,
      ...(cost.estimated_tokens === undefined ? {} : { estimated_tokens: cost.estimated_tokens }),
      input_asset_ids: inputAssetIds,
      approved_usd: null,
      actual_usd: reusable?.actual_usd ?? null,
      wait_timed_out: false,
      created_at: reusable?.created_at ?? nowISO(now),
      updated_at: nowISO(now),
      error: null,
      provider_error: null,
    }
    const local = {
      record,
      body,
      manifestPath,
      root,
    }
    jobs.set(jobID, local)
    await persistManifestState(manifestPath, record, { now })
    return {
      runtime: "atlas-cloud-v1",
      status: "calculated",
      job_id: jobID,
      shot_id: shotID,
      media_type: args.media_type,
      model: body.model,
      request_digest: digest,
      price_usd: cost.price_usd,
      origin_price_usd: cost.origin_price_usd,
      discount: cost.discount,
      estimated: cost.estimated,
      ...(cost.estimated_tokens === undefined ? {} : { estimated_tokens: cost.estimated_tokens }),
    }
  }

  async function upload(args = {}, context) {
    requireManifestArgument(args, "media upload")
    const assetID = identifier(args.asset_id, "asset_id")
    const { root, manifestPath } = await rootAndManifest(args, context)
    const manifest = await readManifest(manifestPath)
    const manifestAsset = manifest.assets.find((asset) => asset.asset_id === assetID)
    if (!manifestAsset) throw new Error(`ProductionManifest has no asset ${assetID}`)
    if (typeof manifestAsset.path !== "string" || !manifestAsset.path.trim()) {
      throw new Error(`ProductionManifest asset ${assetID} has no local path`)
    }
    const manifestAssetPath = await resolveExistingUnderRoot(root, manifestAsset.path, "ProductionManifest asset path")
    if (args.path !== undefined) {
      const providedPath = await resolveExistingUnderRoot(root, args.path, "path")
      if (providedPath !== manifestAssetPath) {
        throw new Error("Provided upload path does not match ProductionManifest asset path")
      }
    }
    const localPath = manifestAssetPath
    const extension = extname(localPath).toLowerCase()
    const inferredType = IMAGE_EXTENSIONS.has(extension) ? "image" : VIDEO_EXTENSIONS.has(extension) ? "video" : null
    if (!inferredType) throw new Error("path must identify a supported image or video file")
    if (args.media_type !== undefined && args.media_type !== inferredType) {
      throw new Error(`path does not match requested media_type ${args.media_type}`)
    }
    const bytes = await readFile(localPath)
    const information = await stat(localPath)
    const contentType = MIME_BY_EXTENSION[extension] ?? "application/octet-stream"
    const formData = new FormData()
    formData.append("file", new Blob([bytes], { type: contentType }), basename(localPath))
    const response = unwrapData(await client.uploadMedia(formData))
    const providerURL = response?.url ?? response?.provider_url
    if (typeof providerURL !== "string" || !providerURL.trim()) {
      throw new Error("Atlas upload returned a malformed response: missing temporary URL")
    }
    const validatedProviderURL = validateProviderURL(providerURL, "Atlas upload temporary URL")
    const result = {
      runtime: "atlas-cloud-v1",
      status: "uploaded",
      asset_id: assetID,
      provider_url: validatedProviderURL,
      original_filename: basename(localPath),
      content_type: contentType,
      size_bytes: information.size,
    }
    const uploadRecord = {
      provider_url: result.provider_url,
      original_filename: result.original_filename,
      content_type: result.content_type,
      size_bytes: result.size_bytes,
    }
    if (manifestPath) {
      manifestAsset.metadata = {
        ...(manifestAsset.metadata ?? {}),
        atlascloud: {
          ...(manifestAsset.metadata?.atlascloud ?? {}),
          ...uploadRecord,
          uploaded_at: nowISO(now),
        },
      }
      manifest.updated_at = nowISO(now)
      validateProductionManifest(manifest)
      await writeJson(manifestPath, manifest)
    }
    uploads.set(assetID, uploadRecord)
    return result
  }

  async function resolveJob(args, context) {
    const jobID = identifier(args.job_id, "job_id")
    const local = jobs.get(jobID)
    const { root, manifestPath } = await rootAndManifest(args, context, local?.manifestPath ?? null)
    const manifest = manifestPath ? await readManifest(manifestPath) : null
    const record = manifest ? findManifestJob(manifest, jobID) : local?.record
    if (!record) throw new Error(`Unknown Atlas media generation job: ${jobID}`)
    if (!record.provider_prediction_id) throw new Error(`Atlas media job ${jobID} has not been submitted`)
    const state = local ?? { record, body: null, manifestPath, root }
    state.record = record
    state.manifestPath = manifestPath
    state.root = root
    jobs.set(jobID, state)
    return { jobID, state, manifestPath, root, manifest }
  }

  async function generate(mediaType, args = {}, context) {
    requireManifestArgument(args, `media_generate_${mediaType}`)
    const jobID = identifier(args.job_id, "job_id")
    const local = jobs.get(jobID)
    const { root, manifestPath } = await rootAndManifest(args, context, local?.manifestPath ?? null)
    const manifest = await readManifest(manifestPath)
    const existing = findManifestJob(manifest, jobID)
    if (!existing) throw new Error(`Unknown Atlas media generation job: ${jobID}; call media_calculate first`)
    if (existing.media_type !== mediaType) throw new Error(`Atlas media job ${jobID} is for ${existing.media_type}, not ${mediaType}`)
    if (!["calculated", "awaiting_approval"].includes(existing.status)) {
      throw new Error(`Atlas media job ${jobID} is ${existing.status} and cannot be submitted again`)
    }

    const { body, inputAssetIds } = await buildEffectiveAtlasRequest(
      mediaType,
      args,
      (assetID) => resolveReferenceURL(assetID, { manifestPath }),
    )
    const digest = requestDigest(body)
    const approvedDigest = required(args.approved_request_digest, "approved_request_digest")
    if (digest !== approvedDigest || digest !== existing.request_digest) {
      throw new Error("Atlas generation approval rejected: request_digest does not match the approved request")
    }
    const approvedMax = nonNegative(args.approved_max_usd, "approved_max_usd")
    const approvedPrice = args.approved_price_usd === undefined
      ? null
      : nonNegative(args.approved_price_usd, "approved_price_usd")
    const cost = normalizeCost(await client.calculate(body))
    if (cost.price_usd > approvedMax) {
      throw new Error(`Atlas generation approval rejected: current preflight price ${cost.price_usd} exceeds approved_max_usd ${approvedMax}`)
    }

    const record = {
      ...existing,
      media_type: mediaType,
      model: body.model,
      request_digest: digest,
      input_asset_ids: inputAssetIds,
      status: "submitted",
      estimated_usd: cost.price_usd,
      origin_price_usd: cost.origin_price_usd,
      discount: cost.discount,
      estimated: cost.estimated,
      ...(cost.estimated_tokens === undefined ? {} : { estimated_tokens: cost.estimated_tokens }),
      approved_usd: approvedMax,
      approved_price_usd: approvedPrice,
      actual_usd: null,
      wait_timed_out: false,
      updated_at: nowISO(now),
      error: null,
      provider_error: null,
    }
    const state = local ?? { record, body, manifestPath, root }
    state.record = record
    state.body = body
    state.manifestPath = manifestPath
    state.root = root
    jobs.set(jobID, state)
    await persistManifestState(manifestPath, record, { now })

    let submission
    try {
      submission = normalizeSubmission(await (mediaType === "image"
        ? client.generateImage(body)
        : client.generateVideo(body)))
    } catch (error) {
      const uncertain = {
        ...record,
        status: "submitted",
        error: "Atlas submission outcome is unknown; automatic retry is disabled",
        provider_error: error instanceof Error ? safeProviderText(error.message) : "Atlas submission outcome is unknown",
        updated_at: nowISO(now),
      }
      state.record = uncertain
      await persistManifestState(manifestPath, uncertain, { now })
      throw error
    }

    const submitted = {
      ...record,
      provider_prediction_id: submission.prediction_id,
      status: "submitted",
      provider_status: submission.provider_status,
      submitted_at: nowISO(now),
      updated_at: nowISO(now),
      error: null,
      provider_error: null,
    }
    state.record = submitted
    await persistManifestState(manifestPath, submitted, { now })
    return {
      runtime: "atlas-cloud-v1",
      status: "submitted",
      job_id: jobID,
      shot_id: submitted.shot_id,
      media_type: mediaType,
      model: body.model,
      request_digest: digest,
      prediction_id: submission.prediction_id,
      provider_prediction_id: submission.prediction_id,
      estimated_usd: cost.price_usd,
      approved_usd: approvedMax,
      estimated: cost.estimated,
    }
  }

  async function materialize(state, job, prediction, { root, manifestPath, manifest } = {}) {
    if (prediction.status !== "completed") return []
    if (!prediction.outputs.length) throw new Error(`Atlas prediction ${prediction.prediction_id} completed without outputs`)
    if (state.materializedAssets?.length) return state.materializedAssets
    const existingIDs = job.output_asset_ids ?? []
    if (existingIDs.length && manifest) {
      const existingAssets = existingIDs
        .map((assetID) => manifest.assets.find((asset) => asset.asset_id === assetID))
        .filter(Boolean)
      if (existingAssets.length === existingIDs.length && existingAssets.every((asset) => typeof asset.path === "string")) {
        return existingAssets
      }
    }

    const outputDirectory = resolve(root, "production", "assets", "generated")
    await mkdir(outputDirectory, { recursive: true })
    const resolvedOutputDirectory = await realpath(outputDirectory)
    if (!isWithin(root, resolvedOutputDirectory) || !isWithin(root, outputDirectory)) {
      throw new Error("generated output directory resolves outside the project workspace")
    }
    const assets = []
    for (const [index, outputURL] of prediction.outputs.entries()) {
      const providerURL = validateProviderURL(outputURL, "Atlas prediction output URL")
      const downloaded = await client.download(providerURL)
      const extension = outputExtension(job.media_type, providerURL, downloaded.contentType)
      const destination = await chooseOutputPath(outputDirectory, `${job.job_id}-${index + 1}`, extension)
      if (!isWithin(root, destination)) throw new Error("generated output path resolves outside the project workspace")
      await writeAtomically(destination, downloaded.bytes)
      assets.push({
        asset_id: `generated_${sanitizeFilename(job.job_id)}_${index + 1}`.slice(0, 128),
        kind: job.media_type,
        status: "ready",
        path: relative(root, destination).split(sep).join("/"),
        shot_ids: [job.shot_id],
        metadata: {
          source: "atlascloud",
          provider_url: providerURL,
          provider_prediction_id: prediction.prediction_id,
          content_type: downloaded.contentType,
          size_bytes: downloaded.sizeBytes,
        },
      })
    }
    state.materializedAssets = assets
    return assets
  }

  async function prediction(args = {}, context) {
    const resolved = await resolveJob(args, context)
    const { jobID, state, manifestPath, root, manifest } = resolved
    const result = normalizePrediction(
      await client.prediction(state.record.provider_prediction_id),
      state.record.provider_prediction_id,
    )
    const next = {
      ...state.record,
      status: result.status,
      provider_status: result.provider_status,
      wait_timed_out: false,
      updated_at: nowISO(now),
      ...(result.error ? { error: result.error, provider_error: result.error } : { error: null, provider_error: null }),
      ...(result.actual_usd === undefined ? {} : { actual_usd: result.actual_usd }),
    }
    const assets = await materialize(state, next, result, { root, manifestPath, manifest })
    if (assets.length) {
      next.output_asset_ids = assets.map((asset) => asset.asset_id)
      next.completed_at = nowISO(now)
    }
    state.record = next
    await persistManifestState(manifestPath, next, { assets, now })
    return {
      runtime: "atlas-cloud-v1",
      job_id: jobID,
      prediction_id: result.prediction_id,
      status: result.status,
      provider_status: result.provider_status,
      ...(result.error ? { error: result.error } : {}),
      ...(assets.length ? {
        output_asset_ids: assets.map((asset) => asset.asset_id),
        output_paths: assets.map((asset) => asset.path),
      } : {}),
    }
  }

  async function waitPrediction(args = {}, context) {
    const jobID = identifier(args.job_id, "job_id")
    const local = jobs.get(jobID)
    let mediaType = local?.record?.media_type
    if (!mediaType && args.manifest_path !== undefined) {
      const { root, manifestPath } = await rootAndManifest(args, context)
      const manifest = await readManifest(manifestPath)
      mediaType = findManifestJob(manifest, jobID)?.media_type
      if (mediaType) {
        jobs.set(jobID, {
          ...(local ?? { record: findManifestJob(manifest, jobID), body: null }),
          manifestPath,
          root,
        })
      }
    }
    const defaultInterval = mediaType === "image" ? 2_000 : 5_000
    const defaultTimeout = mediaType === "image" ? 60_000 : 300_000
    const interval = args.interval_ms === undefined ? defaultInterval : args.interval_ms
    const timeout = args.timeout_ms === undefined ? defaultTimeout : args.timeout_ms
    if (!Number.isInteger(interval) || interval < 250 || interval > 30_000) throw new Error("interval_ms must be an integer between 250 and 30000")
    if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 900_000) throw new Error("timeout_ms must be an integer between 1000 and 900000")
    const started = Number(typeof now === "function" ? now() : Date.now())
    let latest
    for (;;) {
      latest = await prediction({ ...args, job_id: jobID }, context)
      if (["completed", "failed", "timeout"].includes(latest.status)) return latest
      const elapsed = Number(typeof now === "function" ? now() : Date.now()) - started
      if (elapsed >= timeout) {
        const state = jobs.get(jobID)
        if (state) {
          state.record = {
            ...state.record,
            status: "processing",
            wait_timed_out: true,
            updated_at: nowISO(now),
          }
          await persistManifestState(state.manifestPath, state.record, { now })
        }
        return {
          ...latest,
          status: "processing",
          wait_timed_out: true,
          cancellation_requested: false,
        }
      }
      await sleepImpl(Math.min(interval, Math.max(0, timeout - elapsed)))
    }
  }

  return {
    media_calculate: calculate,
    media_upload: upload,
    media_generate_image: (args, context) => generate("image", args, context),
    media_generate_video: (args, context) => generate("video", args, context),
    media_prediction: prediction,
    media_wait_prediction: waitPrediction,
  }
}

export function createMockMediaRuntime() {
  const jobs = new Map()

  function calculate({ shot_id, media_type, duration_seconds, request_digest } = {}) {
    const shot = required(shot_id, "shot_id")
    if (!["image", "video"].includes(media_type)) throw new Error("media_type must be image or video")
    const duration = duration_seconds === undefined ? undefined : Number(duration_seconds)
    if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0 || duration > 3_600)) {
      throw new Error("duration_seconds must be a positive number no greater than 3600")
    }
    const digestValue = request_digest === undefined
      ? shortDigest({ shot_id: shot, media_type, duration_seconds: duration ?? null })
      : required(request_digest, "request_digest")
    return {
      runtime: "mock-media-v1",
      status: "calculated",
      shot_id: shot,
      media_type,
      duration_seconds: duration ?? null,
      request_digest: digestValue,
      estimated_usd: 0,
      approved_usd: null,
    }
  }

  function upload({ asset_id, filename } = {}) {
    const asset = required(asset_id, "asset_id")
    const name = required(filename, "filename")
    return {
      runtime: "mock-media-v1",
      status: "stubbed",
      asset_id: asset,
      filename: name,
      upload_id: `mock-upload-${shortDigest({ asset_id: asset, filename: name })}`,
    }
  }

  function generate(operation, { shot_id, request_digest, duration_seconds } = {}) {
    const shot = required(shot_id, "shot_id")
    const request = required(request_digest, "request_digest")
    const duration = operation === "video" ? Number(duration_seconds) : undefined
    if (operation === "video" && (!Number.isFinite(duration) || duration <= 0 || duration > 3_600)) {
      throw new Error("duration_seconds is required for video generation")
    }
    const id = `mock-job-${shortDigest({ operation, shot_id: shot, request_digest: request, duration_seconds: duration ?? null })}`
    jobs.set(id, { status: "completed", shot_id: shot, operation })
    return {
      runtime: "mock-media-v1",
      status: "completed",
      job_id: id,
      shot_id: shot,
      media_type: operation,
      request_digest: request,
      output: {
        asset_id: `mock-asset-${shortDigest({ id, operation })}`,
        kind: operation,
      },
    }
  }

  function prediction({ job_id } = {}) {
    const id = required(job_id, "job_id")
    const job = jobs.get(id)
    if (!job) throw new Error(`Unknown media generation job: ${id}`)
    return {
      runtime: "mock-media-v1",
      job_id: id,
      status: job.status,
      output: { shot_id: job.shot_id, media_type: job.operation },
    }
  }

  function waitPrediction({ job_id } = {}) {
    return prediction({ job_id: required(job_id, "job_id") })
  }

  return {
    media_calculate: calculate,
    media_upload: upload,
    media_generate_image: (args) => generate("image", args),
    media_generate_video: (args) => generate("video", args),
    media_prediction: prediction,
    media_wait_prediction: waitPrediction,
  }
}
