import test from "node:test"
import assert from "node:assert/strict"
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"

import DelegationRuntimePlugin from "../plugins/delegation-runtime.js"
import { clearDelegationControlPlanesForTest } from "../plugins/delegation/control-plane.js"
import { DelegationRuntime } from "../plugins/delegation/runtime.js"
import {
  PRODUCTION_MANIFEST_VERSION,
  createProductionManifest,
  createShotSpec,
  normalizeProductionManifest,
  transitionProductionManifest,
  validateProductionManifest,
} from "../plugins/film-production/contracts.js"

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "production-control-test-"))
  const project = join(root, "project")
  await mkdir(project)
  const runtime = await DelegationRuntime.create({
    client: {}, directory: project, stateDirectory: join(root, "state"), skillEntries: [],
  })
  const producer = { agent: "Producer", sessionID: "producer", directory: project }
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, project, runtime, producer }
}

async function manifestAt(project) {
  return JSON.parse(await readFile(join(project, "production/production-manifest.json"), "utf8"))
}

function sampleShot(overrides = {}) {
  return createShotSpec({
    shot_id: "shot_01",
    purpose: "moving_fox_previs",
    duration_seconds: 5,
    subject: { id: "fox", action: "walk_across_frame" },
    camera: { movement: "tracking", lens_mm: 50, framing_start: "wide", framing_end: "medium" },
    environment: { id: "misty_forest" },
    control: { previs: "required" },
    output: { aspect_ratio: "16:9", fps: 24 },
    ...overrides,
  })
}

test("preflight creates one canonical manifest, resumes idempotently, and protects project identity", async (t) => {
  const { project, runtime, producer } = await fixture(t)
  await assert.rejects(runtime.productionPreflight({}, producer), /requires project_id/)
  await assert.rejects(lstat(join(project, "production")), { code: "ENOENT" })
  await assert.rejects(runtime.productionPreflight({ project_id: "bad id" }, producer), /project\.id/)

  const first = await runtime.productionPreflight({ project_id: "m2-smoke" }, producer)
  assert.equal(first.created, true)
  assert.equal(first.project_id, "m2-smoke")
  assert.equal(first.project_status, "planning")
  assert.equal(first.manifest_revision, 0)
  assert.equal(first.manifest.canonical_path, "production/production-manifest.json")
  assert.equal(first.workspace_root, await realpath(project))
  assert.equal(first.production_root, await realpath(join(project, "production")))
  assert.equal(first.manifest.runtime_path, join(first.production_root, "production-manifest.json"))
  assert.equal(first.latest_checkpoint, null)
  assert.equal(first.checkpoint_stale, false)
  const persisted = await manifestAt(project)
  validateProductionManifest(persisted)
  assert.equal(persisted.schema_version, PRODUCTION_MANIFEST_VERSION)
  assert.equal(persisted.latest_checkpoint, null)
  assert.equal(JSON.stringify(persisted).includes(first.workspace_root), false)

  const before = await readFile(first.manifest.runtime_path, "utf8")
  const second = await runtime.productionPreflight({}, producer)
  assert.equal(second.created, false)
  assert.equal(await readFile(first.manifest.runtime_path, "utf8"), before)
  await assert.rejects(runtime.productionPreflight({ project_id: "other" }, producer), /does not match canonical production/)
  assert.equal(await readFile(first.manifest.runtime_path, "utf8"), before)
})

test("preflight rejects invalid persisted state and production or manifest symlinks", async (t) => {
  const { root, project, runtime, producer } = await fixture(t)
  const outside = join(root, "outside")
  await mkdir(outside)
  await symlink(outside, join(project, "production"))
  await assert.rejects(runtime.productionPreflight({ project_id: "safe" }, producer), /production root must not be a symlink/)
  await rm(join(project, "production"))
  await mkdir(join(project, "production"))

  const manifestPath = join(project, "production/production-manifest.json")
  await symlink(join(outside, "external.json"), manifestPath)
  await assert.rejects(runtime.productionPreflight({ project_id: "safe" }, producer), /manifest must not be a symlink/)
  await rm(manifestPath)
  await writeFile(manifestPath, JSON.stringify({ project: { id: "safe", status: "planning" } }))
  await assert.rejects(runtime.productionPreflight({}, producer), /revision must be present/)
  assert.deepEqual(await manifestAt(project), { project: { id: "safe", status: "planning" } })
})

