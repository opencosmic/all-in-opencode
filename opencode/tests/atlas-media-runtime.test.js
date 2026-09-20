import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { createProductionManifest } from "../plugins/film-production/contracts.js"
import { createAtlasClient } from "../plugins/delegation/atlas-client.js"
import {
  ATLAS_IMAGE_MODEL,
  ATLAS_VIDEO_MODEL,
  canonicalJson,
  createAtlasMediaRuntime,
  requestDigest,
} from "../plugins/delegation/media-runtime.js"

const shot = {
  shot_id: "shot_01",
  purpose: "reference_subject",
  duration_seconds: 5,
  subject: { id: "speaker", action: "hold a stable hero pose" },
  camera: {
    movement: "slow_orbit",
    lens_mm: 50,
    framing_start: "medium",
    framing_end: "close",
  },
  environment: { id: "dark_studio" },
  references: { subject: ["speaker_front"] },
  output: { aspect_ratio: "16:9", fps: 24 },
}

const ROOT_MANIFEST_PATH = "production-manifest.json"

function jsonResponse(body, status = 200, headers = {}) {
  const text = JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => text,
    arrayBuffer: async () => Buffer.from(text),
  }
}

function outputResponse(bytes, contentType) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": contentType }),
    arrayBuffer: async () => Buffer.from(bytes),
  }
}

function fakeClient({
  costs = [],
  predictions = [],
  uploadURL = "https://atlas.example/uploads/reference.png",
  outputs = ["https://atlas.example/outputs/generated.png"],
  generateImageError = null,
  generateVideoError = null,
} = {}) {
  const calls = []
  let costIndex = 0
  let predictionIndex = 0
  return {
    calls,
    calculate: async (body) => {
      calls.push({ operation: "calculate", body: structuredClone(body) })
      const configured = costs[costIndex++]
      const price = configured?.price ?? (body.model === ATLAS_VIDEO_MODEL ? 0.24 : 0.045)
      return {
        data: {
          price,
          origin_price: configured?.origin_price ?? price,
          discount: configured?.discount ?? 100,
          estimated: configured?.estimated ?? body.model === ATLAS_VIDEO_MODEL,
          ...(configured?.estimated_tokens === undefined ? {} : { estimated_tokens: configured.estimated_tokens }),
        },
      }
    },
    uploadMedia: async (formData) => {
      calls.push({ operation: "uploadMedia", formData })
      return { url: uploadURL }
    },
    generateImage: async (body) => {
      calls.push({ operation: "generateImage", body: structuredClone(body) })
      if (generateImageError) throw generateImageError
      return { data: { id: "prediction-image-01", status: "processing" } }
    },
    generateVideo: async (body) => {
      calls.push({ operation: "generateVideo", body: structuredClone(body) })
      if (generateVideoError) throw generateVideoError
      return { data: { id: "prediction-video-01", status: "processing" } }
    },
    prediction: async (predictionID) => {
      calls.push({ operation: "prediction", predictionID })
      const configured = predictions[predictionIndex++] ?? { status: "processing", outputs: [] }
      return {
        data: {
          id: predictionID,
          ...configured,
        },
      }
    },
    download: async (url) => {
      calls.push({ operation: "download", url })
      const contentType = url.endsWith(".mp4") ? "video/mp4" : "image/png"
      return { bytes: Buffer.from(`materialized:${url}`), contentType, sizeBytes: url.length + 15 }
    },
  }
}

async function fixture({ manifestInProduction = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "aio-atlas-media-"))
  await mkdir(join(root, "references"), { recursive: true })
  await writeFile(join(root, "references", "speaker.png"), Buffer.from("png fixture"))
  await writeFile(join(root, "references", "previs.mp4"), Buffer.from("video fixture"))
  const manifest = createProductionManifest({
    project: "atlas-film",
    shots: [shot],
    assets: [{
      asset_id: "speaker_front",
      kind: "subject-reference",
      status: "ready",
      path: "references/speaker.png",
      shot_ids: ["shot_01"],
    }],
    generation_jobs: [],
  })
  const manifestPath = manifestInProduction
    ? join(root, "production", "production-manifest.json")
    : join(root, "production-manifest.json")
  const manifestRequestPath = manifestInProduction
    ? "production/production-manifest.json"
    : ROOT_MANIFEST_PATH
  if (manifestInProduction) await mkdir(join(root, "production"), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { root, manifestPath, manifestRequestPath }
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true })
}

