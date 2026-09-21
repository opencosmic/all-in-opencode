export const ATLAS_IMAGE_MODEL = "bytedance/seedream-v5.0-pro/text-to-image"
export const ATLAS_GPT_IMAGE_MODEL = "openai/gpt-image-2/text-to-image"
export const ATLAS_VIDEO_MODEL = "bytedance/seedance-2.0-fast/reference-to-video"
export const ATLAS_WAN_REFERENCE_VIDEO_MODEL = "alibaba/wan-3.0/reference-to-video"
export const ATLAS_WAN_MODEL = ATLAS_WAN_REFERENCE_VIDEO_MODEL

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
const GPT_IMAGE_SIZE_MAPPINGS = new Map([
  ["2048*2048", "2048x2048"],
  ["1024*1024", "1024x1024"],
  ["2048*1152", "2048x1152"],
  ["1152*2048", "1152x2048"],
])
const THINKING_MODES = new Set(["enabled", "disabled"])
const PROMPT_MODES = new Set(["standard", "fast"])
const SEEDANCE_DURATIONS = new Set(Array.from({ length: 12 }, (_, index) => index + 4))
const SEEDANCE_RESOLUTIONS = new Set(["480p", "720p", "720p-SR", "1080p-SR", "1440p-SR"])
const SEEDANCE_RATIOS = new Set(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"])
const WAN_RESOLUTIONS = new Set(["480p", "720p", "1080p", "720p-esr", "1080p-esr", "1440p-esr", "4k-esr"])
const WAN_RATIOS = new Set(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"])
const WAN_REFERENCE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/bmp",
  "image/webp",
  "video/mp4",
  "video/quicktime",
])

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
const UNSUPPORTED_PROVIDER_FIELDS = Object.freeze([
  "audio",
  "enable_thinking",
  "file",
  "link",
  "seed",
  "refers",
  "reference_images",
  "reference_videos",
  "first_frame",
  "last_frame",
  "duration",
  "quality",
  "moderation",
  "enable_base64_output",
  "enable_sync_mode",
  "negative_prompt",
  "style",
  "color_hints",
])

const MODEL_SPECS = new Map([
  [ATLAS_IMAGE_MODEL, Object.freeze({
    model: ATLAS_IMAGE_MODEL,
    mediaType: "image",
    kind: "image",
  })],
  [ATLAS_GPT_IMAGE_MODEL, Object.freeze({
    model: ATLAS_GPT_IMAGE_MODEL,
    mediaType: "image",
    kind: "gpt-image-2",
  })],
  [ATLAS_VIDEO_MODEL, Object.freeze({
    model: ATLAS_VIDEO_MODEL,
    mediaType: "video",
    kind: "seedance",
    maxImages: 9,
    maxVideos: 3,
  })],
  [ATLAS_WAN_REFERENCE_VIDEO_MODEL, Object.freeze({
    model: ATLAS_WAN_REFERENCE_VIDEO_MODEL,
    mediaType: "video",
    kind: "wan-reference",
    maxImages: 20,
    maxVideos: 20,
    maxReferences: 20,
  })],
])

const CURRENT_MODEL_BY_MEDIA_TYPE = Object.freeze({
  image: ATLAS_IMAGE_MODEL,
  video: ATLAS_VIDEO_MODEL,
})

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  return value.trim()
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
    const assetID = required(entry, `${name}[${index}]`)
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(assetID)) {
      throw new Error(`${name}[${index}] must contain only letters, numbers, underscores, and hyphens`)
    }
    if (seen.has(assetID)) throw new Error(`${name} must not contain duplicate asset ID ${assetID}`)
    seen.add(assetID)
    return assetID
  })
}