test("preflight resumes an existing valid production without changing lifecycle or costs", async (t) => {
  const { project, runtime, producer } = await fixture(t)
  await mkdir(join(project, "production"))
  const existing = transitionProductionManifest(createProductionManifest({
    project: "existing",
    costs: { estimated_usd: 1.25, approved_usd: null, actual_usd: null },
  }), "previs", { note: "Planning complete" })
  const path = join(project, "production/production-manifest.json")
  await writeFile(path, JSON.stringify(existing))
  const before = await readFile(path, "utf8")
  const result = await runtime.productionPreflight({}, producer)
  assert.equal(result.created, false)
  assert.equal(result.project_status, "previs")
  assert.equal(result.manifest_revision, 1)
  assert.equal(await readFile(path, "utf8"), before)
  assert.equal((await manifestAt(project)).costs.estimated_usd, 1.25)
  assert.deepEqual((await manifestAt(project)).history, existing.history)
})

test("artifact preparation makes exact safe parents and transient paths, never destination files", async (t) => {
  const { project, runtime, producer } = await fixture(t)
  await assert.rejects(runtime.productionPrepareArtifacts({ paths: ["production/previs/scene.blend"] }, producer), /run production_preflight first/)
  await runtime.productionPreflight({ project_id: "prep" }, producer)
  const result = await runtime.productionPrepareArtifacts({ paths: [
    "production/previs/shot-01/scene.blend",
    "production/previs/shot-01/preview.mp4",
  ] }, producer)
  assert.equal(result.artifacts.length, 2)
  assert.equal(result.artifacts[0].parent_runtime_path, result.artifacts[1].parent_runtime_path)
  for (const artifact of result.artifacts) {
    assert.equal(artifact.existed, false)
    assert.equal(isAbsolute(artifact.runtime_path), true)
    assert.equal(relative(await realpath(project), artifact.runtime_path).startsWith(".."), false)
    assert.equal((await lstat(artifact.parent_runtime_path)).isDirectory(), true)
    await assert.rejects(lstat(artifact.runtime_path), { code: "ENOENT" })
  }
  assert.equal((await lstat(join(project, "production/previs/shot-01"))).isDirectory(), true)
  await writeFile(result.artifacts[0].runtime_path, "existing scene")
  const revision = await runtime.productionPrepareArtifacts({ paths: [result.artifacts[0].canonical_path] }, producer)
  assert.equal(revision.artifacts[0].existed, true)
  assert.equal(await readFile(result.artifacts[0].runtime_path, "utf8"), "existing scene")
})

test("artifact preparation rejects unsafe canonical forms, symlinks, and non-file destinations", async (t) => {
  const { root, project, runtime, producer } = await fixture(t)
  await runtime.productionPreflight({ project_id: "safety" }, producer)
  for (const path of [
    "/tmp/scene.blend", "../production/scene.blend", "production/../outside.mp4",
    "production/./scene.blend", "production//scene.blend", "production/scene\\file.blend",
    "~/production/scene.blend", "C:\\production\\scene.blend", "other/scene.blend",
    "production/", "production/production-manifest.json",
  ]) {
    await assert.rejects(runtime.productionPrepareArtifacts({ paths: [path] }, producer), /safe canonical|reserved/, path)
  }
  const outside = join(root, "outside")
  await mkdir(outside)
  await mkdir(join(project, "production/previs"))
  await symlink(outside, join(project, "production/previs/escape"))
  await assert.rejects(runtime.productionPrepareArtifacts({ paths: ["production/previs/escape/scene.blend"] }, producer), /parent must not be a symlink/)
  await symlink(join(outside, "external.blend"), join(project, "production/previs/linked.blend"))
  await assert.rejects(runtime.productionPrepareArtifacts({ paths: ["production/previs/linked.blend"] }, producer), /destination must not be a symlink/)
  await mkdir(join(project, "production/previs/directory.blend"))
  await assert.rejects(runtime.productionPrepareArtifacts({ paths: ["production/previs/directory.blend"] }, producer), /destination must be a regular file/)
})

