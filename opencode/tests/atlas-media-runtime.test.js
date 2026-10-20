import test from "node:test"
import assert from "node:assert/strict"
import { fork } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, mkdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { createProductionManifest, validateProductionManifest } from "../plugins/film-production/contracts.js"
import { createAtlasClient } from "../plugins/delegation/atlas-client.js"
import {
  ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
  ATLAS_GPT_IMAGE_MODEL,
  ATLAS_IMAGE_MODEL,
  ATLAS_MINIMAX_H3_MODEL,
  ATLAS_SEEDANCE_2_5_MODEL,
  ATLAS_WAN_MODEL,
  canonicalJson,
  createAtlasMediaRuntime,
  requestDigest,
} from "../plugins/delegation/media-runtime.js"
import { productionApproveGeneration, productionCheckpoint } from "../plugins/delegation/production-control.js"

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

const ROOT_MANIFEST_PATH = "production/production-manifest.json"

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
  uploadResponse = null,
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
      const price = configured?.price ?? (body.model === ATLAS_WAN_MODEL ? 0.24 : 0.045)
      return {
        data: {
          price,
          origin_price: configured?.origin_price ?? price,
          discount: configured?.discount ?? 100,
          estimated: configured?.estimated ?? body.model === ATLAS_WAN_MODEL,
          ...(configured?.estimated_tokens === undefined ? {} : { estimated_tokens: configured.estimated_tokens }),
        },
      }
    },
    uploadMedia: async (formData) => {
      calls.push({ operation: "uploadMedia", formData })
      return uploadResponse ?? { url: uploadURL }
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

async function fixture({ manifestInProduction = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "aio-atlas-media-"))
  await mkdir(join(root, "references"), { recursive: true })
  await writeFile(join(root, "references", "speaker.png"), Buffer.from("png fixture"))
  await writeFile(join(root, "references", "previs.mp4"), Buffer.from("video fixture"))
  await writeFile(join(root, "references", "voice.mp3"), Buffer.from("mp3 fixture"))
  await writeFile(join(root, "references", "music.wav"), Buffer.from("wav fixture"))
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

async function approveGeneration(root, quote, approvedMax = quote.price_usd) {
  return productionApproveGeneration({
    job_id: quote.job_id,
    request_digest: quote.request_digest,
    approved_max_usd: approvedMax,
  }, root)
}

function submissionWorker(t, root, request, mode, onSubmission = () => {}) {
  const child = fork(new URL("./support/media-submission-worker.js", import.meta.url), [root, JSON.stringify(request), mode], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  })
  let readyCalculate
  const calculateReady = new Promise((resolveReady) => { readyCalculate = resolveReady })
  const ready = once(child, "message")
  const outcome = new Promise((resolveResult, reject) => {
    child.on("message", (message) => {
      if (message.type === "provider_submission") onSubmission()
      if (message.type === "calculate_ready") readyCalculate(message)
      if (message.type === "result") {
        if (message.error) reject(new Error(message.error))
        else resolveResult(message.value)
      }
    })
    child.on("error", reject)
    child.on("exit", (code) => reject(new Error(`submission worker exited ${code} before returning a result`)))
  })
  outcome.catch(() => {})
  t.after(() => { if (child.exitCode === null) child.kill() })
  return {
    ready,
    calculateReady,
    outcome,
    start: () => child.send({ type: "submit" }),
    continueCalculate: () => child.send({ type: "continue_calculate" }),
  }
}

function videoRequest(manifestPath) {
  return {
    media_type: "video", shot_id: "shot_01", model: ATLAS_WAN_MODEL,
    prompt: "A fox wearing a blue scarf crosses a misty dawn clearing",
    duration_seconds: 5, resolution: "480p", ratio: "16:9", manifest_path: manifestPath,
  }
}

function concurrentSubmissionClient({ quoteCount, submissionCount, price = 0.20 }) {
  const calls = []
  let calculations = 0
  let recalculations = 0
  let releaseRecalculations
  const recalculationBarrier = new Promise((resolveBarrier) => { releaseRecalculations = resolveBarrier })
  return {
    calls,
    calculate: async (body) => {
      calls.push({ operation: "calculate", body: structuredClone(body) })
      calculations += 1
      if (calculations > quoteCount) {
        recalculations += 1
        if (recalculations === submissionCount) releaseRecalculations()
        await recalculationBarrier
      }
      return { data: { price, origin_price: price, discount: 100, estimated: false } }
    },
    generateVideo: async (body) => {
      const predictionID = `prediction-${requestDigest(body).slice(0, 16)}`
      calls.push({ operation: "generateVideo", body: structuredClone(body), predictionID })
      return { data: { id: predictionID, status: "processing" } }
    },
  }
}

async function createApprovedVideoJobs(root, runtime, manifestRequestPath, count) {
  const jobs = []
  for (let index = 0; index < count; index += 1) {
    const request = {
      ...videoRequest(manifestRequestPath),
      prompt: `Approved concurrent fox request ${index + 1}`,
    }
    const quote = await runtime.media_calculate(request)
    await approveGeneration(root, quote, quote.price_usd)
    jobs.push({ request, quote })
  }
  return jobs
}

test("concurrent submission in one runtime or independent runtimes consumes one approval once", async (t) => {
  for (const independent of [false, true]) {
    const { root, manifestPath, manifestRequestPath } = await fixture()
    try {
      const client = fakeClient({ costs: [{ price: 0.25 }, { price: 0.20 }] })
      const runtime = createAtlasMediaRuntime({ directory: root, client })
      const request = videoRequest(manifestRequestPath)
      const quote = await runtime.media_calculate(request)
      await approveGeneration(root, quote, 0.25)
      const calculate = client.calculate
      client.calculate = async (body) => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 30))
        return calculate(body)
      }
      const other = independent ? createAtlasMediaRuntime({ directory: root, client }) : runtime
      const args = { ...request, job_id: quote.job_id }
      const results = await Promise.allSettled([runtime.media_generate_video(args), other.media_generate_video(args)])
      assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"])
      assert.match(results.find((result) => result.status === "rejected").reason.message, /submission already claimed/)
      assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 1)
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
      validateProductionManifest(manifest)
      assert.equal(manifest.generation_jobs[0].status, "submitted")
      await assert.rejects(other.media_generate_video(args), /cannot be submitted again/)
      t.diagnostic(JSON.stringify({ boundary: independent ? "independent runtimes" : "same runtime", attempts: 2, provider_submissions: 1, results: results.map((r) => r.status), final_status: "submitted" }))
    } finally {
      await cleanup(root)
    }
  }
})

