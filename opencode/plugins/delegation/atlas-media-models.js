import { extname } from "node:path"

export const ATLAS_IMAGE_MODEL = "bytedance/seedream-v5.0-pro/text-to-image"
export const ATLAS_GPT_IMAGE_MODEL = "openai/gpt-image-2/text-to-image"
export const ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL = "openai/gpt-image-2.5-sunburst/text-to-image"
export const ATLAS_WAN_REFERENCE_VIDEO_MODEL = "alibaba/wan-3.0/reference-to-video"
export const ATLAS_WAN_MODEL = ATLAS_WAN_REFERENCE_VIDEO_MODEL
export const ATLAS_MINIMAX_H3_MODEL = "minimax/h3/reference-to-video"
export const ATLAS_SEEDANCE_2_5_MODEL = "bytedance/seedance-2.5/reference-to-video"

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
  ["1024*1024", "1024x1024"],
  ["1024*768", "1024x768"],
  ["768*1024", "768x1024"],
  ["1024*1536", "1024x1536"],
  ["1536*1024", "1536x1024"],
  ["2048*2048", "2048x2048"],
  ["2048*1152", "2048x1152"],
  ["1152*2048", "1152x2048"],
  ["2560*1088", "2560x1088"],
  ["1088*2560", "1088x2560"],
])
const GPT_IMAGE_2_5_SUNBURST_SIZE_MAPPINGS = new Map([
  ["1024*1024", "1024x1024"],
  ["1024*768", "1024x768"],
  ["768*1024", "768x1024"],
  ["1024*1536", "1024x1536"],
  ["1536*1024", "1536x1024"],
  ["2048*2048", "2048x2048"],
  ["2048*1152", "2048x1152"],
  ["1152*2048", "1152x2048"],
  ["2560*1088", "2560x1088"],
  ["1088*2560", "1088x2560"],
])
const GPT_IMAGE_2_QUALITIES = new Set(["low", "medium", "high"])
const GPT_IMAGE_2_5_SUNBURST_QUALITIES = new Set(["auto", "low", "medium", "high", "xhigh", "max"])
const GPT_IMAGE_2_5_SUNBURST_BACKGROUNDS = new Set(["auto", "opaque", "transparent"])
const SEEDANCE_2_5_VIDEO_OUTPUT_FORMATS = new Set(["mp4", "mov"])
const THINKING_MODES = new Set(["enabled", "disabled"])
const PROMPT_MODES = new Set(["standard", "fast"])
const SEEDANCE_2_5_DURATIONS = new Set([-1, ...Array.from({ length: 27 }, (_, index) => index + 4)])
const SEEDANCE_2_5_RESOLUTIONS = new Set([
  "480p",
  "720p",
  "720p-sr",
  "720p-esr",
  "1080p",
  "1080p-sr",
  "1080p-esr",
  "1080p-esr & 60fps",
  "1440p-sr",
  "1440p-esr",
  "4k-esr",
])
const SEEDANCE_2_5_RATIOS = new Set(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"])
const WAN_RESOLUTIONS = new Set(["480p", "720p", "1080p", "720p-esr", "1080p-esr", "1440p-esr", "4k-esr"])
const WAN_RATIOS = new Set(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"])
const H3_RESOLUTION_MAPPINGS = new Map([
  ["768p", "768P"],
  ["2k", "2K"],
])
const H3_DURATIONS = new Set(Array.from({ length: 12 }, (_, index) => index + 4))
const H3_RATIOS = new Set(["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"])
const H3_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const H3_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime"])
const H3_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"])
const H3_VIDEO_EXTENSIONS = new Set([".mp4", ".mov"])
const AUDIO_REFERENCE_MIME_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"])
const AUDIO_REFERENCE_EXTENSIONS = new Set([".mp3", ".wav"])
const WAN_REFERENCE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/bmp",
  "image/webp",
  "video/mp4",
  "video/quicktime",
])
const SEEDANCE_2_5_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/gif",
  "image/heic",
  "image/heif",
])
const SEEDANCE_2_5_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime"])
const SEEDANCE_2_5_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif", ".heic", ".heif"])
const SEEDANCE_2_5_VIDEO_EXTENSIONS = new Set([".mp4", ".mov"])