test("checkpoint replaces one bounded recovery state without changing lifecycle revision or history", async (t) => {
  const { project, runtime, producer } = await fixture(t)
  await assert.rejects(runtime.productionCheckpoint({}, producer), /run production_preflight first/)
  await runtime.productionPreflight({ project_id: "checkpoint" }, producer)
  const before = await manifestAt(project)
  const first = await runtime.productionCheckpoint({
    current_focus: "shot-01 previs",
    completed: ["planning established"],
    remaining: ["shot-01 previs"],
    verification: { shot_01: "PENDING", approved: false, count: 1 },
    important_artifacts: ["production/previs/shot-01/preview.mp4"],
  }, producer)
  const persisted = await manifestAt(project)
  validateProductionManifest(persisted)
  assert.deepEqual(persisted.latest_checkpoint, first.latest_checkpoint)
  assert.equal(first.latest_checkpoint.phase, "planning")
  assert.equal(new Date(first.latest_checkpoint.updated_at).toISOString(), first.latest_checkpoint.updated_at)
  assert.equal(persisted.project.status, before.project.status)
  assert.equal(persisted.revision, before.revision)
  assert.deepEqual(persisted.history, before.history)
  assert.equal((await runtime.productionPreflight({}, producer)).checkpoint_stale, false)

  const second = await runtime.productionCheckpoint({ current_focus: "approval boundary" }, producer)
  assert.deepEqual(second.latest_checkpoint.completed, [])
  assert.equal(second.latest_checkpoint.current_focus, "approval boundary")
  assert.deepEqual((await manifestAt(project)).latest_checkpoint, second.latest_checkpoint)
  assert.equal((await manifestAt(project)).revision, 0)
  for (const path of ["/tmp/preview.mp4", "production/../outside", "production/./preview.mp4", "production\\preview.mp4"]) {
    await assert.rejects(runtime.productionCheckpoint({ important_artifacts: [path] }, producer), /safe canonical/)
  }
  await assert.rejects(runtime.productionCheckpoint({ verification: { nested: { unsafe: true } } }, producer), /string, boolean, or number/)
  await assert.rejects(runtime.productionCheckpoint({ phase: "completed" }, producer), /does not accept phase/)
  await assert.rejects(runtime.productionCheckpoint({ updated_at: "2020-01-01T00:00:00.000Z" }, producer), /does not accept updated_at/)
  assert.deepEqual((await manifestAt(project)).latest_checkpoint, second.latest_checkpoint)

  const transitioned = transitionProductionManifest(await manifestAt(project), "previs")
  validateProductionManifest(transitioned)
  const manifestPath = join(project, "production/production-manifest.json")
  await writeFile(manifestPath, JSON.stringify(transitioned))
  const staleManifest = await readFile(manifestPath, "utf8")
  const resumed = await runtime.productionPreflight({}, producer)
  assert.equal(resumed.project_status, "previs")
  assert.equal(resumed.checkpoint_stale, true)
  assert.equal(resumed.latest_checkpoint.phase, "planning")
  assert.equal(await readFile(manifestPath, "utf8"), staleManifest)
  const refreshed = await runtime.productionCheckpoint({}, producer)
  assert.equal(refreshed.latest_checkpoint.phase, "previs")
  assert.equal((await runtime.productionPreflight({}, producer)).checkpoint_stale, false)
  assert.equal((await manifestAt(project)).revision, 1)
  assert.equal((await manifestAt(project)).history.length, 1)
})