test("two distinct approved jobs submit concurrently and both canonical updates persist", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    const client = concurrentSubmissionClient({ quoteCount: 2, submissionCount: 2 })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const jobs = await createApprovedVideoJobs(root, runtime, manifestRequestPath, 2)
    const outcomes = await Promise.allSettled(jobs.map(({ request, quote }) =>
      runtime.media_generate_video({ ...request, job_id: quote.job_id })))
    assert.deepEqual(outcomes.map((result) => result.status), ["fulfilled", "fulfilled"])
    const results = outcomes.map((result) => result.value)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 2)
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    validateProductionManifest(manifest)
    for (const { quote } of jobs) {
      const stored = manifest.generation_jobs.find((job) => job.job_id === quote.job_id)
      assert.equal(stored.status, "submitted")
      assert.equal(stored.provider_prediction_id, results.find((result) => result.job_id === quote.job_id).prediction_id)
    }
  } finally { await cleanup(root) }
})

test("five distinct approved jobs preserve every reservation and prediction ID under contention", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    const client = concurrentSubmissionClient({ quoteCount: 5, submissionCount: 5 })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const jobs = await createApprovedVideoJobs(root, runtime, manifestRequestPath, 5)
    const outcomes = await Promise.allSettled(jobs.map(({ request, quote }) =>
      runtime.media_generate_video({ ...request, job_id: quote.job_id })))
    assert.deepEqual(outcomes.map((result) => result.status), ["fulfilled", "fulfilled", "fulfilled", "fulfilled", "fulfilled"])
    const results = outcomes.map((result) => result.value)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 5)
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    validateProductionManifest(manifest)
    assert.equal(manifest.generation_jobs.length, 5)
    for (const { quote } of jobs) {
      const stored = manifest.generation_jobs.find((job) => job.job_id === quote.job_id)
      assert.equal(stored.status, "submitted")
      assert.ok(stored.provider_prediction_id)
      assert.equal(results.find((result) => result.job_id === quote.job_id).prediction_id, stored.provider_prediction_id)
    }
  } finally { await cleanup(root) }
})

test("different runtime instances serialize their writes to one shared ProductionManifest", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    const client = concurrentSubmissionClient({ quoteCount: 2, submissionCount: 2 })
    const first = createAtlasMediaRuntime({ directory: root, client })
    const second = createAtlasMediaRuntime({ directory: root, client })
    const jobs = await createApprovedVideoJobs(root, first, manifestRequestPath, 2)
    const outcomes = await Promise.allSettled(jobs.map(({ request, quote }, index) =>
      (index === 0 ? first : second).media_generate_video({ ...request, job_id: quote.job_id })))
    assert.deepEqual(outcomes.map((result) => result.status), ["fulfilled", "fulfilled"])
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    validateProductionManifest(manifest)
    assert.equal(manifest.generation_jobs.filter((job) => job.status === "submitted").length, 2)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 2)
  } finally { await cleanup(root) }
})

test("a submission reservation and Producer approval for another job preserve both job states", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    let calculationNumber = 0
    let releaseCalculation
    let markCalculationEntered
    const calculationEntered = new Promise((resolveEntered) => { markCalculationEntered = resolveEntered })
    const client = fakeClient({ costs: [{ price: 0.20 }, { price: 0.20 }, { price: 0.20 }] })
    const originalCalculate = client.calculate
    client.calculate = async (body) => {
      calculationNumber += 1
      if (calculationNumber === 3) {
        markCalculationEntered()
        await new Promise((resolveCalculation) => { releaseCalculation = resolveCalculation })
      }
      return originalCalculate(body)
    }
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const firstRequest = { ...videoRequest(manifestRequestPath), prompt: "First concurrent approved request" }
    const secondRequest = { ...videoRequest(manifestRequestPath), prompt: "Second concurrent approval request" }
    const firstQuote = await runtime.media_calculate(firstRequest)
    const secondQuote = await runtime.media_calculate(secondRequest)
    await approveGeneration(root, firstQuote, 0.20)

    const submission = runtime.media_generate_video({ ...firstRequest, job_id: firstQuote.job_id })
    await calculationEntered
    const secondApproval = approveGeneration(root, secondQuote, 0.20)
    releaseCalculation()
    const outcomes = await Promise.allSettled([submission, secondApproval])
    assert.deepEqual(outcomes.map((result) => result.status), ["fulfilled", "fulfilled"])

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    validateProductionManifest(manifest)
    assert.equal(manifest.generation_jobs.find((job) => job.job_id === firstQuote.job_id).status, "submitted")
    assert.equal(manifest.generation_jobs.find((job) => job.job_id === secondQuote.job_id).status, "awaiting_approval")
    assert.equal(manifest.costs.approved_usd, 0.40)
  } finally { await cleanup(root) }
})

test("job submission reservation preserves a concurrent Producer checkpoint and provider work stays outside the lock", { timeout: 10_000 }, async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  let submission
  let releaseCalculation
  try {
    let markCalculationEntered
    const calculationEntered = new Promise((resolveEntered) => { markCalculationEntered = resolveEntered })
    const client = fakeClient({ costs: [{ price: 0.25 }, { price: 0.20 }] })
    const originalCalculate = client.calculate
    client.calculate = async (body) => {
      if (client.calls.filter((call) => call.operation === "calculate").length === 1) {
        markCalculationEntered()
        await new Promise((resolveCalculation) => { releaseCalculation = resolveCalculation })
      }
      return originalCalculate(body)
    }
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const request = videoRequest(manifestRequestPath)
    const quote = await runtime.media_calculate(request)
    await approveGeneration(root, quote, 0.25)
    submission = runtime.media_generate_video({ ...request, job_id: quote.job_id })
    await calculationEntered
    await productionCheckpoint({ current_focus: "parallel review state" }, root)
    releaseCalculation()
    await submission
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    validateProductionManifest(manifest)
    assert.equal(manifest.generation_jobs[0].status, "submitted")
    assert.equal(manifest.latest_checkpoint.current_focus, "parallel review state")
  } finally {
    releaseCalculation?.()
    await submission?.catch(() => {})
    await cleanup(root)
  }
})