test("Atlas client requires ATLASCLOUD_API_KEY before network activity", async () => {
  let requests = 0
  const client = createAtlasClient({ apiKey: "", fetchImpl: async () => { requests += 1 } })
  await assert.rejects(
    client.calculate({ model: ATLAS_IMAGE_MODEL, prompt: "test" }),
    /ATLASCLOUD_API_KEY is missing/,
  )
  assert.equal(requests, 0)
})

test("Atlas client adds bearer auth and normalizes secret-safe HTTP errors", async () => {
  const requests = []
  const client = createAtlasClient({
    apiKey: "atlas-test-secret",
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return jsonResponse({ error: { code: "bad_key", message: "atlas-test-secret was rejected" } }, 401)
    },
  })
  await assert.rejects(client.calculate({ model: ATLAS_IMAGE_MODEL, prompt: "test" }), (error) => {
    assert.match(error.message, /Atlas calculate failed \(HTTP 401\)/)
    assert.doesNotMatch(error.message, /atlas-test-secret/)
    assert.doesNotMatch(JSON.stringify(error), /atlas-test-secret/)
    return true
  })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].options.headers.Authorization, "Bearer atlas-test-secret")
  assert.equal(requests[0].options.headers["Content-Type"], "application/json")
})

test("Atlas client sends the exact calculate body and parses upload, generation, and prediction responses", async () => {
  const requests = []
  const responses = [
    jsonResponse({ data: { price: 0.045, origin_price: 0.05, discount: 90, estimated: false } }),
    jsonResponse({ url: "https://atlas.example/uploaded.png" }),
    jsonResponse({ data: { id: "prediction-01", status: "processing" } }),
    jsonResponse({ data: { id: "prediction-video-01", status: "processing" } }),
    jsonResponse({ data: { id: "prediction-01", status: "completed", outputs: ["https://atlas.example/out.png"] } }),
  ]
  const client = createAtlasClient({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return responses.shift()
    },
  })
  const body = { model: ATLAS_IMAGE_MODEL, prompt: "A dark speaker" }
  assert.deepEqual(await client.calculate(body), { data: { price: 0.045, origin_price: 0.05, discount: 90, estimated: false } })
  const form = new FormData()
  form.append("file", new Blob(["fixture"], { type: "image/png" }), "speaker.png")
  assert.deepEqual(await client.uploadMedia(form), { url: "https://atlas.example/uploaded.png" })
  assert.deepEqual(await client.generateImage(body), { data: { id: "prediction-01", status: "processing" } })
  assert.deepEqual(await client.generateVideo({ model: ATLAS_VIDEO_MODEL, prompt: "A slow reveal", duration: 4 }), {
    data: { id: "prediction-video-01", status: "processing" },
  })
  assert.deepEqual(await client.prediction("prediction-01"), { data: { id: "prediction-01", status: "completed", outputs: ["https://atlas.example/out.png"] } })
  assert.equal(requests[0].url, "https://api.atlascloud.ai/api/v1/model/calculate")
  assert.deepEqual(JSON.parse(requests[0].options.body), body)
  assert.equal(requests[1].url, "https://api.atlascloud.ai/api/v1/model/uploadMedia")
  assert.equal(requests[1].options.headers["Content-Type"], undefined)
  assert.equal(requests[2].url, "https://api.atlascloud.ai/api/v1/model/generateImage")
  assert.equal(requests[3].url, "https://api.atlascloud.ai/api/v1/model/generateVideo")
  assert.equal(requests[4].url, "https://api.atlascloud.ai/api/v1/model/prediction/prediction-01")
})