test("blocked previs checkpoint records Watch and revision recovery without advancing lifecycle", async (t) => {
  const { project, runtime, producer } = await fixture(t)
  await runtime.productionPreflight({ project_id: "blocked-previs" }, producer)
  await runtime.productionSetShots({ shots: [sampleShot()] }, producer)
  await runtime.productionTransition({ to_status: "previs" }, producer)
  const before = await manifestAt(project)

  const result = await runtime.productionCheckpoint({
    current_focus: "Revise shot_01 gait after Watch identified sliding",
    completed: ["First-pass previs artifacts rendered", "Watch reviewed the shot and requested revision"],
    remaining: ["Complete or resume the blocked gait revision", "Return to Watch and require PASS"],
    verification: { status: "BLOCKED", revision_attempts: 1, watch_pass: false },
    important_artifacts: [
      "production/production-manifest.json",
      "production/previs/shot_01/shot_01.blend",
      "production/previs/shot_01/preview.mp4",
    ],
  }, producer)

  const blocked = await manifestAt(project)
  validateProductionManifest(blocked)
  assert.equal(result.project_status, "previs")
  assert.equal(result.latest_checkpoint.phase, "previs")
  assert.equal(blocked.project.status, "previs")
  assert.equal(blocked.latest_checkpoint.verification.status, "BLOCKED")
  assert.equal(blocked.revision, before.revision)
  assert.deepEqual(blocked.history, before.history)
  assert.equal((await runtime.productionPreflight({}, producer)).checkpoint_stale, false)
})

test("old manifests without checkpoint remain valid and normalize to null", () => {
  const old = createProductionManifest({ project: "legacy" })
  delete old.latest_checkpoint
  assert.doesNotThrow(() => validateProductionManifest(old))
  assert.equal(normalizeProductionManifest(old).latest_checkpoint, null)
  assert.equal(PRODUCTION_MANIFEST_VERSION, 1)
})

test("production_set_shots validates and replaces only canonical shots while preserving production state", async (t) => {
  const { project, runtime, producer } = await fixture(t)
  await assert.rejects(runtime.productionSetShots({ shots: [sampleShot()] }, producer), /run production_preflight first/)
  await runtime.productionPreflight({ project_id: "shots" }, producer)
  const initial = await runtime.productionSetShots({ shots: [sampleShot()] }, producer)
  assert.deepEqual(initial.shot_ids, ["shot_01"])
  assert.equal(initial.shot_count, 1)
  await runtime.productionTransition({ to_status: "previs" }, producer)
  await runtime.productionCheckpoint({ current_focus: "reviewing previs" }, producer)

  const path = join(project, "production/production-manifest.json")
  const withExistingState = await manifestAt(project)
  withExistingState.assets.push({ asset_id: "fox_reference", shot_ids: ["shot_01"] })
  withExistingState.generation_jobs.push({ job_id: "later_generation", shot_id: "shot_01", status: "planned" })
  withExistingState.costs = { estimated_usd: 2, approved_usd: 3, actual_usd: 0 }
  await writeFile(path, JSON.stringify(withExistingState))

  const replacement = sampleShot({
    purpose: "fox_crosses_the_clearing",
    subject: { id: "fox", action: "walk from left to right" },
  })
  const before = await manifestAt(project)
  const result = await runtime.productionSetShots({ shots: [replacement] }, producer)
  const after = await manifestAt(project)
  validateProductionManifest(after)
  assert.equal(result.project_status, before.project.status)
  assert.equal(result.manifest_revision, before.revision)
  assert.equal(after.project.status, before.project.status)
  assert.equal(after.revision, before.revision)
  assert.deepEqual(after.history, before.history)
  assert.deepEqual(after.latest_checkpoint, before.latest_checkpoint)
  assert.deepEqual(after.assets, before.assets)
  assert.deepEqual(after.generation_jobs, before.generation_jobs)
  assert.deepEqual(after.costs, before.costs)
  assert.deepEqual(after.shots, [replacement])
  assert.deepEqual(result.manifest, {
    canonical_path: "production/production-manifest.json",
    runtime_path: await realpath(path),
  })
})