test("separate Node workers cannot submit the same approved job twice", { timeout: 10_000 }, async (t) => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  t.after(() => cleanup(root))
  const runtime = createAtlasMediaRuntime({ directory: root, client: fakeClient({ costs: [{ price: 0.25 }] }) })
  const request = videoRequest(manifestRequestPath)
  const quote = await runtime.media_calculate(request)
  await approveGeneration(root, quote, 0.25)
  let submissions = 0
  const workers = [0, 1].map(() => submissionWorker(t, root, { ...request, job_id: quote.job_id }, "race", () => submissions++))
  await Promise.all(workers.map((worker) => worker.ready))
  workers.forEach((worker) => worker.start())
  const results = await Promise.allSettled(workers.map((worker) => worker.outcome))
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"])
  assert.match(results.find((result) => result.status === "rejected").reason.message, /submission already claimed/)
  assert.equal(submissions, 1)
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  validateProductionManifest(manifest)
  assert.equal(manifest.generation_jobs[0].status, "submitted")
  await assert.rejects(runtime.media_generate_video({ ...request, job_id: quote.job_id }), /cannot be submitted again/)
  t.diagnostic(JSON.stringify({ boundary: "separate Node processes", attempts: 2, provider_submissions: submissions, results: results.map((r) => r.status), final_status: "submitted" }))
})

test("separate Node processes preserve submissions for two different approved jobs", { timeout: 15_000 }, async (t) => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  t.after(() => cleanup(root))
  const runtime = createAtlasMediaRuntime({ directory: root, client: fakeClient({ costs: [{ price: 0.20 }, { price: 0.20 }] }) })
  const jobs = await createApprovedVideoJobs(root, runtime, manifestRequestPath, 2)
  let submissions = 0
  const workers = jobs.map(({ request, quote }) =>
    submissionWorker(t, root, { ...request, job_id: quote.job_id }, "hold-calculate", () => submissions++))
  await Promise.all(workers.map((worker) => worker.ready))
  workers.forEach((worker) => worker.start())
  const calculateArrivals = await Promise.all(workers.map((worker) => worker.calculateReady))
  assert.deepEqual(calculateArrivals.map((message) => message.job_id).sort(), jobs.map(({ quote }) => quote.job_id).sort())
  workers.forEach((worker) => worker.continueCalculate())
  const results = await Promise.allSettled(workers.map((worker) => worker.outcome))
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"])
  assert.equal(submissions, 2)
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  validateProductionManifest(manifest)
  for (const { quote } of jobs) {
    const stored = manifest.generation_jobs.find((job) => job.job_id === quote.job_id)
    assert.equal(stored.status, "submitted")
    assert.equal(stored.provider_prediction_id, `fake-worker-${quote.job_id}`)
  }
})

test("a process crash after reservation but before dispatch cannot authorize an automatic retry", { timeout: 10_000 }, async (t) => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  t.after(() => cleanup(root))
  const client = fakeClient({ costs: [{ price: 0.25 }] })
  const runtime = createAtlasMediaRuntime({ directory: root, client })
  const request = videoRequest(manifestRequestPath)
  const quote = await runtime.media_calculate(request)
  await approveGeneration(root, quote, 0.25)
  let submissions = 0
  const worker = submissionWorker(t, root, { ...request, job_id: quote.job_id }, "crash-before-dispatch", () => submissions++)
  await worker.ready
  worker.start()
  await assert.rejects(worker.outcome, /exited 23/)
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  validateProductionManifest(manifest)
  assert.equal(manifest.generation_jobs[0].status, "submitted")
  assert.equal(manifest.generation_jobs[0].provider_prediction_id, undefined)
  const restarted = createAtlasMediaRuntime({ directory: root, client })
  await assert.rejects(restarted.media_generate_video({ ...request, job_id: quote.job_id }), /cannot be submitted again/)
  assert.equal(submissions, 0)
  assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 0)
})

test("same-request quote refresh preserves original approval within its ceiling", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({ costs: [{ price: 0.25 }, { price: 0.20 }, { price: 0.29 }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const request = videoRequest(manifestRequestPath)
    const quote = await runtime.media_calculate(request)
    await approveGeneration(root, quote, 0.30)
    const refresh = await runtime.media_calculate(request)
    assert.equal(refresh.job_id, quote.job_id)
    assert.equal(refresh.request_digest, quote.request_digest)
    assert.equal(refresh.status, "awaiting_approval")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    assert.equal(manifest.generation_jobs[0].approved_max_usd, 0.30)
    assert.equal(manifest.generation_jobs[0].approved_price_usd, 0.25)
    assert.equal(manifest.generation_jobs[0].estimated_usd, 0.20)
    const result = await runtime.media_generate_video({ ...request, job_id: quote.job_id })
    assert.equal(result.status, "submitted")
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 1)
  } finally { await cleanup(root) }
})

