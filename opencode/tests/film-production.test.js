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

test("film-production is repository-owned and discoverable with focused references", async () => {
  const skillRoot = join(repository, "opencode/skills")
  const skill = await readFile(join(skillRoot, "film-production/SKILL.md"), "utf8")
  assert.match(skill, /^name: film-production$/m)
  assert.match(skill, /request -> creative intent -> shot decomposition -> ShotSpec\[\]/)
  assert.match(skill, /HyperFrames remains authoritative/i)
  assert.match(skill, /Atlas Cloud integration is deferred/i)
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
  const production = transitionProductionManifest(previs, "production")
  assert.equal(production.project.status, "production")
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