test("canonical request digests are stable and change for meaningful generation inputs", () => {
  const base = {
    model: ATLAS_VIDEO_MODEL,
    prompt: "Slow reveal",
    duration: 5,
    reference_images: ["https://atlas.example/a.png"],
  }
  assert.equal(requestDigest(base), requestDigest({
    reference_images: ["https://atlas.example/a.png"],
    duration: 5,
    prompt: "Slow reveal",
    model: ATLAS_VIDEO_MODEL,
  }))
  assert.equal(requestDigest({ api_key: "one", ...base }), requestDigest({ api_key: "two", ...base }))
  assert.notEqual(requestDigest(base), requestDigest({ ...base, prompt: "Fast reveal" }))
  assert.notEqual(requestDigest(base), requestDigest({ ...base, model: ATLAS_IMAGE_MODEL }))
  assert.notEqual(requestDigest(base), requestDigest({ ...base, duration: 6 }))
  assert.notEqual(requestDigest(base), requestDigest({ ...base, reference_images: ["https://atlas.example/b.png"] }))
  assert.equal(canonicalJson({ z: 1, a: [true, null] }), '{"a":[true,null],"z":1}')
})

test("media requests accept only fields for their selected modality", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient()
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const image = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A premium speaker",
      manifest_path: manifestRequestPath,
      size: "1024*1024",
      output_format: "png",
      thinking: "enabled",
      prompt_optimization_mode: "standard",
    })
    assert.match(image.request_digest, /^[a-f0-9]{64}$/)
    const imageRequest = client.calls.find((call) => call.operation === "calculate").body
    assert.equal(imageRequest.size, "1024*1024")
    assert.equal(imageRequest.output_format, "png")

    for (const [field, value] of [
      ["duration_seconds", 4],
      ["resolution", "720p"],
      ["ratio", "16:9"],
      ["reference_video_asset_ids", ["previs"]],
    ]) {
      await assert.rejects(
        runtime.media_calculate({ shot_id: "shot_01", media_type: "image", prompt: "A speaker", manifest_path: manifestRequestPath, [field]: value }),
        new RegExp(`${field} is not supported for image generation`),
      )
    }
    await assert.rejects(
      runtime.media_generate_image({
        job_id: image.job_id,
        shot_id: "shot_01",
        prompt: "A premium speaker",
        manifest_path: manifestRequestPath,
        duration_seconds: 4,
        approved_request_digest: image.request_digest,
        approved_max_usd: 1,
      }),
      /duration_seconds is not supported for image generation/,
    )

    await runtime.media_upload({ asset_id: "speaker_front", path: "references/speaker.png", manifest_path: manifestRequestPath })
    const videoArgs = {
      shot_id: "shot_01",
      media_type: "video",
      prompt: "The speaker rotates slowly",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      duration_seconds: 4,
      resolution: "720p",
      ratio: "16:9",
    }
    const video = await runtime.media_calculate(videoArgs)
    assert.match(video.request_digest, /^[a-f0-9]{64}$/)
    const videoRequest = client.calls.filter((call) => call.operation === "calculate").at(-1).body
    assert.equal(videoRequest.duration, 4)
    assert.equal(videoRequest.resolution, "720p")
    assert.equal(videoRequest.ratio, "16:9")

    for (const [field, value] of [
      ["size", "1024*1024"],
      ["output_format", "png"],
      ["thinking", "enabled"],
      ["prompt_optimization_mode", "standard"],
    ]) {
      await assert.rejects(
        runtime.media_calculate({ ...videoArgs, [field]: value }),
        new RegExp(`${field} is not supported for video generation`),
      )
    }
  } finally {
    await cleanup(root)
  }
})