test("quote refresh above the approved ceiling clears approval without raising it", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({ costs: [{ price: 0.20 }, { price: 0.30 }, { price: 0.20 }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const request = videoRequest(manifestRequestPath)
    const quote = await runtime.media_calculate(request)
    await approveGeneration(root, quote, 0.25)
    const refresh = await runtime.media_calculate(request)
    assert.equal(refresh.job_id, quote.job_id)
    assert.equal(refresh.status, "calculated")
    const job = JSON.parse(await readFile(manifestPath, "utf8")).generation_jobs[0]
    for (const field of ["approved_usd", "approved_max_usd", "approved_price_usd"]) assert.equal(job[field], null)
    await assert.rejects(runtime.media_generate_video({ ...request, job_id: quote.job_id }), /is calculated/)
    await approveGeneration(root, refresh, 0.30)
    assert.equal((await runtime.media_generate_video({ ...request, job_id: quote.job_id })).status, "submitted")
  } finally { await cleanup(root) }
})

test("a concurrent quote refresh cannot reopen a claimed submission", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({ costs: [{ price: 0.25 }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const request = videoRequest(manifestRequestPath)
    const quote = await runtime.media_calculate(request)
    await approveGeneration(root, quote, 0.25)
    let entered, finish
    const started = new Promise((resolveStarted) => { entered = resolveStarted })
    client.calculate = async () => { entered(); await new Promise((resolveFinish) => { finish = resolveFinish }); return { data: { price: 0.20 } } }
    const pending = runtime.media_generate_video({ ...request, job_id: quote.job_id })
    await started
    const refresher = createAtlasMediaRuntime({ directory: root, client: fakeClient({ costs: [{ price: 0.20 }] }) })
    await assert.rejects(refresher.media_calculate(request), /submission already claimed/)
    finish()
    await pending
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    validateProductionManifest(manifest)
    assert.equal(manifest.generation_jobs[0].status, "submitted")
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 1)
  } finally { await cleanup(root) }
})

async function addManifestProviderReferences(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  manifest.assets[0].metadata = {
    atlascloud: {
      provider_url: "https://atlas.example/uploads/front.png",
      content_type: "image/png",
    },
  }
  manifest.assets.push(
    {
      asset_id: "speaker_side",
      kind: "subject-reference",
      status: "ready",
      path: "references/speaker.png",
      shot_ids: ["shot_01"],
      metadata: {
        atlascloud: {
          provider_url: "https://atlas.example/uploads/side.png",
          content_type: "image/png",
        },
      },
    },
    {
      asset_id: "previs_reference",
      kind: "motion-reference",
      status: "ready",
      path: "references/previs.mp4",
      shot_ids: ["shot_01"],
      metadata: {
        atlascloud: {
          provider_url: "https://atlas.example/uploads/previs.mp4",
          content_type: "video/mp4",
        },
      },
    },
    {
      asset_id: "voice_reference",
      kind: "audio",
      status: "ready",
      path: "references/voice.mp3",
      shot_ids: ["shot_01"],
      metadata: {
        atlascloud: {
          provider_url: "https://atlas.example/uploads/voice.mp3",
          content_type: "audio/mpeg",
          size_bytes: 1_024,
        },
      },
    },
    {
      asset_id: "music_reference",
      kind: "audio",
      status: "ready",
      path: "references/music.wav",
      shot_ids: ["shot_01"],
      metadata: {
        atlascloud: {
          provider_url: "https://atlas.example/uploads/music.wav",
          content_type: "audio/wav",
          size_bytes: 2_048,
        },
      },
    },
  )
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
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
  assert.deepEqual(await client.generateVideo({ model: ATLAS_WAN_MODEL, prompt: "A slow reveal", duration: 4 }), {
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
    model: ATLAS_WAN_MODEL,
    prompt: "Slow reveal",
    duration: 5,
    reference_images: ["https://atlas.example/a.png"],
  }
  assert.equal(requestDigest(base), requestDigest({
    reference_images: ["https://atlas.example/a.png"],
    duration: 5,
    prompt: "Slow reveal",
    model: ATLAS_WAN_MODEL,
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
      model: ATLAS_IMAGE_MODEL,
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
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({ costs: [{ price: 0.24, estimated: true, estimated_tokens: 12345 }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const uploaded = await runtime.media_upload({ asset_id: "speaker_front", manifest_path: manifestRequestPath })
    assert.equal(uploaded.provider_url, "https://atlas.example/uploads/reference.png")
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "video",
      prompt: "The speaker rotates slowly in a dark studio",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      duration_seconds: 5,
      resolution: "720p",
      ratio: "16:9",
    })
    assert.equal(calculated.model, ATLAS_WAN_MODEL)
    assert.equal(calculated.estimated, true)
    assert.equal(calculated.estimated_tokens, 12345)
    const request = client.calls.find((call) => call.operation === "calculate").body
    assert.deepEqual(request.refers, [{ url: uploaded.provider_url, type: "image" }])
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

test("media_calculate normalizes Atlas numeric cost strings without relaxing validation", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient()
    client.calculate = async () => ({
      data: {
        price: "0.072",
        origin_price: "0.09",
        discount: "80",
        estimated: false,
      },
    })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A matte white geometric cube",
      manifest_path: manifestRequestPath,
    })
    assert.equal(calculated.price_usd, 0.072)
    assert.equal(calculated.origin_price_usd, 0.09)
    assert.equal(calculated.discount, 80)

    const malformed = fakeClient()
    malformed.calculate = async () => ({ data: { price: "not-a-number" } })
    const malformedRuntime = createAtlasMediaRuntime({ directory: root, client: malformed })
    await assert.rejects(
      malformedRuntime.media_calculate({
        shot_id: "shot_01",
        media_type: "image",
        prompt: "A matte white geometric cube",
        manifest_path: manifestRequestPath,
      }),
      /malformed response: missing non-negative data.price/,
    )
  } finally {
    await cleanup(root)
  }
})

test("media_calculate uses Wan 3.0 for an omitted video model", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient()
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "video",
      prompt: "A matte white geometric object slowly rotates in a clean studio",
      manifest_path: manifestRequestPath,
      duration_seconds: 4,
      resolution: "480p",
      ratio: "16:9",
    })
    assert.equal(calculated.model, ATLAS_WAN_MODEL)
    const request = client.calls.find((call) => call.operation === "calculate").body
    assert.equal(request.reference_images, undefined)
    assert.equal(request.reference_videos, undefined)
    assert.equal(request.duration, 4)
    assert.equal(request.resolution, "480p")
    assert.equal(request.ratio, "16:9")
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
    await approveGeneration(root, approved, 0.05)
    await assert.rejects(
      runtime.media_generate_image({
        job_id: approved.job_id,
        shot_id: "shot_01",
        media_type: "image",
        prompt: "A second premium speaker",
        manifest_path: manifestRequestPath,
      }),
      /current preflight price 0.06 exceeds approved_max_usd 0.05/,
    )
    assert.equal(client.calls.filter((call) => call.operation === "generateImage").length, 0)
  } finally {
    await cleanup(root)
  }
})