test("production_set_shots rejects invalid ShotSpecs without writing and accepts a corrected retry", async (t) => {
  const { project, runtime, producer } = await fixture(t)
  await runtime.productionPreflight({ project_id: "shot-validation" }, producer)
  const original = await readFile(join(project, "production/production-manifest.json"), "utf8")
  const invalid = {
    ...sampleShot(),
    camera: { ...sampleShot().camera, framing_end: "x".repeat(121) },
  }
  await assert.rejects(runtime.productionSetShots({ shots: [invalid] }, producer), (error) => {
    assert.match(error.message, /ProductionManifest\.shots\[0\]\.camera\.framing_end must be at most 120 characters/)
    return true
  })
  assert.equal(await readFile(join(project, "production/production-manifest.json"), "utf8"), original)

  const valid = sampleShot({ generation: { intent: "Create a provider-neutral previs reference" } })
  const invalidGeneration = { ...valid, generation: { intent: "x".repeat(241) } }
  await assert.rejects(runtime.productionSetShots({ shots: [invalidGeneration] }, producer), /ProductionManifest\.shots\[0\]\.generation\.intent must be at most 240 characters/)
  assert.equal(await readFile(join(project, "production/production-manifest.json"), "utf8"), original)

  const accepted = await runtime.productionSetShots({ shots: [valid] }, producer)
  assert.deepEqual(accepted.shot_ids, ["shot_01"])
  assert.deepEqual((await manifestAt(project)).shots, [valid])
})

test("production_set_shots rejects invalid current state, arbitrary fields, and manifest symlinks", async (t) => {
  const { root, project, runtime, producer } = await fixture(t)
  await assert.rejects(runtime.productionSetShots({ shots: [sampleShot()], status: "production" }, producer), /does not accept status/)
  await runtime.productionPreflight({ project_id: "bad-current" }, producer)
  const path = join(project, "production/production-manifest.json")
  const before = await readFile(path, "utf8")
  await assert.rejects(runtime.productionSetShots({ shots: [sampleShot()], history: [] }, producer), /does not accept history/)
  assert.equal(await readFile(path, "utf8"), before)

  await writeFile(path, JSON.stringify({ project: { id: "bad-current", status: "planning" } }))
  const invalidCurrent = await readFile(path, "utf8")
  await assert.rejects(runtime.productionSetShots({ shots: [sampleShot()] }, producer), /revision must be present/)
  assert.equal(await readFile(path, "utf8"), invalidCurrent)

  await writeFile(path, before)
  const outside = join(root, "manifest-outside.json")
  await writeFile(outside, before)
  await rm(path)
  await symlink(outside, path)
  await assert.rejects(runtime.productionSetShots({ shots: [sampleShot()] }, producer), /manifest must not be a symlink/)
})

test("production_transition reuses legal lifecycle semantics and preserves non-lifecycle fields", async (t) => {
  const { project, runtime, producer } = await fixture(t)
  await assert.rejects(runtime.productionTransition({ to_status: "previs" }, producer), /run production_preflight first/)
  await runtime.productionPreflight({ project_id: "transition" }, producer)
  await runtime.productionSetShots({ shots: [sampleShot()] }, producer)
  await runtime.productionCheckpoint({ current_focus: "plan ready" }, producer)
  const path = join(project, "production/production-manifest.json")
  const before = await manifestAt(project)
  const first = await runtime.productionTransition({ to_status: "previs", note: "Director plan accepted" }, producer)
  const previs = await manifestAt(project)
  validateProductionManifest(previs)
  assert.equal(first.previous_status, "planning")
  assert.equal(first.status, "previs")
  assert.equal(first.revision, 1)
  assert.deepEqual(first.history_entry, previs.history.at(-1))
  assert.equal(previs.revision, previs.history.length)
  assert.deepEqual(previs.shots, before.shots)
  assert.deepEqual(previs.assets, before.assets)
  assert.deepEqual(previs.generation_jobs, before.generation_jobs)
  assert.deepEqual(previs.costs, before.costs)
  assert.deepEqual(previs.latest_checkpoint, before.latest_checkpoint)
  assert.deepEqual(previs.history.at(-1), {
    at: previs.updated_at,
    from: "planning",
    status: "previs",
    note: "Director plan accepted",
  })

  const beforeIllegal = await readFile(path, "utf8")
  await assert.rejects(runtime.productionTransition({ to_status: "completed" }, producer), /cannot transition from previs to completed/)
  assert.equal(await readFile(path, "utf8"), beforeIllegal)

  const second = await runtime.productionTransition({ to_status: "production" }, producer)
  const production = await manifestAt(project)
  validateProductionManifest(production)
  assert.equal(second.previous_status, "previs")
  assert.equal(second.status, "production")
  assert.equal(production.revision, production.history.length)
  assert.deepEqual(production.shots, before.shots)
  assert.deepEqual(production.latest_checkpoint, before.latest_checkpoint)
})

