import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  createProductionManifest,
  createShotSpec,
  isProductionManifest,
  isShotSpec,
  normalizeProductionManifest,
  transitionProductionManifest,
  validateProductionManifest,
  validateShotSpec,
} from "../plugins/film-production/contracts.js"
import { discoverSkills } from "../plugins/delegation/skill-resolver.js"

const repository = fileURLToPath(new URL("../..", import.meta.url))

const shot = {
  shot_id: "shot_03",
  purpose: "hero_reveal",
  duration_seconds: 6,
  subject: {
    id: "hornet",
    action: "fly_forward",
  },
  camera: {
    movement: "orbit",
    lens_mm: 50,
    arc_degrees: 70,
    framing_start: "medium_wide",
    framing_end: "close",
  },
  environment: { id: "sci_fi_hangar" },
  references: {
    subject: ["hornet_front", "hornet_three_quarter"],
  },
  control: { previs: "required" },
  generation: { intent: "cinematic_realistic" },
  output: { aspect_ratio: "16:9", fps: 24 },
}

test("/film is a thin Producer command for the film-production-first route", async () => {
  const command = await readFile(join(repository, "opencode/commands/film.md"), "utf8")
  assert.match(command, /^agent: Producer$/m)
  assert.match(command, /^subtask: false$/m)
  assert.match(command, /advanced AI filmmaking workflow/i)
  assert.match(command, /`film-production` skill/i)
  assert.match(command, /ShotSpec\[\].*blender-previs/s)
  assert.doesNotMatch(command, /Atlas Cloud|calculate|billing|endpoint/i)
  assert.ok(command.length < 1_200, "the command should remain a thin route declaration")
})

test("Producer keeps /video HyperFrames-first and /film film-production-first", async () => {
  const producer = await readFile(join(repository, "opencode/agents/producer.md"), "utf8")
  const video = await readFile(join(repository, "opencode/commands/video.md"), "utf8")
  assert.match(producer, /\/video\s+-> Producer -> HyperFrames-first workflow/)
  assert.match(producer, /\/film\s+-> Producer -> film-production -> ShotSpec\[\]/)
  assert.match(producer, /For `\/video`, load the official upstream `hyperframes` skill at the start/i)
  assert.match(producer, /For `\/film`, keep\s+`film-production` first/i)
  assert.match(producer, /load `hyperframes` only when film planning and\s+production routing are complete and composition\/render begins/i)
  assert.match(video, /At the start of the request, load and follow the official upstream\s+`hyperframes` skill/i)
})