test("submission uses persisted Producer approval, exact job digest, and a newly approved revision", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({ costs: [
      { price: 0.25 },
      { price: 0.25 },
      { price: 0.20 },
    ] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const requestA = {
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_WAN_MODEL,
      prompt: "A fox moves through a misty clearing",
      manifest_path: manifestRequestPath,
      duration_seconds: 4,
      resolution: "480p",
      ratio: "16:9",
      generate_audio: false,
    }
    const quoteA = await runtime.media_calculate(requestA)
    await assert.rejects(runtime.media_generate_video({
      ...requestA,
      job_id: quoteA.job_id,
      approved_request_digest: quoteA.request_digest,
      approved_max_usd: 0.25,
    }), /is calculated and cannot be submitted again/)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 0)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, 1)

    await approveGeneration(root, quoteA, 0.25)
    const requestB = { ...requestA, prompt: "Revision: a fox runs through the mist" }
    const quoteB = await runtime.media_calculate(requestB)
    assert.notEqual(quoteB.job_id, quoteA.job_id)
    await assert.rejects(runtime.media_generate_video({
      ...requestB,
      job_id: quoteB.job_id,
      approved_request_digest: quoteA.request_digest,
      approved_max_usd: 0.25,
    }), /is calculated and cannot be submitted again/)
    await assert.rejects(runtime.media_generate_video({
      ...requestB,
      job_id: quoteA.job_id,
    }), /request_digest does not match the approved request/)

    const submittedA = await runtime.media_generate_video({ ...requestA, job_id: quoteA.job_id })
    assert.equal(submittedA.status, "submitted")
    assert.equal(submittedA.request_digest, quoteA.request_digest)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, 3)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 1)
    const manifest = JSON.parse(await readFile(resolve(root, manifestRequestPath), "utf8"))
    assert.equal(manifest.generation_jobs.find((job) => job.job_id === quoteA.job_id).approved_max_usd, 0.25)
    assert.equal(manifest.generation_jobs.find((job) => job.job_id === quoteB.job_id).status, "calculated")
  } finally {
    await cleanup(root)
  }
})

test("a recalculated price above the persisted Producer ceiling is denied without submission", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({ costs: [{ price: 0.25 }, { price: 0.30 }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const request = {
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_WAN_MODEL,
      prompt: "A fox moves through a misty clearing",
      manifest_path: manifestRequestPath,
      duration_seconds: 4,
      resolution: "480p",
      ratio: "16:9",
      generate_audio: false,
    }
    const quote = await runtime.media_calculate(request)
    await approveGeneration(root, quote, 0.25)
    await assert.rejects(runtime.media_generate_video({ ...request, job_id: quote.job_id }),
      /current preflight price 0.3 exceeds approved_max_usd 0.25/)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 0)
  } finally {
    await cleanup(root)
  }
})

test("approval for one generation job cannot authorize a different job with the same request digest", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.shots.push({ ...structuredClone(shot), shot_id: "shot_02", references: {} })
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const client = fakeClient({ costs: [{ price: 0.25 }, { price: 0.25 }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const request = {
      media_type: "video",
      model: ATLAS_WAN_MODEL,
      prompt: "A fox moves through a misty clearing",
      manifest_path: manifestRequestPath,
      duration_seconds: 4,
      resolution: "480p",
      ratio: "16:9",
      generate_audio: false,
    }
    const quoteA = await runtime.media_calculate({ ...request, shot_id: "shot_01" })
    const quoteB = await runtime.media_calculate({ ...request, shot_id: "shot_02" })
    assert.notEqual(quoteA.job_id, quoteB.job_id)
    assert.equal(quoteA.request_digest, quoteB.request_digest)

    await approveGeneration(root, quoteA, 0.25)
    await assert.rejects(runtime.media_generate_video({
      ...request,
      shot_id: "shot_02",
      job_id: quoteB.job_id,
    }), /is calculated and cannot be submitted again/)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 0)
  } finally {
    await cleanup(root)
  }
})

test("GPT Image 2 preserves the calculated request digest through image generation", async () => {
  const { root, manifestPath } = await fixture()
  try {
    const client = fakeClient({ costs: [{ price: 0.08 }, { price: 0.08 }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "A cinematic glass sculpture on a black plinth",
      manifest_path: ROOT_MANIFEST_PATH,
      size: "1024*1024",
      output_format: "png",
      quality: "low",
    })
    const calculatedRequest = client.calls.find((call) => call.operation === "calculate").body
    assert.deepEqual(calculatedRequest, {
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "A cinematic glass sculpture on a black plinth",
      size: "1024x1024",
      output_format: "png",
      quality: "low",
    })
    const manifestAfterCalculate = JSON.parse(await readFile(manifestPath, "utf8"))
    assert.equal(manifestAfterCalculate.generation_jobs[0].model, ATLAS_GPT_IMAGE_MODEL)
    assert.equal(manifestAfterCalculate.generation_jobs[0].request_digest, calculated.request_digest)

    await assert.rejects(runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "A cinematic glass sculpture on a black plinth",
      manifest_path: ROOT_MANIFEST_PATH,
      size: "2048*1152",
      output_format: "png",
      quality: "high",
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 1,
    }), /request_digest does not match the approved request/)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, 1)
    assert.equal(client.calls.filter((call) => call.operation === "generateImage").length, 0)

    await approveGeneration(root, calculated, 1)
    const submitted = await runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "A cinematic glass sculpture on a black plinth",
      manifest_path: ROOT_MANIFEST_PATH,
      size: "1024*1024",
      output_format: "png",
      quality: "low",
    })
    assert.equal(submitted.model, ATLAS_GPT_IMAGE_MODEL)
    assert.equal(submitted.request_digest, calculated.request_digest)
    assert.deepEqual(client.calls.filter((call) => call.operation === "generateImage").at(-1).body, calculatedRequest)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, 2)
    assert.equal(client.calls.filter((call) => call.operation === "generateImage").length, 1)
  } finally {
    await cleanup(root)
  }
})