const IMAGE_ONLY_FIELDS = Object.freeze([
  "size",
  "output_format",
  "thinking",
  "prompt_optimization_mode",
  "background",
])
const VIDEO_ONLY_FIELDS = Object.freeze([
  "reference_image_asset_ids",
  "reference_video_asset_ids",
  "reference_audio_asset_ids",
  "duration_seconds",
  "resolution",
  "ratio",
  "generate_audio",
  "seed",
  "prompt_expansion",
  "video_output_format",
])
const UNSUPPORTED_PROVIDER_FIELDS = Object.freeze([
  "audio",
  "enable_thinking",
  "file",
  "link",
  "mask",
  "n",
  "refers",
  "reference_images",
  "reference_videos",
  "first_frame",
  "last_frame",
  "duration",
  "moderation",
  "enable_base64_output",
  "enable_sync_mode",
  "negative_prompt",
  "style",
  "color_hints",
  "reference_audios",
  "omni_reference_task_type",
  "watermark",
  "return_last_frame",
  "editing",
  "edit",
  "extension",
  "extend",
  "video_editing",
  "video_extension",
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
  [ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL, Object.freeze({
    model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
    mediaType: "image",
    kind: "gpt-image-2.5-sunburst",
  })],
  [ATLAS_WAN_REFERENCE_VIDEO_MODEL, Object.freeze({
    model: ATLAS_WAN_REFERENCE_VIDEO_MODEL,
    mediaType: "video",
    kind: "wan-reference",
    maxImages: 20,
    maxVideos: 20,
    maxAudios: 5,
    maxReferences: 20,
  })],
  [ATLAS_MINIMAX_H3_MODEL, Object.freeze({
    model: ATLAS_MINIMAX_H3_MODEL,
    mediaType: "video",
    kind: "h3-reference",
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    maxReferences: 9,
  })],
  [ATLAS_SEEDANCE_2_5_MODEL, Object.freeze({
    model: ATLAS_SEEDANCE_2_5_MODEL,
    mediaType: "video",
    kind: "seedance-2.5-reference",
    maxImages: 30,
    maxVideos: 10,
    maxAudios: 10,
  })],
])

const CURRENT_MODEL_BY_MEDIA_TYPE = Object.freeze({
  image: ATLAS_GPT_IMAGE_MODEL,
  video: ATLAS_WAN_MODEL,
})

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

function validateChoice(value, name, choices) {
  if (value !== undefined && !choices.has(value)) throw new Error(`${name} must be one of: ${[...choices].join(", ")}`)
  return value
}

function validateBoolean(value, name) {
  if (value !== undefined && typeof value !== "boolean") throw new Error(`${name} must be a boolean`)
  return value
}