test("media_calculate uses Atlas preflight, records the manifest job, and video references resolve through uploaded assets", async () => {
  const { root, manifestPath } = await fixture()
  try {
    const client = fakeClient({ costs: [{ price: 0.24, estimated: true, estimated_tokens: 12345 }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const uploaded = await runtime.media_upload({ asset_id: "speaker_front", manifest_path: "production-manifest.json" })
    assert.equal(uploaded.provider_url, "https://atlas.example/uploads/reference.png")
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "video",
      prompt: "The speaker rotates slowly in a dark studio",
      manifest_path: "production-manifest.json",
      reference_image_asset_ids: ["speaker_front"],
      duration_seconds: 5,
      resolution: "720p",
      ratio: "16:9",
    })
    assert.equal(calculated.model, ATLAS_VIDEO_MODEL)
    assert.equal(calculated.estimated, true)
    assert.equal(calculated.estimated_tokens, 12345)
    const request = client.calls.find((call) => call.operation === "calculate").body
    assert.deepEqual(request.reference_images, [uploaded.provider_url])
    assert.equal(request.duration, 5)
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    assert.equal(manifest.assets[0].metadata.atlascloud.provider_url, uploaded.provider_url)
    assert.equal(manifest.generation_jobs[0].job_id, calculated.job_id)
    assert.equal(manifest.generation_jobs[0].request_digest, calculated.request_digest)
    assert.equal(manifest.generation_jobs[0].estimated, true)
  } finally {
    await cleanup(root)
  }
})

test("generation rejects changed approvals and increased preflight cost without calling paid endpoints", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({ costs: [{ price: 0.045, estimated: false }, { price: 0.045, estimated: false }, { price: 0.06, estimated: false }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A premium speaker",
      manifest_path: manifestRequestPath,
    })
    await assert.rejects(
      runtime.media_generate_image({
        job_id: calculated.job_id,
        shot_id: "shot_01",
        media_type: "image",
        prompt: "A changed speaker",
        manifest_path: manifestRequestPath,
        approved_request_digest: calculated.request_digest,
        approved_max_usd: 1,
      }),
      /request_digest does not match the approved request/,
    )
    const changedCalls = client.calls.filter((call) => call.operation === "calculate")
    assert.equal(changedCalls.length, 1)
    assert.equal(client.calls.some((call) => call.operation === "generateImage"), false)

    const approved = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A second premium speaker",
      manifest_path: manifestRequestPath,
    })
    await assert.rejects(
      runtime.media_generate_image({
        job_id: approved.job_id,
        shot_id: "shot_01",
        media_type: "image",
        prompt: "A second premium speaker",
        manifest_path: manifestRequestPath,
        approved_request_digest: approved.request_digest,
        approved_max_usd: 0.05,
        approved_price_usd: 0.045,
      }),
      /current preflight price 0.06 exceeds approved_max_usd 0.05/,
    )
    assert.equal(client.calls.filter((call) => call.operation === "generateImage").length, 0)
  } finally {
    await cleanup(root)
  }
})

test("ambiguous paid generation submission is not retried", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({
      costs: [{ price: 0.24, estimated: true }, { price: 0.24, estimated: true }],
      generateVideoError: new Error("socket dropped after submission"),
    })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    await runtime.media_upload({ asset_id: "speaker_front", path: "references/speaker.png", manifest_path: manifestRequestPath })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "video",
      prompt: "A slow product reveal",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      duration_seconds: 4,
    })
    await assert.rejects(runtime.media_generate_video({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "video",
      prompt: "A slow product reveal",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      duration_seconds: 4,
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 0.3,
    }), /socket dropped/)
    await assert.rejects(runtime.media_generate_video({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "video",
      prompt: "A slow product reveal",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      duration_seconds: 4,
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 0.3,
    }), /cannot be submitted again/)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 1)
  } finally {
    await cleanup(root)
  }
})

test("ambiguous image submission is also not retried", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({
      costs: [{ price: 0.045, estimated: false }, { price: 0.045, estimated: false }],
      generateImageError: new Error("connection closed after submission"),
    })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A premium speaker",
      manifest_path: manifestRequestPath,
    })
    await assert.rejects(runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A premium speaker",
      manifest_path: manifestRequestPath,
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 0.1,
    }), /connection closed/)
    await assert.rejects(runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A premium speaker",
      manifest_path: manifestRequestPath,
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 0.1,
    }), /cannot be submitted again/)
    assert.equal(client.calls.filter((call) => call.operation === "generateImage").length, 1)
  } finally {
    await cleanup(root)
  }
})