test("production_transition supports planning to production and leaves invalid current state untouched", async (t) => {
  const { project, runtime, producer } = await fixture(t)
  await runtime.productionPreflight({ project_id: "direct-production" }, producer)
  const direct = await runtime.productionTransition({ to_status: "production" }, producer)
  assert.equal(direct.previous_status, "planning")
  assert.equal(direct.status, "production")
  assert.equal(direct.revision, 1)

  const path = join(project, "production/production-manifest.json")
  await writeFile(path, JSON.stringify({ project: { id: "direct-production", status: "production" } }))
  const invalid = await readFile(path, "utf8")
  await assert.rejects(runtime.productionTransition({ to_status: "assets-ready" }, producer), /revision must be present/)
  assert.equal(await readFile(path, "utf8"), invalid)
  await assert.rejects(runtime.productionTransition({ to_status: "qa", revision: 20 }, producer), /does not accept revision/)
})

test("runtime denies production tools to non-Producers and delegated children", async (t) => {
  const { runtime, producer } = await fixture(t)
  const operations = [
    ["productionPreflight", { project_id: "denied" }],
    ["productionPrepareArtifacts", { paths: ["production/previs/a.blend"] }],
    ["productionCheckpoint", {}],
    ["productionSetShots", { shots: [sampleShot()] }],
    ["productionTransition", { to_status: "previs" }],
  ]
  for (const agent of ["Director", "Creator", "Editor", "Implementer", "Assistant", "Executor", "Planner", "Strategist", "Blender", "Searcher", "Browser"]) {
    for (const [name, args] of operations) {
      await assert.rejects(runtime[name](args, { ...producer, agent }), /may only be called by the primary Producer/, `${agent} ${name}`)
    }
  }
  runtime.profiles.set("delegated-child", { agent: "Director", category: null })
  await assert.rejects(runtime.productionPreflight({ project_id: "denied" }, { ...producer, sessionID: "delegated-child" }), /may only be called by the primary Producer/)
  await assert.rejects(runtime.productionSetShots({ shots: [] }, { ...producer, sessionID: "delegated-child" }), /may only be called by the primary Producer/)
  await assert.rejects(runtime.productionTransition({ to_status: "previs" }, { ...producer, sessionID: "delegated-child" }), /may only be called by the primary Producer/)
})