function validateInteger(value, name) {
  if (value !== undefined && !Number.isInteger(value)) throw new Error(`${name} must be an integer`)
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

function normalizedMimeType(value) {
  return String(value).split(";", 1)[0].trim().toLowerCase()
}

function validateAudioReference(reference, assetID, model, url, { maxBytes } = {}) {
  const mimeType = reference?.mime_type ?? reference?.content_type
  if (mimeType !== undefined) {
    if (!AUDIO_REFERENCE_MIME_TYPES.has(normalizedMimeType(mimeType))) {
      throw new Error(`reference asset ${assetID} uses an unsupported ${model} audio format`)
    }
  } else {
    let extension = ""
    try {
      extension = extname(new URL(url).pathname).toLowerCase()
    } catch {
      throw new Error(`reference asset ${assetID} must use a supported ${model} audio format`)
    }
    if (!AUDIO_REFERENCE_EXTENSIONS.has(extension)) {
      throw new Error(`reference asset ${assetID} uses an unsupported ${model} audio format`)
    }
  }
  if (maxBytes !== undefined && reference?.size_bytes !== undefined) {
    if (typeof reference.size_bytes !== "number" || !Number.isFinite(reference.size_bytes) || reference.size_bytes < 0) {
      throw new Error(`reference asset ${assetID} has invalid ${model} audio size metadata`)
    }
    if (reference.size_bytes > maxBytes) {
      throw new Error(`reference asset ${assetID} exceeds the ${model} audio size limit`)
    }
  }
}

function validateProviderFields(args) {
  const unsupportedField = UNSUPPORTED_PROVIDER_FIELDS.find((field) => args[field] !== undefined)
  if (unsupportedField) throw new Error(`${unsupportedField} is not supported by the AIO media-generation contract`)
}

function validateDuration(value, model, kind) {
  if (kind === "h3-reference") {
    if (!Number.isInteger(value) || !H3_DURATIONS.has(value)) {
      throw new Error("duration_seconds must be an integer from 4 through 15 for MiniMax H3 reference-to-video")
    }
    return
  }
  if (kind === "seedance-2.5-reference") {
    if (value !== undefined && !SEEDANCE_2_5_DURATIONS.has(value)) {
      throw new Error("duration_seconds must be -1 or an integer from 4 through 30 for Seedance 2.5 reference-to-video")
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
  if (expectedType === "audio") {
    validateAudioReference(reference, assetID, "Wan", reference?.url ?? reference?.provider_url)
    return
  }
  const mimeType = reference?.mime_type ?? reference?.content_type
  if (mimeType !== undefined && !WAN_REFERENCE_MIME_TYPES.has(String(mimeType).split(";", 1)[0].trim().toLowerCase())) {
    throw new Error(`reference asset ${assetID} uses an unsupported Wan reference media format`)
  }
}

function validateH3Reference(reference, assetID, expectedType, url) {
  const type = reference?.type ?? reference?.media_type
  if (type !== expectedType) {
    throw new Error(`reference asset ${assetID} must resolve to a ${expectedType} for MiniMax H3 refers`)
  }
  if (expectedType === "audio") {
    validateAudioReference(reference, assetID, "MiniMax H3", url)
    return
  }
  const mimeType = reference?.mime_type ?? reference?.content_type
  if (mimeType !== undefined) {
    const normalizedMimeType = String(mimeType).split(";", 1)[0].trim().toLowerCase()
    const supported = expectedType === "image" ? H3_IMAGE_MIME_TYPES : H3_VIDEO_MIME_TYPES
    if (!supported.has(normalizedMimeType)) {
      throw new Error(`reference asset ${assetID} uses an unsupported MiniMax H3 ${expectedType} format`)
    }
    return
  }
  let extension = ""
  try {
    extension = extname(new URL(url).pathname).toLowerCase()
  } catch {
    throw new Error(`reference asset ${assetID} must use a supported MiniMax H3 ${expectedType} format`)
  }
  const supportedExtensions = expectedType === "image" ? H3_IMAGE_EXTENSIONS : H3_VIDEO_EXTENSIONS
  if (!supportedExtensions.has(extension)) {
    throw new Error(`reference asset ${assetID} uses an unsupported MiniMax H3 ${expectedType} format`)
  }
}

function validateSeedance25Reference(reference, assetID, expectedType, url) {
  const type = reference?.type ?? reference?.media_type
  if (type !== expectedType) {
    throw new Error(`reference asset ${assetID} must resolve to a ${expectedType} for Seedance 2.5 reference-to-video`)
  }
  if (expectedType === "audio") {
    validateAudioReference(reference, assetID, "Seedance 2.5", url, { maxBytes: 15 * 1024 * 1024 })
    return
  }
  const mimeType = reference?.mime_type ?? reference?.content_type
  if (mimeType !== undefined) {
    const normalizedMimeType = String(mimeType).split(";", 1)[0].trim().toLowerCase()
    const supported = expectedType === "image" ? SEEDANCE_2_5_IMAGE_MIME_TYPES : SEEDANCE_2_5_VIDEO_MIME_TYPES
    if (!supported.has(normalizedMimeType)) {
      throw new Error(`reference asset ${assetID} uses an unsupported Seedance 2.5 ${expectedType} format`)
    }
    return
  }
  let extension = ""
  try {
    extension = extname(new URL(url).pathname).toLowerCase()
  } catch {
    throw new Error(`reference asset ${assetID} must use a supported Seedance 2.5 ${expectedType} format`)
  }
  const supportedExtensions = expectedType === "image" ? SEEDANCE_2_5_IMAGE_EXTENSIONS : SEEDANCE_2_5_VIDEO_EXTENSIONS
  if (!supportedExtensions.has(extension)) {
    throw new Error(`reference asset ${assetID} uses an unsupported Seedance 2.5 ${expectedType} format`)
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
  if (kind === "h3-reference") {
    validateH3Reference(value, assetID, expectedType, url)
    return { url, type: expectedType }
  }
  if (kind === "seedance-2.5-reference") {
    validateSeedance25Reference(value, assetID, expectedType, url)
    return url
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

export function listAtlasMediaModels(mediaType) {
  if (mediaType !== undefined && !["image", "video"].includes(mediaType)) {
    throw new Error("media_type must be image or video")
  }
  return Object.freeze([...MODEL_SPECS.values()].filter((spec) => mediaType === undefined || spec.mediaType === mediaType))
}

export async function buildAtlasMediaRequest(mediaType, args = {}, resolveReferenceOption) {
  if (!["image", "video"].includes(mediaType)) throw new Error("media_type must be image or video")
  if (args.media_type !== undefined && args.media_type !== mediaType) {
    throw new Error(`media_type ${args.media_type} does not match ${mediaType} generation`)
  }
  const unsupportedFields = mediaType === "image" ? VIDEO_ONLY_FIELDS : [...IMAGE_ONLY_FIELDS, "quality"]
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
    if (args.quality !== undefined) throw new Error("quality is not supported by the AIO media-generation contract")
    if (args.background !== undefined) throw new Error("background is not supported for Seedream 5.0 Pro")
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
    if (args.background !== undefined) throw new Error("background is not supported for GPT Image 2")
    const providerSize = args.size === undefined ? undefined : GPT_IMAGE_SIZE_MAPPINGS.get(args.size)
    if (args.size !== undefined && providerSize === undefined) {
      throw new Error(`size must map to a documented GPT Image 2 size: ${[...GPT_IMAGE_SIZE_MAPPINGS.keys()].join(", ")}`)
    }
    validateChoice(args.quality, "quality", GPT_IMAGE_2_QUALITIES)
    validateChoice(args.output_format, "output_format", IMAGE_FORMATS)
    const body = {
      model: spec.model,
      prompt,
      ...(providerSize === undefined ? {} : { size: providerSize }),
      ...(args.output_format === undefined ? {} : { output_format: args.output_format }),
      ...(args.quality === undefined ? {} : { quality: args.quality }),
    }
    return { body, inputAssetIds: [] }
  }

  if (spec.kind === "gpt-image-2.5-sunburst") {
    if (prompt.length > 32_000) {
      throw new Error("prompt must be at most 32000 characters for GPT Image 2.5 Sunburst")
    }
    for (const field of ["thinking", "prompt_optimization_mode"]) {
      if (args[field] !== undefined) throw new Error(`${field} is not supported for GPT Image 2.5 Sunburst`)
    }
    validateChoice(args.background, "background", GPT_IMAGE_2_5_SUNBURST_BACKGROUNDS)
    const providerSize = args.size === undefined ? undefined : GPT_IMAGE_2_5_SUNBURST_SIZE_MAPPINGS.get(args.size)
    if (args.size !== undefined && providerSize === undefined) {
      throw new Error(`size must map to a documented GPT Image 2.5 Sunburst size: ${[...GPT_IMAGE_2_5_SUNBURST_SIZE_MAPPINGS.keys()].join(", ")}`)
    }
    validateChoice(args.quality, "quality", GPT_IMAGE_2_5_SUNBURST_QUALITIES)
    validateChoice(args.output_format, "output_format", IMAGE_FORMATS)
    if (args.background === "transparent" && args.output_format !== undefined && args.output_format !== "png") {
      throw new Error("output_format must be png when background is transparent for GPT Image 2.5 Sunburst")
    }
    const body = {
      model: spec.model,
      prompt,
      ...(providerSize === undefined ? {} : { size: providerSize }),
      ...(args.output_format === undefined ? {} : { output_format: args.output_format }),
      ...(args.quality === undefined ? {} : { quality: args.quality }),
      ...(args.background === undefined ? {} : { background: args.background }),
    }
    return { body, inputAssetIds: [] }
  }

  const imageAssetIDs = assetIDs(args.reference_image_asset_ids, "reference_image_asset_ids", spec.maxImages)
  const videoAssetIDs = assetIDs(args.reference_video_asset_ids, "reference_video_asset_ids", spec.maxVideos)
  const audioAssetIDs = assetIDs(args.reference_audio_asset_ids, "reference_audio_asset_ids", spec.maxAudios)
  if (spec.maxReferences !== undefined && imageAssetIDs.length + videoAssetIDs.length + audioAssetIDs.length > spec.maxReferences) {
    throw new Error(spec.kind === "h3-reference"
      ? "MiniMax H3 supports at most 9 total references in the current AIO subset"
      : `references must contain at most ${spec.maxReferences} asset IDs for ${spec.model}`)
  }
  validateDuration(args.duration_seconds, spec.model, spec.kind)

  if (spec.kind === "seedance-2.5-reference") {
    if (args.seed !== undefined) throw new Error("seed is not supported for Seedance 2.5 reference-to-video")
    if (args.prompt_expansion !== undefined) throw new Error("prompt_expansion is not supported for Seedance 2.5 reference-to-video")
    validateBoolean(args.generate_audio, "generate_audio")
    validateChoice(args.video_output_format, "video_output_format", SEEDANCE_2_5_VIDEO_OUTPUT_FORMATS)
    if (!imageAssetIDs.length && !videoAssetIDs.length && !audioAssetIDs.length) {
      throw new Error("Seedance 2.5 reference-to-video requires at least one image, video, or audio reference")
    }
    validateChoice(args.resolution, "resolution", SEEDANCE_2_5_RESOLUTIONS)
    validateChoice(args.ratio, "ratio", SEEDANCE_2_5_RATIOS)
    const body = {
      model: spec.model,
      prompt,
      ...(imageAssetIDs.length
        ? { reference_images: await Promise.all(imageAssetIDs.map((assetID) => resolveReference(resolveReferenceOptionFunction, assetID, "image", spec.kind))) }
        : {}),
      ...(videoAssetIDs.length
        ? { reference_videos: await Promise.all(videoAssetIDs.map((assetID) => resolveReference(resolveReferenceOptionFunction, assetID, "video", spec.kind))) }
        : {}),
      ...(audioAssetIDs.length
        ? { reference_audios: await Promise.all(audioAssetIDs.map((assetID) => resolveReference(resolveReferenceOptionFunction, assetID, "audio", spec.kind))) }
        : {}),
      ...(args.duration_seconds === undefined ? {} : { duration: args.duration_seconds }),
      ...(args.resolution === undefined ? {} : { resolution: args.resolution }),
      ...(args.ratio === undefined ? {} : { ratio: args.ratio }),
      ...(args.generate_audio === undefined ? {} : { generate_audio: args.generate_audio }),
      ...(args.video_output_format === undefined ? {} : { output_format: args.video_output_format }),
      omni_reference_task_type: "reference",
    }
    return { body, inputAssetIds: [...imageAssetIDs, ...videoAssetIDs, ...audioAssetIDs] }
  }

  if (spec.kind === "h3-reference") {
    if (args.generate_audio !== undefined) throw new Error("generate_audio is not supported for MiniMax H3 reference-to-video")
    if (args.seed !== undefined) throw new Error("seed is not supported for MiniMax H3 reference-to-video")
    if (args.video_output_format !== undefined) throw new Error("video_output_format is not supported for MiniMax H3 reference-to-video")
    validateBoolean(args.prompt_expansion, "prompt_expansion")
    if (!imageAssetIDs.length && !videoAssetIDs.length) {
      throw new Error("MiniMax H3 reference-to-video requires at least one image or video reference")
    }
    const providerResolution = H3_RESOLUTION_MAPPINGS.get(args.resolution)
    if (providerResolution === undefined) {
      throw new Error(`resolution must be one of: ${[...H3_RESOLUTION_MAPPINGS.keys()].join(", ")} for MiniMax H3 reference-to-video`)
    }
    validateChoice(args.ratio, "ratio", H3_RATIOS)
    const references = [
      ...await Promise.all(imageAssetIDs.map((assetID) => resolveReference(resolveReferenceOptionFunction, assetID, "image", spec.kind))),
      ...await Promise.all(videoAssetIDs.map((assetID) => resolveReference(resolveReferenceOptionFunction, assetID, "video", spec.kind))),
      ...await Promise.all(audioAssetIDs.map((assetID) => resolveReference(resolveReferenceOptionFunction, assetID, "audio", spec.kind))),
    ]
    const body = {
      model: spec.model,
      prompt,
      refers: references,
      resolution: providerResolution,
      duration: args.duration_seconds,
      ...(args.ratio === undefined ? {} : { ratio: args.ratio }),
      ...(args.prompt_expansion === undefined ? {} : { prompt_expansion: args.prompt_expansion }),
    }
    return { body, inputAssetIds: [...imageAssetIDs, ...videoAssetIDs, ...audioAssetIDs] }
  }

  if (audioAssetIDs.length && !imageAssetIDs.length && !videoAssetIDs.length) {
    throw new Error("Wan reference-to-video requires at least one image or video reference when audio references are provided")
  }
  if (args.prompt_expansion !== undefined) throw new Error("prompt_expansion is not supported for Wan reference-to-video")
  if (args.video_output_format !== undefined) throw new Error("video_output_format is not supported for Wan reference-to-video")
  validateBoolean(args.generate_audio, "generate_audio")
  validateInteger(args.seed, "seed")
  validateChoice(args.resolution, "resolution", WAN_RESOLUTIONS)
  validateChoice(args.ratio, "ratio", WAN_RATIOS)
  const references = [
    ...await Promise.all(imageAssetIDs.map((assetID) => resolveReference(resolveReferenceOptionFunction, assetID, "image", spec.kind))),
    ...await Promise.all(videoAssetIDs.map((assetID) => resolveReference(resolveReferenceOptionFunction, assetID, "video", spec.kind))),
    ...await Promise.all(audioAssetIDs.map((assetID) => resolveReference(resolveReferenceOptionFunction, assetID, "audio", spec.kind))),
  ]
  const body = {
    model: spec.model,
    prompt,
    ...(references.length ? { refers: references } : {}),
  }
  for (const field of ["resolution", "duration_seconds", "ratio"]) {
    if (args[field] !== undefined) body[field === "duration_seconds" ? "duration" : field] = args[field]
  }
  if (args.generate_audio !== undefined) body.audio = args.generate_audio
  if (args.seed !== undefined) body.seed = args.seed
  return { body, inputAssetIds: [...imageAssetIDs, ...videoAssetIDs, ...audioAssetIDs] }
}