test("media_upload allows only manifest-approved real files under the project root", async () => {
  const { root, manifestRequestPath } = await fixture()
  const outside = await mkdtemp(join(tmpdir(), "aio-atlas-outside-"))
  try {
    await writeFile(join(outside, "secret.png"), Buffer.from("secret"))
    await symlink(join(outside, "secret.png"), join(root, "escape.png"))
    const client = fakeClient()
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const valid = await runtime.media_upload({ asset_id: "speaker_front", path: "references/speaker.png", manifest_path: manifestRequestPath })
    assert.equal(valid.status, "uploaded")
    for (const path of ["../secret.png", "/etc/passwd", "missing.png", "references"]) {
      await assert.rejects(
        runtime.media_upload({ asset_id: "speaker_front", manifest_path: manifestRequestPath, path }),
        /workspace|traversal|does not exist|must identify a file/,
      )
    }
    await assert.rejects(
      runtime.media_upload({ asset_id: "speaker_front", manifest_path: manifestRequestPath, path: "escape.png" }),
      /outside the project workspace/,
    )
    assert.equal(client.calls.filter((call) => call.operation === "uploadMedia").length, 1)
  } finally {
    await cleanup(root)
    await cleanup(outside)
  }
})

test("media_upload requires a manifest asset and rejects arbitrary or mismatched workspace files", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    await mkdir(join(root, "private"), { recursive: true })
    await writeFile(join(root, "private", "secret.png"), Buffer.from("secret"))
    const client = fakeClient()
    const runtime = createAtlasMediaRuntime({ directory: root, client })

    await assert.rejects(
      runtime.media_upload({ asset_id: "speaker_front", path: "references/speaker.png" }),
      /manifest_path is required for media upload/,
    )
    await assert.rejects(
      runtime.media_upload({ asset_id: "unknown_asset", manifest_path: manifestRequestPath, path: "private/secret.png" }),
      /ProductionManifest has no asset unknown_asset/,
    )
    await assert.rejects(
      runtime.media_upload({ asset_id: "speaker_front", manifest_path: manifestRequestPath, path: "private/secret.png" }),
      /Provided upload path does not match ProductionManifest asset path/,
    )
    assert.equal(client.calls.filter((call) => call.operation === "uploadMedia").length, 0)

    const matching = await runtime.media_upload({
      asset_id: "speaker_front",
      manifest_path: manifestRequestPath,
      path: "references/speaker.png",
    })
    assert.equal(matching.status, "uploaded")
    assert.equal(client.calls.filter((call) => call.operation === "uploadMedia").length, 1)
  } finally {
    await cleanup(root)
  }
})

test("real Atlas paid flow requires persisted ProductionManifest context", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient()
    const runtime = createAtlasMediaRuntime({ directory: root, client })

    await assert.rejects(
      runtime.media_calculate({ shot_id: "shot_01", media_type: "image", prompt: "A speaker" }),
      /manifest_path is required for media_calculate/,
    )
    assert.equal(client.calls.length, 0)

    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A speaker",
      manifest_path: manifestRequestPath,
    })
    await assert.rejects(
      runtime.media_generate_image({
        job_id: calculated.job_id,
        shot_id: "shot_01",
        media_type: "image",
        prompt: "A speaker",
        approved_request_digest: calculated.request_digest,
        approved_max_usd: 0.1,
      }),
      /manifest_path is required for media_generate_image/,
    )
    await assert.rejects(
      runtime.media_generate_video({
        job_id: calculated.job_id,
        shot_id: "shot_01",
        media_type: "video",
        prompt: "A speaker",
        approved_request_digest: calculated.request_digest,
        approved_max_usd: 0.1,
      }),
      /manifest_path is required for media_generate_video/,
    )
    assert.equal(client.calls.filter((call) => call.operation === "generateImage").length, 0)

    await assert.rejects(
      runtime.media_generate_image({
        job_id: "ephemeral-image-job",
        shot_id: "shot_01",
        media_type: "image",
        prompt: "A speaker",
        manifest_path: manifestRequestPath,
        approved_request_digest: calculated.request_digest,
        approved_max_usd: 0.1,
      }),
      /Unknown Atlas media generation job: ephemeral-image-job/,
    )
    await assert.rejects(
      runtime.media_generate_video({
        job_id: "ephemeral-video-job",
        shot_id: "shot_01",
        media_type: "video",
        prompt: "A speaker",
        manifest_path: manifestRequestPath,
        approved_request_digest: calculated.request_digest,
        approved_max_usd: 0.1,
      }),
      /Unknown Atlas media generation job: ephemeral-video-job/,
    )
  } finally {
    await cleanup(root)
  }
})