test("GPT Image 2.5 Sunburst quality participates in approval digests and recalculation", async () => {
  const { root, manifestPath } = await fixture()
  try {
    const client = fakeClient({ costs: [{ price: 0.14 }, { price: 0.14 }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A premium glass sculpture on a black plinth",
      manifest_path: ROOT_MANIFEST_PATH,
      size: "2048*1152",
      output_format: "png",
      quality: "xhigh",
      background: "transparent",
    })
    const calculatedRequest = client.calls.find((call) => call.operation === "calculate").body
    assert.deepEqual(calculatedRequest, {
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A premium glass sculpture on a black plinth",
      size: "2048x1152",
      output_format: "png",
      quality: "xhigh",
      background: "transparent",
    })

    await assert.rejects(runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A premium glass sculpture on a black plinth",
      manifest_path: ROOT_MANIFEST_PATH,
      size: "2048*1152",
      output_format: "png",
      quality: "max",
      background: "transparent",
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 1,
    }), /request_digest does not match the approved request/)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, 1)
    assert.equal(client.calls.filter((call) => call.operation === "generateImage").length, 0)

    await approveGeneration(root, calculated, 1)
    const submitted = await runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A premium glass sculpture on a black plinth",
      manifest_path: ROOT_MANIFEST_PATH,
      size: "2048*1152",
      output_format: "png",
      quality: "xhigh",
      background: "transparent",
    })
    assert.equal(submitted.model, ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL)
    assert.equal(submitted.request_digest, calculated.request_digest)
    assert.deepEqual(client.calls.filter((call) => call.operation === "generateImage").at(-1).body, calculatedRequest)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, 2)
    assert.equal(client.calls.filter((call) => call.operation === "generateImage").length, 1)
  } finally {
    await cleanup(root)
  }
})

test("invalid GPT Image 2.5 Sunburst quality is rejected before Atlas calculate", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient()
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    await assert.rejects(runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A scene",
      manifest_path: manifestRequestPath,
      quality: "ultra",
    }), /quality must be one of: auto, low, medium, high, xhigh, max/)
    assert.equal(client.calls.some((call) => call.operation === "calculate"), false)
  } finally {
    await cleanup(root)
  }
})

test("Seedance 2.5 preserves manifest-authorized reference order and fixed task type through approval digests", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    await addManifestProviderReferences(manifestPath)
    const client = fakeClient({ costs: [{ price: 1.12, estimated: true }, { price: 1.12, estimated: true }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "The subject moves through the set",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front", "speaker_side"],
      reference_video_asset_ids: ["previs_reference"],
      reference_audio_asset_ids: ["voice_reference", "music_reference"],
      duration_seconds: 30,
      resolution: "1080p-esr & 60fps",
      ratio: "21:9",
      generate_audio: false,
      video_output_format: "mov",
    })
    const calculatedRequest = client.calls.filter((call) => call.operation === "calculate").at(-1).body
    assert.deepEqual(calculatedRequest, {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "The subject moves through the set",
      reference_images: [
        "https://atlas.example/uploads/front.png",
        "https://atlas.example/uploads/side.png",
      ],
      reference_videos: ["https://atlas.example/uploads/previs.mp4"],
      reference_audios: [
        "https://atlas.example/uploads/voice.mp3",
        "https://atlas.example/uploads/music.wav",
      ],
      duration: 30,
      resolution: "1080p-esr & 60fps",
      ratio: "21:9",
      generate_audio: false,
      output_format: "mov",
      omni_reference_task_type: "reference",
    })
    const manifestAfterCalculate = JSON.parse(await readFile(manifestPath, "utf8"))
    assert.deepEqual(manifestAfterCalculate.generation_jobs[0].input_asset_ids, [
      "speaker_front",
      "speaker_side",
      "previs_reference",
      "voice_reference",
      "music_reference",
    ])
    assert.equal(manifestAfterCalculate.generation_jobs[0].request_digest, calculated.request_digest)
    const calculateCountBeforeGeneration = client.calls.filter((call) => call.operation === "calculate").length

    await assert.rejects(runtime.media_generate_video({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "The subject moves through the set",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front", "speaker_side"],
      reference_video_asset_ids: ["previs_reference"],
      reference_audio_asset_ids: ["music_reference", "voice_reference"],
      duration_seconds: 30,
      resolution: "1080p-esr & 60fps",
      ratio: "21:9",
      generate_audio: false,
      video_output_format: "mov",
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 2,
    }), /request_digest does not match the approved request/)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, calculateCountBeforeGeneration)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 0)

    await assert.rejects(runtime.media_generate_video({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "The subject moves through the set",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front", "speaker_side"],
      reference_video_asset_ids: ["previs_reference"],
      reference_audio_asset_ids: ["voice_reference"],
      duration_seconds: 30,
      resolution: "1080p-esr & 60fps",
      ratio: "21:9",
      generate_audio: false,
      video_output_format: "mov",
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 2,
    }), /request_digest does not match the approved request/)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, calculateCountBeforeGeneration)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 0)

    await assert.rejects(runtime.media_generate_video({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "The subject moves through the set",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front", "speaker_side"],
      reference_video_asset_ids: ["previs_reference"],
      reference_audio_asset_ids: ["voice_reference", "music_reference"],
      duration_seconds: 30,
      resolution: "1440p-esr",
      ratio: "21:9",
      generate_audio: false,
      video_output_format: "mov",
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 2,
    }), /request_digest does not match the approved request/)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, calculateCountBeforeGeneration)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 0)

    await assert.rejects(runtime.media_generate_video({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "The subject moves through the set",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front", "speaker_side"],
      reference_video_asset_ids: ["previs_reference"],
      reference_audio_asset_ids: ["voice_reference", "music_reference"],
      duration_seconds: 30,
      resolution: "1080p-esr & 60fps",
      ratio: "21:9",
      generate_audio: true,
      video_output_format: "mov",
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 2,
    }), /request_digest does not match the approved request/)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, calculateCountBeforeGeneration)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 0)

    await approveGeneration(root, calculated, 2)
    const submitted = await runtime.media_generate_video({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "The subject moves through the set",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front", "speaker_side"],
      reference_video_asset_ids: ["previs_reference"],
      reference_audio_asset_ids: ["voice_reference", "music_reference"],
      duration_seconds: 30,
      resolution: "1080p-esr & 60fps",
      ratio: "21:9",
      generate_audio: false,
      video_output_format: "mov",
    })
    assert.equal(submitted.model, ATLAS_SEEDANCE_2_5_MODEL)
    assert.equal(submitted.request_digest, calculated.request_digest)
    assert.deepEqual(client.calls.filter((call) => call.operation === "generateVideo").at(-1).body, calculatedRequest)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, calculateCountBeforeGeneration + 1)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 1)
  } finally {
    await cleanup(root)
  }
})

