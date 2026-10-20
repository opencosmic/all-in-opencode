import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ATLAS_WAN_MODEL, createAtlasMediaRuntime } from "../plugins/delegation/media-runtime.js"
import { DelegationRuntime } from "../plugins/delegation/runtime.js"
import { delegationPluginHooks } from "../plugins/delegation/plugin-hooks.js"
import { createShotSpec, validateProductionManifest } from "../plugins/film-production/contracts.js"

const MANIFEST_PATH = "production/production-manifest.json"

function smokeShot() {
  return createShotSpec({
    shot_id: "shot_01",
    purpose: "Generate and review one fox shot",
    duration_seconds: 5,
    subject: { id: "fox", action: "move clearly across frame" },
    camera: { movement: "gentle tracking", lens_mm: 50, framing_start: "wide", framing_end: "medium" },
    environment: { id: "misty_dawn_forest" },
    references: { subject: ["fox_reference"] },
    control: { previs: "optional" },
    output: { aspect_ratio: "16:9", fps: 24 },
  })
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "aio-m4-creator-smoke-"))
  const project = join(root, "project")
  const skillsRoot = join(root, "skills")
  const filmSkill = join(skillsRoot, "film-production")
  const watchSkill = join(skillsRoot, "watch")
  await mkdir(join(project, "production"), { recursive: true })
  await mkdir(join(filmSkill, "references"), { recursive: true })
  await mkdir(join(watchSkill, "scripts"), { recursive: true })
  await writeFile(join(filmSkill, "SKILL.md"), "---\nname: film-production\ndescription: M4 smoke\n---\nUse the routing reference.\n")
  await writeFile(join(filmSkill, "references", "production-routing.md"), "Creator owns model routing.\n")
  await writeFile(join(watchSkill, "SKILL.md"), "---\nname: watch\ndescription: Watch smoke fixture\n---\nReview the generated output.\n")
  await writeFile(join(watchSkill, "scripts", "watch.py"), "# zero-cost Watch permission fixture\n")

  const clientState = { created: [], prompts: [] }
  const client = {
    state: clientState,
    session: {
      create: async (request) => {
        clientState.created.push(request)
        return { data: { id: `m4-child-${clientState.created.length}` } }
      },
      promptAsync: async (request) => {
        clientState.prompts.push(request)
        return { data: undefined }
      },
      abort: async () => ({ data: true }),
      status: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
    },
  }

  const atlasCalls = []
  const atlasClient = {
    calculate: async (body) => {
      atlasCalls.push({ operation: "calculate", body: structuredClone(body) })
      return { data: { price: 0, origin_price: 0, discount: 0, estimated: false } }
    },
    generateVideo: async (body) => {
      atlasCalls.push({ operation: "generateVideo", body: structuredClone(body) })
      return { data: { id: "mock-prediction-01", status: "processing" } }
    },
    generateImage: async (body) => {
      atlasCalls.push({ operation: "generateImage", body: structuredClone(body) })
      return { data: { id: "mock-image-prediction-01", status: "processing" } }
    },
    prediction: async (predictionID) => {
      atlasCalls.push({ operation: "prediction", predictionID })
      return { data: { id: predictionID, status: "completed", outputs: ["https://atlas.example/mock-output.mp4"] } }
    },
    uploadMedia: async () => {
      throw new Error("this smoke does not upload or use external reference media")
    },
    download: async (url) => {
      atlasCalls.push({ operation: "download", url })
      return { bytes: Buffer.from("mock mp4 bytes"), contentType: "video/mp4", sizeBytes: 14 }
    },
  }

  const runtime = await DelegationRuntime.create({
    client,
    directory: project,
    stateDirectory: join(root, "state"),
    skillRoots: [skillsRoot],
  })
  runtime.mediaRuntime = createAtlasMediaRuntime({ directory: project, client: atlasClient })
  const producer = {
    agent: "Producer",
    sessionID: "m4-producer-primary",
    messageID: "m4-producer-turn",
    directory: project,
  }
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, project, filmSkill, watchSkill, runtime, clientState, atlasCalls, producer }
}