test("prediction polling maps processing to completed and materializes local output", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    let clock = 0
    const client = fakeClient({
      predictions: [
        { status: "processing", outputs: [] },
        { status: "completed", outputs: ["https://atlas.example/output.png", "https://atlas.example/output-2.png"] },
        { status: "completed", outputs: ["https://atlas.example/output.png", "https://atlas.example/output-2.png"] },
      ],
    })
    const runtime = createAtlasMediaRuntime({
      directory: root,
      client,
      now: () => clock,
      sleepImpl: async (ms) => { clock += ms },
    })
    const calculated = await runtime.media_calculate({ shot_id: "shot_01", media_type: "image", prompt: "A speaker", manifest_path: manifestRequestPath })
    const submitted = await runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A speaker",
      manifest_path: manifestRequestPath,
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 0.1,
    })
    const completed = await runtime.media_wait_prediction({
      job_id: submitted.job_id,
      manifest_path: manifestRequestPath,
      interval_ms: 250,
      timeout_ms: 2_000,
    })
    assert.equal(completed.status, "completed")
    assert.equal(completed.output_asset_ids.length, 2)
    assert.equal(completed.output_paths.every((path) => path.startsWith("production/assets/generated/")), true)
    assert.equal(completed.output_paths.some((path) => path.includes("production/production/")), false)
    const materialized = resolve(root, completed.output_paths[0])
    assert.equal((await readFile(materialized, "utf8")).startsWith("materialized:"), true)
    assert.equal(client.calls.filter((call) => call.operation === "download").length, 2)
    const repeated = await runtime.media_prediction({ job_id: submitted.job_id, manifest_path: manifestRequestPath })
    assert.deepEqual(repeated.output_asset_ids, completed.output_asset_ids)
    assert.equal(client.calls.filter((call) => call.operation === "download").length, 2)
  } finally {
    await cleanup(root)
  }
})

test("materialization keeps the canonical output directory for a production manifest", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture({ manifestInProduction: true })
  try {
    const client = fakeClient({
      predictions: [{ status: "completed", outputs: ["https://atlas.example/nested-output.png"] }],
    })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A speaker in the production manifest location",
      manifest_path: manifestRequestPath,
    })
    const submitted = await runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      prompt: "A speaker in the production manifest location",
      manifest_path: manifestRequestPath,
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 0.1,
    })
    const completed = await runtime.media_prediction({ job_id: submitted.job_id, manifest_path: manifestRequestPath })
    assert.equal(completed.output_paths.length, 1)
    assert.match(completed.output_paths[0], /^production\/assets\/generated\//)
    assert.doesNotMatch(completed.output_paths[0], /production\/production\//)
    assert.equal((await readFile(resolve(root, completed.output_paths[0]), "utf8")).startsWith("materialized:"), true)
    await stat(resolve(root, "production", "assets", "generated"))
    await assert.rejects(
      stat(resolve(root, "production", "production", "assets", "generated")),
      /ENOENT/,
    )
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    assert.match(manifest.assets.at(-1).path, /^production\/assets\/generated\//)
  } finally {
    await cleanup(root)
  }
})

test("failed and provider-timeout predictions persist terminal states without rerolling", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({ predictions: [{ status: "failed", error: "content rejected", outputs: [] }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A speaker",
      manifest_path: manifestRequestPath,
    })
    const submitted = await runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A speaker",
      manifest_path: manifestRequestPath,
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 0.1,
    })
    const failed = await runtime.media_prediction({ job_id: submitted.job_id, manifest_path: manifestRequestPath })
    assert.equal(failed.status, "failed")
    assert.equal(failed.error, "content rejected")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    assert.equal(manifest.generation_jobs[0].status, "failed")
    assert.equal(manifest.generation_jobs[0].provider_error, "content rejected")

    const timeoutClient = fakeClient({ predictions: [{ status: "timeout", outputs: [] }] })
    const timeoutRuntime = createAtlasMediaRuntime({ directory: root, client: timeoutClient })
    const timeoutCalc = await timeoutRuntime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A timeout speaker",
      manifest_path: manifestRequestPath,
    })
    const timeoutSubmit = await timeoutRuntime.media_generate_image({
      job_id: timeoutCalc.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A timeout speaker",
      manifest_path: manifestRequestPath,
      approved_request_digest: timeoutCalc.request_digest,
      approved_max_usd: 0.1,
    })
    const timeout = await timeoutRuntime.media_prediction({ job_id: timeoutSubmit.job_id, manifest_path: manifestRequestPath })
    assert.equal(timeout.status, "timeout")
  } finally {
    await cleanup(root)
  }
})