test("invalid Seedance 2.5 references and controls are rejected before Atlas calculate", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient()
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    await assert.rejects(runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "A scene",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: Array.from({ length: 31 }, (_, index) => `image_${index}`),
    }), /reference_image_asset_ids must contain at most 30 asset IDs/)
    await assert.rejects(runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "A scene",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      resolution: "8k-esr",
    }), /resolution must be one of:/)
    await assert.rejects(runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "A scene",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      reference_audios: ["https://atlas.example/audio.mp3"],
    }), /reference_audios is not supported by the AIO media-generation contract/)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, 0)
  } finally {
    await cleanup(root)
  }
})

test("MiniMax H3 uses manifest-authorized typed references and preserves approval digests", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({ costs: [{ price: 0.72 }, { price: 0.72 }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const uploaded = await runtime.media_upload({
      asset_id: "speaker_front",
      path: "references/speaker.png",
      manifest_path: manifestRequestPath,
    })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "The speaker walks through a rainy night market",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      resolution: "2k",
      duration_seconds: 8,
      ratio: "16:9",
      prompt_expansion: true,
    })
    const calculatedRequest = client.calls.filter((call) => call.operation === "calculate").at(-1).body
    assert.deepEqual(calculatedRequest, {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "The speaker walks through a rainy night market",
      refers: [{ url: uploaded.provider_url, type: "image" }],
      resolution: "2K",
      duration: 8,
      ratio: "16:9",
      prompt_expansion: true,
    })
    const manifest = JSON.parse(await readFile(resolve(root, manifestRequestPath), "utf8"))
    assert.deepEqual(manifest.generation_jobs[0].input_asset_ids, ["speaker_front"])
    const calculateCountBeforeMutation = client.calls.filter((call) => call.operation === "calculate").length

    await assert.rejects(runtime.media_generate_video({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "The speaker walks through a rainy night market",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      resolution: "2k",
      duration_seconds: 10,
      ratio: "16:9",
      prompt_expansion: false,
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 1,
    }), /request_digest does not match the approved request/)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, calculateCountBeforeMutation)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 0)

    await approveGeneration(root, calculated, 1)
    const submitted = await runtime.media_generate_video({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "The speaker walks through a rainy night market",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      resolution: "2k",
      duration_seconds: 8,
      ratio: "16:9",
      prompt_expansion: true,
    })
    assert.equal(submitted.model, ATLAS_MINIMAX_H3_MODEL)
    assert.equal(submitted.request_digest, calculated.request_digest)
    assert.deepEqual(client.calls.filter((call) => call.operation === "generateVideo").at(-1).body, calculatedRequest)
    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, calculateCountBeforeMutation + 1)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 1)
  } finally {
    await cleanup(root)
  }
})