test("registered plugin tools complete a zero-cost production smoke in an ordinary directory", async (t) => {
  clearDelegationControlPlanesForTest()
  const root = await mkdtemp(join(tmpdir(), "production-plugin-smoke-"))
  const project = join(root, "project")
  await mkdir(project)
  t.after(async () => {
    clearDelegationControlPlanesForTest()
    await rm(root, { recursive: true, force: true })
  })
  const plugin = await DelegationRuntimePlugin({
    client: {}, directory: project, serverUrl: new URL("http://127.0.0.1:40311"),
  }, { stateDirectory: join(root, "state"), aioConfig: { version: 1 }, skillRoots: [] })
  const context = { agent: "Producer", sessionID: "smoke-producer", directory: project }
  const preflight = JSON.parse(await plugin.tool.production_preflight.execute({ project_id: "m2-smoke" }, context))
  assert.equal(preflight.created, true)
  const shots = JSON.parse(await plugin.tool.production_set_shots.execute({ shots: [sampleShot()] }, context))
  assert.deepEqual(shots.shot_ids, ["shot_01"])
  const transition = JSON.parse(await plugin.tool.production_transition.execute({ to_status: "previs" }, context))
  assert.equal(transition.status, "previs")
  const prepared = JSON.parse(await plugin.tool.production_prepare_artifacts.execute({ paths: [
    "production/previs/shot-01/scene.blend", "production/previs/shot-01/preview.mp4",
  ] }, context))
  assert.equal(prepared.artifacts.length, 2)
  for (const artifact of prepared.artifacts) {
    assert.equal(isAbsolute(artifact.runtime_path), true)
    assert.equal((await lstat(artifact.parent_runtime_path)).isDirectory(), true)
    await assert.rejects(lstat(artifact.runtime_path), { code: "ENOENT" })
  }
  const checkpoint = JSON.parse(await plugin.tool.production_checkpoint.execute({
    current_focus: "shot-01 previs", remaining: ["render preview"],
  }, context))
  assert.equal(checkpoint.latest_checkpoint.phase, "previs")
  const persisted = await manifestAt(project)
  validateProductionManifest(persisted)
  assert.equal(persisted.revision, 1)
  assert.equal(persisted.history.length, 1)
  const resumed = JSON.parse(await plugin.tool.production_preflight.execute({}, context))
  assert.equal(resumed.created, false)
  assert.deepEqual(resumed.latest_checkpoint, checkpoint.latest_checkpoint)
})

test("Director plan handoff keeps Producer path and lifecycle authority", async (t) => {
  const { project, runtime, producer } = await fixture(t)
  await runtime.productionPreflight({ project_id: "director-handoff" }, producer)
  const manifestPath = join(project, "production/production-manifest.json")
  const plan = {
    status: "DIRECTOR_PLAN_READY",
    shots: [sampleShot()],
    canonical_artifacts: [
      "production/previs/shot_01/shot_01.blend",
      "production/previs/shot_01/start.png",
      "production/previs/shot_01/mid.png",
      "production/previs/shot_01/end.png",
      "production/previs/shot_01/preview.mp4",
    ],
  }
  await runtime.productionSetShots({ shots: plan.shots }, producer)
  await runtime.productionTransition({ to_status: "previs" }, producer)
  const preparation = await runtime.productionPrepareArtifacts({ paths: plan.canonical_artifacts }, producer)
  assert.deepEqual(preparation.artifacts.map((artifact) => artifact.canonical_path), plan.canonical_artifacts)
  for (const artifact of preparation.artifacts) {
    assert.equal(isAbsolute(artifact.runtime_path), true)
    await assert.rejects(lstat(artifact.runtime_path), { code: "ENOENT" })
  }
  await assert.rejects(runtime.productionPrepareArtifacts({ paths: plan.canonical_artifacts }, {
    ...producer, agent: "Director",
  }), /may only be called by the primary Producer/)
  assert.equal((await manifestAt(project)).project.status, "previs")

  await runtime.productionTransition({ to_status: "production", note: "Director previs PASS" }, producer)
  await runtime.productionCheckpoint({ completed: ["Director plan", "shot_01 previs PASS"],
    remaining: ["generation strategy"], important_artifacts: plan.canonical_artifacts }, producer)
  const final = await manifestAt(project)
  validateProductionManifest(final)
  assert.equal(final.project.status, "production")
  assert.equal(final.revision, 2)
  assert.equal(final.history.length, 2)
  assert.equal(final.latest_checkpoint.phase, "production")
  assert.deepEqual(final.shots, plan.shots)
  assert.equal(Object.hasOwn(final, "canonical_artifacts"), false)
})