test("local wait timeout remains resumable and does not claim provider cancellation", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    let clock = 0
    const client = fakeClient({ predictions: [{ status: "processing", outputs: [] }] })
    const runtime = createAtlasMediaRuntime({
      directory: root,
      client,
      now: () => clock,
      sleepImpl: async (ms) => { clock += ms },
    })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A slow speaker",
      manifest_path: manifestRequestPath,
    })
    const submitted = await runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A slow speaker",
      manifest_path: manifestRequestPath,
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 0.1,
    })
    const timedOut = await runtime.media_wait_prediction({
      job_id: submitted.job_id,
      manifest_path: manifestRequestPath,
      interval_ms: 250,
      timeout_ms: 1_000,
    })
    assert.equal(timedOut.status, "processing")
    assert.equal(timedOut.wait_timed_out, true)
    assert.equal(timedOut.cancellation_requested, false)
    assert.equal(client.calls.some((call) => call.operation === "cancel"), false)
  } finally {
    await cleanup(root)
  }
})

test("malformed Atlas responses fail closed", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const malformed = fakeClient()
    malformed.calculate = async () => ({ data: { estimated: false } })
    const runtime = createAtlasMediaRuntime({ directory: root, client: malformed })
    await assert.rejects(
      runtime.media_calculate({ shot_id: "shot_01", media_type: "image", prompt: "A speaker", manifest_path: manifestRequestPath }),
      /malformed response: missing non-negative data.price/,
    )
    const unknownStatus = fakeClient({ predictions: [{ status: "mysterious", outputs: [] }] })
    const unknownRuntime = createAtlasMediaRuntime({ directory: root, client: unknownStatus })
    const calculated = await unknownRuntime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A speaker",
      manifest_path: manifestRequestPath,
    })
    const submitted = await unknownRuntime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A speaker",
      manifest_path: manifestRequestPath,
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 0.1,
    })
    await assert.rejects(
      unknownRuntime.media_prediction({ job_id: submitted.job_id, manifest_path: manifestRequestPath }),
      /unsupported status: mysterious/,
    )
  } finally {
    await cleanup(root)
  }
})

test("completed video output is materialized and linked from ProductionManifest", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({
      predictions: [{ status: "completed", outputs: ["https://atlas.example/output.mp4"] }],
      costs: [{ price: 0.24, estimated: true }, { price: 0.24, estimated: true }],
    })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    await runtime.media_upload({ asset_id: "speaker_front", manifest_path: manifestRequestPath })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "video",
      prompt: "The speaker rotates slowly",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      duration_seconds: 4,
      resolution: "720p",
      ratio: "16:9",
    })
    const submitted = await runtime.media_generate_video({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "video",
      prompt: "The speaker rotates slowly",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      duration_seconds: 4,
      resolution: "720p",
      ratio: "16:9",
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 0.3,
      approved_price_usd: calculated.price_usd,
    })
    const completed = await runtime.media_prediction({ job_id: submitted.job_id, manifest_path: manifestRequestPath })
    assert.equal(completed.status, "completed")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    assert.equal(manifest.generation_jobs[0].status, "completed")
    assert.equal(manifest.generation_jobs[0].provider_prediction_id, "prediction-video-01")
    assert.equal(manifest.generation_jobs[0].output_asset_ids.length, 1)
    assert.equal(manifest.assets.some((asset) => asset.asset_id === manifest.generation_jobs[0].output_asset_ids[0]), true)
    assert.equal(manifest.costs.approved_usd, 0.3)
    assert.equal(manifest.costs.actual_usd, null)
    assert.equal((await readFile(resolve(root, manifest.assets.at(-1).path), "utf8")).startsWith("materialized:"), true)
  } finally {
    await cleanup(root)
  }
})
