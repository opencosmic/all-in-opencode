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
  assert.match(command, /ShotSpec\[\].*production routing/s)
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
  assert.match(skill, /^name: film-production$/m)
  assert.match(skill, /request -> creative intent -> shot decomposition -> ShotSpec\[\]/)
  assert.match(skill, /HyperFrames remains authoritative/i)
  assert.match(skill, /Atlas Cloud is currently the only implemented media provider/i)
  assert.match(skill, /media_calculate.*media_generate_image/s)
  assert.match(skill, /Curated media model routing/)
  assert.match(skill, /ordinary or value.*GPT Image 2.*premium, hero, or key visual.*GPT Image 2\.5 Sunburst/s)
  assert.match(skill, /photoreal or reference-led.*Seedream 5 Pro.*ordinary or balanced.*Wan 3\.0/s)
  assert.match(skill, /identity or quality-led.*MiniMax H3.*complex or multi-reference.*Seedance 2\.5/s)
  assert.match(skill, /explicitly supported user model choice wins/s)
  assert.match(skill, /no automatic paid fallback/s)
  assert.match(routing, /Curated media model defaults/)
  assert.match(routing, /GPT Image 2 for ordinary\/value images.*GPT Image 2\.5 Sunburst for\s+premium\/hero\/key visuals/s)
  assert.match(routing, /Wan 3\.0 for ordinary\/balanced video.*MiniMax H3 for identity\/quality\s+video.*Seedance 2\.5 for complex\/multi-reference/s)
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
    },
  }))
  assert.throws(
    () => validateShotSpec({ ...shot, references: ["speaker_front", "dark_studio"] }),
    /ShotSpec\.references must be an object/,
  )
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