test("headless M4 smoke routes media through Creator and keeps approval and manifest control with Producer", async (t) => {
  const { project, watchSkill, runtime, clientState, atlasCalls, producer } = await fixture(t)
  const tools = delegationPluginHooks(runtime).tool
  const shot = smokeShot()

  await tools.production_preflight.execute({ project_id: "m4-smoke" }, producer)
  await tools.production_set_shots.execute({ shots: [shot] }, producer)
  await tools.production_transition.execute({ to_status: "production" }, producer)

  await assert.rejects(
    runtime.delegate({
      category: "media-generation",
      description: "Producer direct media route must be closed",
      prompt: "Do not execute",
      run_in_background: true,
    }, producer),
    /Producer is not allowed to delegate category media-generation/,
  )

  const creatorResult = await tools.delegate_task.execute({
    agent: "Creator",
    description: "Creator generated-media phase",
    prompt: "Plan and coordinate one generated shot; return for Producer approval before submission.",
    load_skills: ["film-production"],
    run_in_background: true,
  }, producer)
  const creatorTask = JSON.parse(creatorResult)
  const creatorID = creatorTask.child_session_id
  assert.equal(clientState.prompts.at(-1).body.agent, "Creator")
  assert.match(clientState.prompts.at(-1).body.system, /Use the routing reference/)

  const creatorContext = {
    agent: "Creator",
    sessionID: creatorID,
    messageID: "m4-creator-turn",
    directory: project,
  }
  await assert.rejects(runtime.delegate({
    category: "blender-previs",
    description: "Creator must not own previs",
    prompt: "Do not execute",
    run_in_background: true,
  }, creatorContext), /Creator is not allowed to delegate category blender-previs/)
  for (const agent of ["Director", "Editor", "Blender"]) {
    await assert.rejects(runtime.delegate({
      agent,
      description: `Creator cannot delegate ${agent}`,
      prompt: "Do not execute",
      run_in_background: true,
    }, creatorContext), /cannot delegate named agent/)
  }

  const manifestBeforeCreatorControlAttempts = await readFile(join(project, MANIFEST_PATH), "utf8")
  for (const [name, call] of [
    ["production_preflight", () => runtime.productionPreflight({}, creatorContext)],
    ["production_prepare_artifacts", () => runtime.productionPrepareArtifacts({ paths: ["production/example.bin"] }, creatorContext)],
    ["production_checkpoint", () => runtime.productionCheckpoint({}, creatorContext)],
    ["production_approve_generation", () => runtime.productionApproveGeneration({}, creatorContext)],
    ["production_set_shots", () => runtime.productionSetShots({ shots: [shot] }, creatorContext)],
    ["production_transition", () => runtime.productionTransition({ to_status: "assets-ready" }, creatorContext)],
  ]) await assert.rejects(call(), /may only be called by the primary Producer/, name)
  assert.equal(
    await readFile(join(project, MANIFEST_PATH), "utf8"),
    manifestBeforeCreatorControlAttempts,
    "Creator control-plane attempts must not mutate ShotSpecs, approval state, project status, or checkpoint",
  )

  const directCalculate = tools.media_calculate.execute({
    media_type: "video",
    shot_id: shot.shot_id,
    prompt: "A red fox wearing a distinctive blue scarf moves through a misty dawn forest clearing.",
    manifest_path: MANIFEST_PATH,
    model: ATLAS_WAN_MODEL,
    duration_seconds: 5,
    resolution: "480p",
    ratio: "16:9",
    generate_audio: false,
  }, { sessionID: creatorID })
  await assert.rejects(directCalculate, /require an Implementer child in category=media-generation/)
  await assert.rejects(tools.media_calculate.execute({
    media_type: "video",
    shot_id: shot.shot_id,
    prompt: "A red fox.",
    manifest_path: MANIFEST_PATH,
    model: ATLAS_WAN_MODEL,
    duration_seconds: 5,
  }, producer), /require an Implementer child in category=media-generation/)

  const mediaTaskResult = await tools.delegate_task.execute({
    category: "media-generation",
    description: "Calculate one Creator request",
    prompt: "Calculate the exact request and return its price, estimate flag, digest, and job ID. Do not submit without Producer approval.",
    run_in_background: true,
  }, creatorContext)
  const mediaTask = JSON.parse(mediaTaskResult)
  assert.equal(runtime.registry.get(mediaTask.task_id).parent_agent, "Creator")
  assert.equal(runtime.profiles.get(mediaTask.child_session_id).category, "media-generation")

  const request = {
    media_type: "video",
    shot_id: shot.shot_id,
    prompt: "A red fox wearing a distinctive blue scarf moves through a misty dawn forest clearing.",
    manifest_path: MANIFEST_PATH,
    model: ATLAS_WAN_MODEL,
    duration_seconds: 5,
    resolution: "480p",
    ratio: "16:9",
    generate_audio: false,
  }
  const quote = JSON.parse(await tools.media_calculate.execute(request, { sessionID: mediaTask.child_session_id }))
  assert.equal(quote.price_usd, 0)
  assert.equal(quote.estimated, false)
  assert.match(quote.request_digest, /^[a-f0-9]{64}$/)

  await assert.rejects(tools.media_generate_video.execute({
    ...request,
    job_id: quote.job_id,
    approved_request_digest: quote.request_digest,
    approved_max_usd: 0.25,
  }, { sessionID: mediaTask.child_session_id }), /is calculated and cannot be submitted again/)
  assert.equal(atlasCalls.some((call) => call.operation === "generateVideo"), false)

  const persistedApproval = JSON.parse(await tools.production_approve_generation.execute({
    job_id: quote.job_id,
    request_digest: quote.request_digest,
    approved_max_usd: 0,
  }, producer))
  assert.equal(persistedApproval.status, "awaiting_approval")
  const approvedManifest = JSON.parse(await readFile(join(project, MANIFEST_PATH), "utf8"))
  assert.equal(approvedManifest.generation_jobs[0].approved_price_usd, 0)
  assert.equal(approvedManifest.generation_jobs[0].approved_max_usd, 0)

  const submission = JSON.parse(await tools.media_generate_video.execute({
    ...request,
    job_id: quote.job_id,
  }, { sessionID: mediaTask.child_session_id }))
  assert.equal(submission.status, "submitted")
  assert.equal(atlasCalls.filter((call) => call.operation === "calculate").length, 2)
  assert.equal(atlasCalls.filter((call) => call.operation === "generateVideo").length, 1)
  const completed = JSON.parse(await tools.media_wait_prediction.execute({
    job_id: submission.job_id,
    manifest_path: MANIFEST_PATH,
    interval_ms: 250,
    timeout_ms: 1_000,
  }, { sessionID: mediaTask.child_session_id }))
  assert.equal(completed.status, "completed")
  assert.equal(completed.output_paths.length, 1)

  const creatorWatchTask = await tools.delegate_task.execute({
    category: "video-analysis",
    description: "Creator reviews generated output",
    prompt: `Use Watch to review ${completed.output_paths[0]} against the ShotSpec and report PASS, REVISION_REQUIRED, or BLOCKED.`,
    load_skills: ["watch"],
    run_in_background: true,
  }, creatorContext)
  const watchTask = JSON.parse(creatorWatchTask)
  assert.equal(runtime.registry.get(watchTask.task_id).parent_agent, "Creator")
  assert.equal(runtime.profiles.get(watchTask.child_session_id).category, "video-analysis")
  assert.match(clientState.prompts.at(-1).body.system, /Review the generated output/)
  const watchScript = join(watchSkill, "scripts", "watch.py")
  const watchPermission = { status: "ask" }
  await runtime.applyPermission({
    sessionID: watchTask.child_session_id,
    permission: "bash",
    pattern: `python3 ${watchScript} ${completed.output_paths[0]}`,
  }, watchPermission)
  assert.equal(watchPermission.status, "allow")

  const manifest = JSON.parse(await readFile(join(project, MANIFEST_PATH), "utf8"))
  validateProductionManifest(manifest)
  assert.equal(manifest.project.status, "production")
  assert.equal(manifest.generation_jobs[0].status, "completed")
  assert.equal(manifest.assets[0].status, "ready")
  assert.equal(manifest.assets[0].path, completed.output_paths[0])

  await assert.rejects(tools.production_checkpoint.execute({
    current_focus: "Creator generated media",
  }, { ...creatorContext }), /may only be called by the primary Producer/)
  await tools.production_transition.execute({ to_status: "assets-ready" }, producer)
  await tools.production_checkpoint.execute({
    current_focus: "M4 generated-media handoff",
    completed: ["Creator generated and reviewed the required shot"],
    remaining: ["Editor composition", "final QA"],
    verification: { creator_watch: "PASS", atlas_paid_calls: 0 },
    important_artifacts: [completed.output_paths[0]],
  }, producer)
  const finalManifest = JSON.parse(await readFile(join(project, MANIFEST_PATH), "utf8"))
  assert.equal(finalManifest.project.status, "assets-ready")
  assert.equal(finalManifest.latest_checkpoint.phase, "assets-ready")
  assert.deepEqual(finalManifest.latest_checkpoint.remaining, ["Editor composition", "final QA"])
  assert.equal(atlasCalls.filter((call) => ["generateImage", "generateVideo"].includes(call.operation)).length, 1)
})