test("Wan meaningful request changes invalidate the approved digest before billing or generation", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({ costs: [{ price: 0.42, estimated: true }, { price: 0.42, estimated: true }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    await runtime.media_upload({ asset_id: "speaker_front", manifest_path: manifestRequestPath })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_WAN_MODEL,
      prompt: "The speaker turns toward camera",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      duration_seconds: 8,
      resolution: "720p",
      ratio: "16:9",
      generate_audio: false,
      seed: 123,
    })
    const calculateCountBeforeGeneration = client.calls.filter((call) => call.operation === "calculate").length

    await assert.rejects(runtime.media_generate_video({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "video",
      model: ATLAS_WAN_MODEL,
      prompt: "The speaker turns toward camera",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      duration_seconds: 8,
      resolution: "1080p",
      ratio: "16:9",
      generate_audio: true,
      seed: 123,
      approved_request_digest: calculated.request_digest,
      approved_max_usd: 1,
    }), /request_digest does not match the approved request/)

    assert.equal(client.calls.filter((call) => call.operation === "calculate").length, calculateCountBeforeGeneration)
    assert.equal(client.calls.filter((call) => call.operation === "generateVideo").length, 0)
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
    await approveGeneration(root, calculated, 0.3)
    await assert.rejects(runtime.media_generate_video({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "video",
      prompt: "A slow product reveal",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      duration_seconds: 4,
    }), /socket dropped/)
    await assert.rejects(runtime.media_generate_video({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "video",
      prompt: "A slow product reveal",
      manifest_path: manifestRequestPath,
      reference_image_asset_ids: ["speaker_front"],
      duration_seconds: 4,
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
    await approveGeneration(root, calculated, 0.1)
    await assert.rejects(runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A premium speaker",
      manifest_path: manifestRequestPath,
    }), /connection closed/)
    await assert.rejects(runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A premium speaker",
      manifest_path: manifestRequestPath,
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

test("media_upload accepts manifest-bound MP3 and WAV audio assets", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    await addManifestProviderReferences(manifestPath)
    const client = fakeClient({ uploadURL: "https://atlas.example/uploads/audio-reference" })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const mp3 = await runtime.media_upload({
      asset_id: "voice_reference",
      manifest_path: manifestRequestPath,
      media_type: "audio",
    })
    const wav = await runtime.media_upload({
      asset_id: "music_reference",
      path: "references/music.wav",
      manifest_path: manifestRequestPath,
      media_type: "audio",
    })
    assert.equal(mp3.content_type, "audio/mpeg")
    assert.equal(wav.content_type, "audio/wav")
    assert.equal(mp3.size_bytes, Buffer.byteLength("mp3 fixture"))
    assert.equal(wav.size_bytes, Buffer.byteLength("wav fixture"))
    const uploadedFiles = client.calls
      .filter((call) => call.operation === "uploadMedia")
      .map((call) => call.formData.get("file"))
    assert.deepEqual(uploadedFiles.map((file) => [file.name, file.type]), [
      ["voice.mp3", "audio/mpeg"],
      ["music.wav", "audio/wav"],
    ])
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    assert.equal(manifest.assets.find((asset) => asset.asset_id === "voice_reference").metadata.atlascloud.content_type, "audio/mpeg")
    assert.equal(manifest.assets.find((asset) => asset.asset_id === "music_reference").metadata.atlascloud.content_type, "audio/wav")
  } finally {
    await cleanup(root)
  }
})

test("media_upload rejects mismatched manifest audio kinds and unsupported audio files before upload", async () => {
  const { root, manifestPath, manifestRequestPath } = await fixture()
  try {
    await writeFile(join(root, "references", "unsupported.flac"), Buffer.from("flac fixture"))
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.assets.push(
      {
        asset_id: "misdeclared_image",
        kind: "image",
        status: "ready",
        path: "references/voice.mp3",
        shot_ids: ["shot_01"],
      },
      {
        asset_id: "unsupported_audio",
        kind: "audio",
        status: "ready",
        path: "references/unsupported.flac",
        shot_ids: ["shot_01"],
      },
    )
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const client = fakeClient()
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    await assert.rejects(
      runtime.media_upload({ asset_id: "misdeclared_image", manifest_path: manifestRequestPath, media_type: "audio" }),
      /kind image does not match its media format/,
    )
    await assert.rejects(
      runtime.media_upload({ asset_id: "unsupported_audio", manifest_path: manifestRequestPath, media_type: "audio" }),
      /path must identify a supported image, video, or audio file/,
    )
    assert.equal(client.calls.filter((call) => call.operation === "uploadMedia").length, 0)
  } finally {
    await cleanup(root)
  }
})

test("media_upload accepts Atlas temporary URL response variants without weakening URL validation", async () => {
  const variants = [
    ["top-level download_url", { download_url: "https://example.invalid/reference.jpg" }],
    ["top-level url", { url: "https://example.invalid/reference.jpg" }],
    ["wrapped download_url", { data: { download_url: "https://example.invalid/reference.jpg" } }],
    ["wrapped url", { data: { url: "https://example.invalid/reference.jpg" } }],
    ["top-level provider_url", { provider_url: "https://example.invalid/reference.jpg" }],
  ]

  for (const [label, uploadResponse] of variants) {
    const { root, manifestPath } = await fixture()
    try {
      const runtime = createAtlasMediaRuntime({ directory: root, client: fakeClient({ uploadResponse }) })
      const result = await runtime.media_upload({ asset_id: "speaker_front", manifest_path: ROOT_MANIFEST_PATH })
      assert.equal(result.provider_url, "https://example.invalid/reference.jpg", label)
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
      assert.equal(manifest.assets[0].metadata.atlascloud.provider_url, "https://example.invalid/reference.jpg", label)
    } finally {
      await cleanup(root)
    }
  }

  const { root, manifestPath } = await fixture()
  try {
    const runtime = createAtlasMediaRuntime({ directory: root, client: fakeClient({ uploadResponse: { data: {} } }) })
    await assert.rejects(
      runtime.media_upload({ asset_id: "speaker_front", manifest_path: ROOT_MANIFEST_PATH }),
      /missing temporary URL/,
    )
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    assert.equal(manifest.assets[0].metadata, undefined)
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
    await approveGeneration(root, calculated, 0.1)
    const submitted = await runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A speaker",
      manifest_path: manifestRequestPath,
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
    await approveGeneration(root, calculated, 0.1)
    const submitted = await runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      prompt: "A speaker in the production manifest location",
      manifest_path: manifestRequestPath,
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
    await approveGeneration(root, calculated, 0.1)
    const submitted = await runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A speaker",
      manifest_path: manifestRequestPath,
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
    await approveGeneration(root, timeoutCalc, 0.1)
    const timeoutSubmit = await timeoutRuntime.media_generate_image({
      job_id: timeoutCalc.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A timeout speaker",
      manifest_path: manifestRequestPath,
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
    await approveGeneration(root, calculated, 0.1)
    const submitted = await runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A slow speaker",
      manifest_path: manifestRequestPath,
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

test("processing predictions may omit outputs until completion", async () => {
  const { root, manifestRequestPath } = await fixture()
  try {
    const client = fakeClient({ predictions: [{ status: "processing", outputs: null }] })
    const runtime = createAtlasMediaRuntime({ directory: root, client })
    const calculated = await runtime.media_calculate({
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A slow speaker",
      manifest_path: manifestRequestPath,
    })
    await approveGeneration(root, calculated, 0.1)
    const submitted = await runtime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A slow speaker",
      manifest_path: manifestRequestPath,
    })
    const processing = await runtime.media_prediction({
      job_id: submitted.job_id,
      manifest_path: manifestRequestPath,
    })
    assert.equal(processing.status, "processing")
    assert.equal(processing.output_asset_ids, undefined)
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
    await approveGeneration(root, calculated, 0.1)
    const submitted = await unknownRuntime.media_generate_image({
      job_id: calculated.job_id,
      shot_id: "shot_01",
      media_type: "image",
      prompt: "A speaker",
      manifest_path: manifestRequestPath,
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
    await approveGeneration(root, calculated, 0.3)
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