test("film-production is repository-owned and discoverable with focused references", async () => {
  const skillRoot = join(repository, "opencode/skills")
  const skill = await readFile(join(skillRoot, "film-production/SKILL.md"), "utf8")
  const routing = await readFile(join(skillRoot, "film-production/references/production-routing.md"), "utf8")
  const manifestGuidance = await readFile(join(skillRoot, "film-production/references/production-manifest.md"), "utf8")
  const referenceAssets = await readFile(join(skillRoot, "film-production/references/reference-assets.md"), "utf8")
  assert.match(skill, /^name: film-production$/m)
  assert.match(skill, /request -> creative intent -> shot decomposition -> ShotSpec\[\]/)
  assert.match(skill, /HyperFrames remains authoritative/i)
  assert.match(skill, /Producer-only `blender-previs` category/i)
  assert.match(skill, /Before delegation, Producer prepares and verifies exactly the parent\s+directories required by the supplied previs artifact destinations/i)
  assert.match(skill, /`blender-previs` assumes those parents exist and\s+must fail clearly if one is missing/i)
  assert.match(skill, /Keep canonical artifact paths workspace-relative in ShotSpecs and the\s+ProductionManifest/i)
  assert.match(skill, /Producer resolves separate absolute runtime destinations\s+before delegation/i)
  assert.match(skill, /Only those absolute runtime values are passed as Blender destinations/i)
  assert.match(skill, /canonical relative values remain traceability only.*never persisted as\s+host-specific absolute paths/i)
  assert.match(skill, /prefer viewport\/OpenGL\/playblast,\s+then Workbench, then lightweight Eevee/i)
  assert.match(skill, /Do not use Cycles, high\s+samples, expensive denoising/i)
  assert.match(skill, /480×270 or lower by default.*720p maximum for\s+ordinary previs/s)
  assert.match(skill, /about 8–12 fps for moving previews.*Preserve each shot's\s+full duration/i)
  assert.match(skill, /For every shot requesting camera and\/or subject motion, `blender-previs` must\s+verify the requested animation before generating its preview MP4/s)
  assert.match(skill, /start frame,\s+middle frame `floor\(\(frame_start \+ frame_end\) \/ 2\)`, and end frame/s)
  assert.match(skill, /pan\/tilt may change orientation while location stays fixed/i)
  assert.match(skill, /locked\/static camera or fully static shot.*when that\s+motion was not requested/s)
  assert.match(skill, /Missing or inconsistent\s+requested motion blocks MP4 generation until the animation is corrected and\s+verified/s)
  assert.match(skill, /Watch remains\s+required after rendering to decide whether it looks correct/s)
  assert.match(skill, /MCP save\/render\/playblast call times out, treat completion as\s+ambiguous/i)
  assert.match(skill, /child reports the exact supplied paths and does not blindly\s+retry/i)
  assert.match(skill, /non-empty MP4\s+is preliminary until Watch can decode it/i)
  assert.match(skill, /video-analysis.*Watch.*Producer compares the\s+observed evidence.*PASS.*REVISION_REQUIRED/s)
  assert.match(skill, /Atlas Cloud is currently the only implemented media provider/i)
  assert.match(skill, /media_calculate.*media_generate_image/s)
  assert.match(skill, /Curated media model routing/)
  assert.match(skill, /ordinary or value.*GPT Image 2.*premium, hero, or key visual.*GPT Image 2\.5 Sunburst/s)
  assert.match(skill, /photoreal or reference-led.*Seedream 5 Pro.*ordinary or balanced.*Wan 3\.0/s)
  assert.match(skill, /identity or quality-led.*MiniMax H3.*complex or multi-reference.*Seedance 2\.5/s)
  assert.match(skill, /explicitly supported user model choice wins/s)
  assert.match(skill, /no automatic paid fallback/s)
  assert.match(routing, /Curated media model defaults/)
  assert.match(routing, /ShotSpec[\s\S]*blender-previs[\s\S]*video-analysis \/ Watch[\s\S]*media-generation calculate\/approval/)
  assert.match(routing, /\.blend[\s\S]*editable implementation source[\s\S]*not[\s\S]*review target/i)
  assert.match(routing, /GPT Image 2 for ordinary\/value images.*GPT Image 2\.5 Sunburst for\s+premium\/hero\/key visuals/s)
  assert.match(routing, /Wan 3\.0 for ordinary\/balanced video.*MiniMax H3 for identity\/quality\s+video.*Seedance 2\.5 for complex\/multi-reference/s)
  assert.match(skill, /reference_audio_asset_ids/)
  assert.match(routing, /H3 still requires an image or video[\s\S]*reference/s)
  assert.match(routing, /Seedance can use audio with visual references or as an audio-only[\s\S]*reference/s)
  assert.match(referenceAssets, /ordinary manifest asset shape.*image and video.*MP3 or WAV/s)
  assert.match(skill, /curated generation controls described in\s+\[production-routing\]/s)
  assert.match(routing, /Curated generation controls/)
  assert.match(routing, /generate_audio: false/)
  assert.match(routing, /Sunburst.*transparent.*PNG/s)
  assert.match(skill, /createProductionManifest\(\)/)
  assert.match(skill, /transitionProductionManifest\(\)/)
  assert.match(manifestGuidance, /never\s+mutate `project\.status` directly/i)
  assert.match(manifestGuidance, /revision` and `history`\s+coherent/i)
  for (const reference of [
    "cinematic-shotcraft",
    "shot-spec",
    "production-routing",
    "production-manifest",
    "reference-assets",
    "revision-routing",
  ]) await readFile(join(skillRoot, `film-production/references/${reference}.md`))

  const discovered = await discoverSkills({ directory: repository, roots: [skillRoot] })
  const entry = discovered.find((candidate) => candidate.name === "film-production")
  assert.ok(entry)
  assert.match(entry.description, /advanced AI filmmaking/i)
  assert.match(entry.content, /ProductionManifest/)
})

test("film-production keeps provider execution metadata outside canonical ShotSpec", async () => {
  const skill = await readFile(join(repository, "opencode/skills/film-production/SKILL.md"), "utf8")
  const shotSpec = await readFile(join(repository, "opencode/skills/film-production/references/shot-spec.md"), "utf8")
  assert.match(skill, /Keep the canonical `ShotSpec` provider-neutral/i)
  assert.match(skill, /transient routing plan/i)
  assert.match(skill, /ProductionManifest\.generation_jobs/i)
  assert.match(shotSpec, /Do not use `ShotSpec\.extensions` to persist provider\/model/i)
  assert.match(shotSpec, /reference_\*_asset_ids.*generate_audio/s)
  assert.match(shotSpec, /Only materialized or uploaded assets may\s+be passed/i)
})

test("ShotSpec validates the provider-neutral planning fields and keeps extensions possible", () => {
  const created = createShotSpec({ ...shot, extensions: { continuity: "left-to-right" } })
  assert.equal(created.schema_version, 1)
  assert.equal(created.shot_id, "shot_03")
  assert.equal(isShotSpec(created), true)
  assert.doesNotThrow(() => validateShotSpec(created))

  for (const invalid of [
    { ...shot, shot_id: "bad id" },
    { ...shot, duration_seconds: 0 },
    { ...shot, camera: { ...shot.camera, lens_mm: -1 } },
    { ...shot, output: { ...shot.output, fps: 0 } },
    { ...shot, control: { previs: "automatic" } },
  ]) {
    assert.throws(() => validateShotSpec(invalid), /ShotSpec|shot_03|must|previs/)
    assert.equal(isShotSpec(invalid), false)
  }
})

test("ShotSpec references use role-grouped arrays rather than a flat list", () => {
  assert.doesNotThrow(() => validateShotSpec({
    ...shot,
    references: {
      subject: ["speaker_front", "speaker_three_quarter"],
      environment: ["dark_studio"],
      audio: ["voice_reference"],
    },
  }))
  assert.throws(
    () => validateShotSpec({ ...shot, references: ["speaker_front", "dark_studio"] }),
    /ShotSpec\.references must be an object/,
  )
})

test("ProductionManifest accepts ordinary audio assets without changing the contract", () => {
  const audioShot = {
    ...shot,
    references: {
      subject: ["hornet_front"],
      audio: ["voice_reference"],
    },
  }
  const manifest = createProductionManifest({
    project: "audio-reference-film",
    shots: [audioShot],
    assets: [{
      asset_id: "voice_reference",
      kind: "audio",
      status: "ready",
      path: "references/voice.mp3",
      shot_ids: ["shot_03"],
    }],
    generation_jobs: [],
  })
  assert.equal(isProductionManifest(manifest), true)
  assert.doesNotThrow(() => validateProductionManifest(manifest))
})

test("ProductionManifest validates one resumable state and its lifecycle", () => {
  const manifest = createProductionManifest({
    project: "example-film",
    shots: [shot],
    assets: [{
      asset_id: "hornet_front",
      kind: "subject-reference",
      status: "ready",
      shot_ids: ["shot_03"],
    }],
    generation_jobs: [{
      job_id: "job_03",
      shot_id: "shot_03",
      status: "planned",
      request_digest: "digest-03",
    }],
  })
  assert.equal(manifest.project.status, "planning")
  assert.equal(manifest.revision, 0)
  assert.deepEqual(manifest.history, [])
  assert.equal(manifest.costs.estimated_usd, null)
  assert.equal(manifest.outputs.final, null)
  assert.equal(isProductionManifest(manifest), true)
  assert.doesNotThrow(() => validateProductionManifest(manifest))

  const previs = transitionProductionManifest(manifest, "previs", {
    at: "2026-09-20T00:00:00Z",
    note: "camera evidence required",
  })
  assert.equal(previs.project.status, "previs")
  assert.equal(previs.revision, 1)
  assert.equal(previs.history.at(-1).from, "planning")
  assert.equal(previs.history.at(-1).status, "previs")
  const production = transitionProductionManifest(previs, "production")
  assert.equal(production.project.status, "production")
  assert.equal(production.revision, 2)
  assert.deepEqual(
    production.history.map(({ from, status }) => `${from}->${status}`),
    ["planning->previs", "previs->production"],
  )
  assert.equal(normalizeProductionManifest(production).project.id, "example-film")
  assert.throws(() => transitionProductionManifest(manifest, "completed"), /cannot transition/)

  assert.throws(() => validateProductionManifest({ ...manifest, costs: { estimated_usd: "later" } }), /costs\.estimated_usd/)
  assert.throws(() => validateProductionManifest({ ...manifest, shots: [shot, shot] }), /duplicates shot_03/)

  const unknownAssetShot = structuredClone(manifest)
  unknownAssetShot.assets[0].shot_ids = ["missing-shot"]
  assert.throws(
    () => validateProductionManifest(unknownAssetShot),
    /asset "hornet_front" references unknown shot "missing-shot"/,
  )

  const unknownJobShot = structuredClone(manifest)
  unknownJobShot.generation_jobs[0].shot_id = "missing-shot"
  assert.throws(
    () => validateProductionManifest(unknownJobShot),
    /generation job "job_03" references unknown shot "missing-shot"/,
  )

  const duplicateAssets = structuredClone(manifest)
  duplicateAssets.assets.push(structuredClone(duplicateAssets.assets[0]))
  assert.throws(() => validateProductionManifest(duplicateAssets), /duplicates hornet_front/)

  const duplicateJobs = structuredClone(manifest)
  duplicateJobs.generation_jobs.push(structuredClone(duplicateJobs.generation_jobs[0]))
  assert.throws(() => validateProductionManifest(duplicateJobs), /duplicates job_03/)
})

test("ProductionManifest.shots stays a complete ShotSpec[] and lifecycle transitions remain canonical", () => {
  const manifest = createProductionManifest({
    project: "canonical-film",
    shots: [shot],
    assets: [],
    generation_jobs: [],
  })

  assert.doesNotThrow(() => validateProductionManifest(manifest))
  assert.throws(
    () => validateProductionManifest({ ...manifest, shots: [{ shot_id: "shot_03", route: "Blender" }] }),
    /ProductionManifest\.shots\[0\]\.purpose must be a non-empty string/,
  )

  const previs = transitionProductionManifest(manifest, "previs")
  assert.throws(
    () => transitionProductionManifest(previs, "assets-ready"),
    /cannot transition from previs to assets-ready/,
  )
  const production = transitionProductionManifest(previs, "production")
  const assetsReady = transitionProductionManifest(production, "assets-ready")
  const composition = transitionProductionManifest(assetsReady, "composition")
  const qa = transitionProductionManifest(composition, "qa")

  assert.deepEqual(
    qa.history.map(({ from, status }) => `${from}->${status}`),
    ["planning->previs", "previs->production", "production->assets-ready", "assets-ready->composition", "composition->qa"],
  )
  assert.equal(qa.revision, 5)
})

test("ProductionManifest validation enforces persisted lifecycle invariants", () => {
  const manifest = createProductionManifest({
    project: "lifecycle-film",
    shots: [shot],
    assets: [],
    generation_jobs: [],
  })

  const complete = ["previs", "production", "assets-ready", "composition", "qa", "completed"]
    .reduce((current, status) => transitionProductionManifest(current, status), manifest)
  assert.equal(complete.revision, 6)
  assert.equal(complete.history.length, 6)
  assert.doesNotThrow(() => validateProductionManifest(complete))

  const invalidInitialState = structuredClone(manifest)
  invalidInitialState.project.status = "qa"
  assert.throws(
    () => validateProductionManifest(invalidInitialState),
    /must be planning when history is empty/,
  )

  const invalidJump = structuredClone(manifest)
  invalidJump.project.status = "qa"
  invalidJump.revision = 1
  invalidJump.history = [{ from: "planning", status: "qa" }]
  assert.throws(
    () => validateProductionManifest(invalidJump),
    /cannot transition from planning to qa/,
  )

  const invalidStatus = structuredClone(manifest)
  invalidStatus.project.status = "banana"
  assert.throws(
    () => validateProductionManifest(invalidStatus),
    /project\.status must be one of/,
  )

  const brokenChain = structuredClone(manifest)
  brokenChain.project.status = "composition"
  brokenChain.revision = 2
  brokenChain.history = [
    { from: "planning", status: "previs" },
    { from: "production", status: "composition" },
  ]
  assert.throws(
    () => validateProductionManifest(brokenChain),
    /history\[1\]\.from must match previous status previs/,
  )

  const revisionMismatch = structuredClone(manifest)
  revisionMismatch.project.status = "production"
  revisionMismatch.revision = 99
  revisionMismatch.history = [
    { from: "planning", status: "previs" },
    { from: "previs", status: "production" },
  ]
  assert.throws(
    () => validateProductionManifest(revisionMismatch),
    /revision must equal history\.length/,
  )

  const currentStatusMismatch = structuredClone(manifest)
  currentStatusMismatch.project.status = "qa"
  currentStatusMismatch.revision = 1
  currentStatusMismatch.history = [{ from: "planning", status: "previs" }]
  assert.throws(
    () => validateProductionManifest(currentStatusMismatch),
    /project\.status must match history\[last\]\.status \(previs\)/,
  )
})