function validateReferenceURL(value, name) {
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

function validateProviderFields(args) {
  const unsupportedField = UNSUPPORTED_PROVIDER_FIELDS.find((field) => args[field] !== undefined)
  if (unsupportedField) throw new Error(`${unsupportedField} is not supported by the AIO media-generation contract`)
}

function validateDuration(value, model, kind) {
  if (kind === "seedance") {
    if (!Number.isInteger(value) || !SEEDANCE_DURATIONS.has(value)) {
      throw new Error("duration_seconds must be an integer from 4 through 15 for Seedance reference-to-video")
    }
    return
  }
  if (value === undefined) return
  if (value !== -1 && (!Number.isInteger(value) || value < 2 || value > 30)) {
    throw new Error(`duration_seconds must be -1 or an integer from 2 through 30 for ${model}`)
  }
}

function validateWanReference(reference, assetID, expectedType) {
  const type = reference?.type ?? reference?.media_type
  if (type !== expectedType) {
    throw new Error(`reference asset ${assetID} must resolve to a ${expectedType} for Wan refers`)
  }
  const mimeType = reference?.mime_type ?? reference?.content_type
  if (mimeType !== undefined && !WAN_REFERENCE_MIME_TYPES.has(String(mimeType).split(";", 1)[0].trim().toLowerCase())) {
    throw new Error(`reference asset ${assetID} uses an unsupported Wan reference media format`)
  }
}

async function resolveReference(resolveReference, assetID, expectedType, kind) {
  if (typeof resolveReference !== "function") {
    throw new Error(`reference asset ${assetID} cannot be resolved without an upload resolver`)
  }
  const resolved = await resolveReference(assetID)
  const value = typeof resolved === "string" ? { url: resolved } : resolved
  const url = validateReferenceURL(value?.url ?? value?.provider_url, `reference asset ${assetID} provider_url`)
  if (kind === "wan-reference") {
    validateWanReference(value, assetID, expectedType)
    return { url, type: expectedType }
  }
  return url
}

export function resolveAtlasMediaModel(mediaType, requestedModel) {
  if (!["image", "video"].includes(mediaType)) throw new Error("media_type must be image or video")
  const model = requestedModel === undefined ? CURRENT_MODEL_BY_MEDIA_TYPE[mediaType] : required(requestedModel, "model")
  const spec = MODEL_SPECS.get(model)
  if (!spec) throw new Error(`unsupported Atlas media model: ${model}`)
  if (spec.mediaType !== mediaType) throw new Error(`${model} is not supported for ${mediaType} generation`)
  return spec
}

export async function buildAtlasMediaRequest(mediaType, args = {}, resolveReferenceOption) {
  if (!["image", "video"].includes(mediaType)) throw new Error("media_type must be image or video")
  if (args.media_type !== undefined && args.media_type !== mediaType) {
    throw new Error(`media_type ${args.media_type} does not match ${mediaType} generation`)
  }
  const unsupportedFields = mediaType === "image" ? VIDEO_ONLY_FIELDS : IMAGE_ONLY_FIELDS
  const unsupportedField = unsupportedFields.find((field) => args[field] !== undefined)
  if (unsupportedField) throw new Error(`${unsupportedField} is not supported for ${mediaType} generation`)
  validateProviderFields(args)

  const spec = resolveAtlasMediaModel(mediaType, args.model)
  const prompt = required(args.prompt, "prompt")
  if (spec.kind === "wan-reference" && prompt.length > 20_000) {
    throw new Error("prompt must be at most 20000 characters for Wan reference-to-video")
  }
  const resolveReferenceOptionFunction = typeof resolveReferenceOption === "function"
    ? resolveReferenceOption
    : resolveReferenceOption?.resolveReference

  if (spec.kind === "image") {
    validateChoice(args.size, "size", IMAGE_SIZES)
    validateChoice(args.output_format, "output_format", IMAGE_FORMATS)
    validateChoice(args.thinking, "thinking", THINKING_MODES)
    validateChoice(args.prompt_optimization_mode, "prompt_optimization_mode", PROMPT_MODES)
    const body = {
      model: spec.model,
      prompt,
    }
    for (const field of IMAGE_ONLY_FIELDS) {
      if (args[field] !== undefined) body[field] = args[field]
    }
    return { body, inputAssetIds: [] }
  }

  if (spec.kind === "gpt-image-2") {
    for (const field of ["thinking", "prompt_optimization_mode"]) {
      if (args[field] !== undefined) throw new Error(`${field} is not supported for GPT Image 2`)
    }
    const providerSize = args.size === undefined ? undefined : GPT_IMAGE_SIZE_MAPPINGS.get(args.size)
    if (args.size !== undefined && providerSize === undefined) {
      throw new Error(`size must map to a documented GPT Image 2 size: ${[...GPT_IMAGE_SIZE_MAPPINGS.keys()].join(", ")}`)
    }
    validateChoice(args.output_format, "output_format", IMAGE_FORMATS)
    const body = {
      model: spec.model,
      prompt,
      ...(providerSize === undefined ? {} : { size: providerSize }),
      ...(args.output_format === undefined ? {} : { output_format: args.output_format }),
    }
    return { body, inputAssetIds: [] }
  }

  const imageAssetIDs = assetIDs(args.reference_image_asset_ids, "reference_image_asset_ids", spec.maxImages)
  const videoAssetIDs = assetIDs(args.reference_video_asset_ids, "reference_video_asset_ids", spec.maxVideos)
  if (spec.maxReferences !== undefined && imageAssetIDs.length + videoAssetIDs.length > spec.maxReferences) {
    throw new Error(`references must contain at most ${spec.maxReferences} asset IDs for ${spec.model}`)
  }
  validateDuration(args.duration_seconds, spec.model, spec.kind)

  if (spec.kind === "seedance") {
    validateChoice(args.resolution, "resolution", SEEDANCE_RESOLUTIONS)
    validateChoice(args.ratio, "ratio", SEEDANCE_RATIOS)
    const body = {
      model: spec.model,
      prompt,
      reference_images: imageAssetIDs.length
        ? await Promise.all(imageAssetIDs.map((assetID) => resolveReference(resolveReferenceOptionFunction, assetID, "image", spec.kind)))
        : undefined,
      reference_videos: videoAssetIDs.length
        ? await Promise.all(videoAssetIDs.map((assetID) => resolveReference(resolveReferenceOptionFunction, assetID, "video", spec.kind)))
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

  validateChoice(args.resolution, "resolution", WAN_RESOLUTIONS)
  validateChoice(args.ratio, "ratio", WAN_RATIOS)
  const references = [
    ...await Promise.all(imageAssetIDs.map((assetID) => resolveReference(resolveReferenceOptionFunction, assetID, "image", spec.kind))),
    ...await Promise.all(videoAssetIDs.map((assetID) => resolveReference(resolveReferenceOptionFunction, assetID, "video", spec.kind))),
  ]
  const body = {
    model: spec.model,
    prompt,
    ...(references.length ? { refers: references } : {}),
  }
  for (const field of ["resolution", "duration_seconds", "ratio"]) {
    if (args[field] !== undefined) body[field === "duration_seconds" ? "duration" : field] = args[field]
  }
  return { body, inputAssetIds: [...imageAssetIDs, ...videoAssetIDs] }
}
