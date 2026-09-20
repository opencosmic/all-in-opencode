import { createHash } from "node:crypto"

export const MEDIA_RUNTIME_TOOL_NAMES = Object.freeze([
  "media_calculate",
  "media_upload",
  "media_generate_image",
  "media_generate_video",
  "media_prediction",
  "media_wait_prediction",
])

const MEDIA_RUNTIME_TOOL_SET = new Set(MEDIA_RUNTIME_TOOL_NAMES)

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24)
}

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

function positiveDuration(value) {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 3_600) {
    throw new Error("duration_seconds must be a positive number no greater than 3600")
  }
  return value
}

function jobId(operation, args) {
  return `mock-job-${digest({ operation, ...args })}`
}

export function isMediaRuntimeTool(name) {
  return MEDIA_RUNTIME_TOOL_SET.has(name)
}

export function createMockMediaRuntime() {
  const jobs = new Map()

  function calculate({ shot_id, media_type, duration_seconds, request_digest } = {}) {
    const shot = required(shot_id, "shot_id")
    if (!["image", "video"].includes(media_type)) throw new Error("media_type must be image or video")
    const duration = positiveDuration(duration_seconds)
    const digestValue = request_digest === undefined
      ? digest({ shot_id: shot, media_type, duration_seconds: duration ?? null })
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
      upload_id: `mock-upload-${digest({ asset_id: asset, filename: name })}`,
    }
  }

  function generate(operation, { shot_id, request_digest, duration_seconds } = {}) {
    const shot = required(shot_id, "shot_id")
    const request = required(request_digest, "request_digest")
    const duration = operation === "video" ? positiveDuration(duration_seconds) : undefined
    if (operation === "video" && duration === undefined) throw new Error("duration_seconds is required for video generation")
    const id = jobId(operation, { shot_id: shot, request_digest: request, duration_seconds: duration ?? null })
    jobs.set(id, { status: "completed", shot_id: shot, operation })
    return {
      runtime: "mock-media-v1",
      status: "completed",
      job_id: id,
      shot_id: shot,
      media_type: operation,
      request_digest: request,
      output: {
        asset_id: `mock-asset-${digest({ id, operation })}`,
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
