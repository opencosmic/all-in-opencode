import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { applyFilmProductionEditorPermissions } from "../plugins/delegation/category-permissions.js"
import { finalRenderApprovalAllows, prepareEditorVideoProject } from "../plugins/delegation/production-control.js"
import { updateProductionManifest } from "../plugins/delegation/production-manifest-store.js"
import { DelegationRuntime } from "../plugins/delegation/runtime.js"
import { createShotSpec, validateProductionManifest } from "../plugins/film-production/contracts.js"

const rough = "production/outputs/rough-cut.mp4"
const final = "production/outputs/final.mp4"
const composition = "production/composition"
const approval = { project_path: composition, final_path: final }
const finalCommand = `npx hyperframes render ${composition} --output ${final} --quality delivery --fps 24 --workers 1`
const draftCommand = `npx hyperframes render ${composition} --output ${rough} --quality draft --fps 8 --workers 1`

async function fixture(t, { compose = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "aio-m5-test-"))
  const project = await realpath(root)
  let childIndex = 0
  const client = { session: {
    create: async () => ({ data: { id: `m5-editor-from-runtime-${++childIndex}` } }),
    promptAsync: async () => ({ data: undefined }),
    abort: async () => ({ data: true }),
    status: async () => ({ data: {} }),
    messages: async () => ({ data: [] }),
  } }
  const runtime = await DelegationRuntime.create({ client, directory: project, stateDirectory: join(root, ".state"), skillEntries: [] })
  const producer = { agent: "Producer", sessionID: `${root}-producer`, directory: project }
  const editorID = `${root}-editor`
  runtime.profiles.set(editorID, { agent: "Editor", category: null, directory: project, film_composition_context: true })
  t.after(async () => {
    runtime.profiles.delete(editorID)
    await rm(root, { recursive: true, force: true })
  })
  const manifestPath = join(project, "production/production-manifest.json")
  const load = async () => JSON.parse(await readFile(manifestPath, "utf8"))
  const patch = async (update) => updateProductionManifest(manifestPath, update)
  await runtime.productionPreflight({ project_id: "m5-fixture" }, producer)
  const shots = [1, 2].map((index) => createShotSpec({
    shot_id: `shot_0${index}`, purpose: "Synthetic composition fixture", duration_seconds: 3,
    subject: { id: `shape_${index}`, action: "moves across frame" },
    camera: { movement: "static", lens_mm: 50, framing_start: "wide", framing_end: "wide" },
    environment: { id: "synthetic_studio" }, output: { aspect_ratio: "16:9", fps: 24 },
  }))
  await runtime.productionSetShots({ shots }, producer)
  await runtime.productionPrepareArtifacts({ paths: ["production/assets/one.mp4", "production/assets/two.mp4", `${composition}/index.html`, rough, final] }, producer)
  await writeFile(join(project, "production/assets/one.mp4"), "test-only media bytes one")
  await writeFile(join(project, "production/assets/two.mp4"), "test-only media bytes two")
  await writeFile(join(project, composition, "index.html"), "<!doctype html><title>test</title>")
  await patch((manifest) => {
    manifest.assets = shots.map((shot, index) => ({ asset_id: `asset_${index}`, kind: "video", status: "ready", shot_ids: [shot.shot_id], path: `production/assets/${index ? "two" : "one"}.mp4` }))
  })
  await runtime.productionTransition({ to_status: "production" }, producer)
  await runtime.productionTransition({ to_status: "assets-ready" }, producer)
  if (compose) {
    await runtime.productionTransition({ to_status: "composition" }, producer)
    await runtime.productionCheckpoint({ current_focus: "author composition" }, producer)
  }
  const hook = (tool, args) => runtime.applyToolExecutionBefore({ sessionID: editorID, tool }, { args })
  const decision = async (permission, target) => {
    const output = { status: "ask" }
    await runtime.applyPermission({ sessionID: editorID, permission, patterns: [target] }, output)
    return output.status
  }
  const recordRough = async () => {
    await writeFile(join(project, rough), "rough-cut bytes")
    return runtime.productionRecordOutput({ slot: "rough_cut", canonical_path: rough }, producer)
  }
  const recordFinal = async () => {
    await recordRough()
    await runtime.productionApproveFinalRender(approval, producer)
    await writeFile(join(project, final), "final-video bytes")
    return runtime.productionRecordOutput({ slot: "final", canonical_path: final }, producer)
  }
  return { project, runtime, producer, editorID, load, patch, hook, decision, recordRough, recordFinal }
}

test("M5 lifecycle registers approved outputs and completes only after current Watch PASS", async (t) => {
  const f = await fixture(t)
  assert.equal(await f.decision("bash", "npx hyperframes check production/composition"), "allow")
  await f.recordFinal()
  const manifest = await f.load()
  assert.equal(manifest.outputs.final.path, final)
  assert.equal(manifest.outputs.final.sha256, createHash("sha256").update("final-video bytes").digest("hex"))
  assert.equal(manifest.outputs.final.size_bytes, 17)
  assert.equal(manifest.latest_checkpoint.verification.final_render_approval_digest, undefined)
  assert.equal(await finalRenderApprovalAllows(final, composition, f.project), false)
  await f.runtime.productionTransition({ to_status: "qa" }, f.producer)
  assert.equal(await f.decision("bash", "npx hyperframes check production/composition"), "deny")
  await assert.rejects(f.hook("bash", { command: "npx hyperframes check production/composition" }))
  await assert.rejects(f.runtime.productionTransition({ to_status: "completed" }, f.producer), /QA checkpoint/)
  await f.runtime.productionCheckpoint({ verification: { watch_verdict: "BLOCKED" }, remaining: ["fix edit"] }, f.producer)
  await assert.rejects(f.runtime.productionTransition({ to_status: "completed" }, f.producer), /watch_verdict PASS/)
  await f.runtime.productionCheckpoint({ verification: { watch_verdict: "PASS" } }, f.producer)
  await f.runtime.productionTransition({ to_status: "completed" }, f.producer)
  await f.runtime.productionCheckpoint({ completed: ["Editor composition", "final Watch PASS"], important_artifacts: [final] }, f.producer)
  const completed = await f.load()
  validateProductionManifest(completed)
  assert.equal(completed.schema_version, 1)
  assert.equal(completed.latest_checkpoint.phase, "completed")
  assert.deepEqual(completed.history.map((entry) => entry.status), ["production", "assets-ready", "composition", "qa", "completed"])
})

test("M5 rejects missing, unready, unsafe and escaped footage before composition", async (t) => {
  const f = await fixture(t, { compose: false })
  const original = (await f.load()).assets
  for (const asset of [
    { ...original[0], status: "pending" },
    { ...original[0], path: "production/assets/missing.mp4" },
    { ...original[0], path: "production/../private.mp4" },
    { ...original[0], path: join(f.project, "production/assets/one.mp4") },
    { ...original[0], path: "production/assets/link.mp4" },
  ]) {
    await f.patch((manifest) => { manifest.assets = [asset, original[1]] })
    await assert.rejects(f.runtime.productionTransition({ to_status: "composition" }, f.producer))
    assert.equal((await f.load()).project.status, "assets-ready")
  }
  await symlink(join(f.project, "production/assets/one.mp4"), join(f.project, "production/assets/link.mp4"))
  await assert.rejects(f.runtime.productionTransition({ to_status: "composition" }, f.producer), /symlink/)
  await f.patch((manifest) => { manifest.assets = [...original, { ...original[0], asset_id: "rejected_take", status: "failed" }] })
  await writeFile(join(f.project, "production/assets/still.png"), "test-only image bytes")
  await f.patch((manifest) => { manifest.assets[1] = { ...original[1], kind: "image", path: "production/assets/still.png" } })
  await f.runtime.productionTransition({ to_status: "composition" }, f.producer)
  assert.equal((await f.load()).project.status, "composition")
})

test("output registration rejects unsafe slots, missing files, symlinks, aliases and arbitrary patches", async (t) => {
  const f = await fixture(t)
  await symlink(join(f.project, "production/assets/one.mp4"), join(f.project, "production/outputs/link.mp4"))
  await link(join(f.project, "production/production-manifest.json"), join(f.project, "production/outputs/alias.mp4"))
  await writeFile(join(f.project, "production/outputs/empty.mp4"), "")
  for (const args of [
    { slot: "other", canonical_path: rough },
    { slot: "rough_cut", canonical_path: "production/outputs/missing.mp4" },
    { slot: "rough_cut", canonical_path: "production/../outside.mp4" },
    { slot: "rough_cut", canonical_path: join(f.project, rough) },
    { slot: "rough_cut", canonical_path: "production/outputs/link.mp4" },
    { slot: "rough_cut", canonical_path: "production/outputs/alias.mp4" },
    { slot: "rough_cut", canonical_path: "production/outputs/empty.mp4" },
    { slot: "rough_cut", canonical_path: "production/production-manifest.json" },
    { slot: "rough_cut", canonical_path: rough, outputs: {} },
  ]) {
    const before = await f.load()
    await assert.rejects(f.runtime.productionRecordOutput(args, f.producer))
    assert.deepEqual(await f.load(), before)
  }
})

test("only primary Producer can register outputs or persist render approval", async (t) => {
  const f = await fixture(t)
  for (const agent of ["Editor", "Creator", "Director", "Implementer", "Assistant"]) {
    const context = { ...f.producer, agent }
    await assert.rejects(f.runtime.productionRecordOutput({ slot: "rough_cut", canonical_path: rough }, context), /primary Producer/)
    await assert.rejects(f.runtime.productionApproveFinalRender(approval, context), /primary Producer/)
  }
  const delegated = { ...f.producer, sessionID: f.editorID }
  await assert.rejects(f.runtime.productionRecordOutput({ slot: "rough_cut", canonical_path: rough }, delegated), /primary Producer/)
  await assert.rejects(f.runtime.productionApproveFinalRender(approval, delegated), /primary Producer/)
})

test("Editor mutations are limited to safe composition files and preserve Producer-owned state", async (t) => {
  const f = await fixture(t)
  const manifest = join(f.project, "production/production-manifest.json")
  await symlink(manifest, join(f.project, "alias.json"))
  await symlink(join(f.project, "production"), join(f.project, "production-alias"))
  await link(manifest, join(f.project, "hardlink.json"))
  for (const target of [manifest, "production/production-manifest.json", "production/outputs/../production-manifest.json", "alias.json", "production-alias/production-manifest.json", "hardlink.json"]) {
    for (const tool of ["write", "edit"]) {
      assert.equal(await f.decision(tool, target), "deny")
      await assert.rejects(f.hook(tool, { filePath: target }), /canonical production/)
    }
    await assert.rejects(f.hook("apply_patch", { patchText: `*** Begin Patch\n*** Update File: ${target}\n@@\n-old\n+new\n*** End Patch` }), /canonical production/)
  }
  const generated = join(f.project, "production/assets/generated/job.mp4")
  await mkdir(join(f.project, "production/assets/generated"), { recursive: true })
  await writeFile(generated, "accepted generated footage")
  await mkdir(join(f.project, composition, "assets"), { recursive: true })
  await symlink(join(f.project, "production/assets/generated"), join(f.project, composition, "escaped"))
  await link(generated, join(f.project, composition, "assets/generated-alias.mp4"))
  for (const target of [`${composition}/escaped/job.mp4`, `${composition}/assets/generated-alias.mp4`]) {
    assert.equal(await f.decision("write", target), "deny", target)
    await assert.rejects(f.hook("write", { filePath: target }), /production\/composition/)
  }
  assert.equal(await f.decision("bash", `npx hyperframes check ${composition}`), "deny")
  await rm(join(f.project, composition, "escaped"))
  assert.equal(await f.decision("bash", `npx hyperframes check ${composition}`), "deny")

  await f.hook("write", { filePath: `${composition}/index.html` })
  await f.hook("write", { filePath: `${composition}/hyperframes.json` })
  await f.hook("edit", { filePath: `${composition}/style.css` })
  await f.hook("apply_patch", { patchText: `*** Begin Patch\n*** Add File: ${composition}/style.css\n+body {}\n*** End Patch` })
  assert.equal(await f.decision("write", join(f.project, `${composition}/index.html`)), "allow")
  await rm(join(f.project, composition, "assets/generated-alias.mp4"))
  const entry = join(f.project, composition, "index.html")
  const add = `npx hyperframes add shader-wipe --dir ${composition}`
  await f.hook("bash", { command: add })
  await rm(entry)
  await symlink(manifest, entry)
  assert.equal(await f.decision("bash", add), "deny")
  await assert.rejects(f.hook("bash", { command: add }))
  await rm(entry)
  await link(manifest, entry)
  await assert.rejects(f.hook("bash", { command: add }))
})

test("Editor cannot change Producer lock and assets or Git state, and checkpoint remains writable", async (t) => {
  const f = await fixture(t)
  const generated = join(f.project, "production/assets/generated/job.mp4")
  await mkdir(join(f.project, "production/assets/generated"), { recursive: true })
  await mkdir(join(f.project, ".git"), { recursive: true })
  await writeFile(generated, "accepted generated footage")
  await writeFile(join(f.project, ".git/config"), "[core]\n")
  await link(join(f.project, ".git/config"), join(f.project, composition, "git-config-alias"))

  const deniedTargets = [
    "production/production-manifest.json.lock",
    "production/.media-job.claim",
    "production/assets/generated/job.mp4",
    ".git/config",
    "README.md",
    "production/outputs/final.mp4",
    `${composition}/.env.local`,
    `${composition}/nested/.env`,
    `${composition}/.git/config`,
    `${composition}/git-config-alias`,
    "production/composition/../assets/generated/job.mp4",
    join(f.project, "production/assets/generated/job.mp4"),
    join(f.project, "outside.txt"),
  ]
  for (const target of deniedTargets) {
    for (const tool of ["write", "edit"]) {
      assert.equal(await f.decision(tool, target), "deny", `${tool}: ${target}`)
      await assert.rejects(f.hook(tool, { filePath: target }), /production\/composition/)
    }
    await assert.rejects(f.hook("apply_patch", { patchText: `*** Begin Patch\n*** Add File: ${target}\n+denied\n*** End Patch` }), /production\/composition/)
  }

  await f.runtime.productionCheckpoint({ current_focus: "Editor lockfile write was rejected" }, f.producer)
  assert.equal((await f.load()).latest_checkpoint.current_focus, "Editor lockfile write was rejected")
})

test("draft rendering is bounded while final rendering requires exact Producer approval", async (t) => {
  const f = await fixture(t)
  assert.equal(await f.decision("bash", draftCommand), "allow")
  await f.hook("bash", { command: draftCommand })
  assert.equal(await f.decision("bash", finalCommand), "deny")
  await assert.rejects(f.hook("bash", { command: finalCommand }), /Producer approval/)
  await f.recordRough()
  await f.runtime.productionApproveFinalRender(approval, f.producer)
  assert.equal(await f.decision("bash", finalCommand), "allow")
  await f.hook("bash", { command: finalCommand })
  await assert.rejects(f.hook("write", { filePath: `${composition}/index.html` }), /approved HyperFrames project/)
  for (const command of [
    finalCommand.replace(final, "production/outputs/unapproved.mp4"),
    finalCommand.replace(composition, "production/other-project"),
    `${finalCommand} --output production/production-manifest.json`,
    `${finalCommand} -o production/outputs/unapproved.mp4`,
    `${finalCommand} --batch production/batch.json`,
    `${finalCommand} --composition other.html`,
  ]) {
    assert.equal(await f.decision("bash", command), "deny", command)
    await assert.rejects(f.hook("bash", { command }), /Producer approval/)
  }
})

test("Editor Bash rejects shell escapes, external destinations, Git and cloud or publish operations", async (t) => {
  const f = await fixture(t)
  await symlink(join(f.project, "production"), join(f.project, "production/escaped"))
  for (const command of [
    "npx hyperframes snapshot production/composition --output production/production-manifest.json",
    "npx hyperframes snapshot production/composition --output production/escaped/production-manifest.json",
    "npx hyperframes snapshot production/composition --output /tmp/out.png",
    "npx hyperframes snapshot production/composition --output alias",
    "npx hyperframes snapshot production/composition --output alias.json",
    "npx hyperframes add shader-wipe",
    "npx hyperframes snapshot --output production/outputs/snapshots",
    "npx hyperframes snapshot production/composition --output production/../out.png",
    "npx hyperframes check production/composition; git status",
    "npx hyperframes check $HOME/private",
    "npx hyperframes check production/*",
    "npx hyperframes cloud production/composition",
    "npx hyperframes catalog --install shader-wipe",
    "npx hyperframes doctor --fix",
    "npx hyperframes publish production/composition",
    "git add production/composition/index.html",
    "ffprobe /etc/passwd",
  ]) {
    assert.equal(await f.decision("bash", command), "deny", command)
    await assert.rejects(f.hook("bash", { command }))
  }
  assert.equal(await f.decision("bash", "npx hyperframes check production/composition"), "allow")
  assert.equal(await f.decision("bash", "ffprobe production/assets/one.mp4"), "allow")
  await assert.rejects(f.hook("bash", { command: draftCommand, workdir: tmpdir() }), /bound production workspace/)
  assert.equal(await f.decision("bash", "HYPERFRAMES_SKIP_SKILLS=1 npx hyperframes init production/composition --non-interactive"), "ask")
  assert.equal(await f.decision("bash", "npx hyperframes skills update general-video"), "ask")
})

test("changed rough cut invalidates approval and final output registration", async (t) => {
  const f = await fixture(t)
  await f.recordRough()
  await f.runtime.productionApproveFinalRender(approval, f.producer)
  await writeFile(join(f.project, rough), "changed rough cut")
  await writeFile(join(f.project, final), "final bytes")
  assert.equal(await f.decision("bash", finalCommand), "deny")
  await assert.rejects(f.runtime.productionRecordOutput({ slot: "final", canonical_path: final }, f.producer), /Producer render approval/)
  await f.recordRough()
  assert.equal((await f.load()).latest_checkpoint.verification.final_render_project_path, undefined)
})

test("Editor can stage only ready canonical media into composition assets", async (t) => {
  const f = await fixture(t)
  await mkdir(join(f.project, composition, "assets"))
  const command = "cp -- production/assets/one.mp4 production/composition/assets/one.mp4"
  assert.equal(await f.decision("bash", command), "allow")
  await f.hook("bash", { command })
  await mkdir(join(f.project, ".git"), { recursive: true })
  await writeFile(join(f.project, ".git/config"), "[core]\n")
  await link(join(f.project, ".git/config"), join(f.project, composition, "assets/git-config-alias"))
  for (const denied of [
    "cp -- /etc/passwd production/composition/assets/one.mp4",
    "cp -- production/assets/one.mp4 production/production-manifest.json",
    "cp -- production/production-manifest.json production/composition/assets/one.mp4",
    "cp -- production/assets/one.mp4 production/assets/two.mp4",
    "cp -- production/assets/one.mp4 production/composition/assets/git-config-alias",
    "cp -R production/assets production/composition/assets",
  ]) {
    assert.equal(await f.decision("bash", denied), "deny")
    await assert.rejects(f.hook("bash", { command: denied }))
  }
  await f.patch((manifest) => { manifest.assets[0].status = "failed" })
  assert.equal(await f.decision("bash", command), "deny")
})

test("M5 Bash and file access requires a runtime-bound film composition context", async (t) => {
  const f = await fixture(t)
  const videoPath = "videos/m6-isolation-0123456789"
  await prepareEditorVideoProject(f.project, videoPath)
  await mkdir(join(f.project, composition, "assets"), { recursive: true })
  const filmCopy = "cp -- production/assets/one.mp4 production/composition/assets/staged.mp4"
  const filmProbe = "ffprobe production/assets/one.mp4"
  const videoCopy = `cp -- production/assets/one.mp4 ${videoPath}/assets/staged.mp4`
  const permissionFor = async (sessionID, type, pattern) => {
    const output = { status: "ask" }
    await f.runtime.applyPermission({ sessionID, permission: type, patterns: [pattern] }, output)
    return output.status
  }
  const before = (sessionID, tool, args) => f.runtime.applyToolExecutionBefore({ sessionID, tool }, { args })

  const delegated = await f.runtime.delegate({
    agent: "Editor",
    description: "Continue authorized film composition",
    prompt: "Stage the ready footage and continue the composition.",
    run_in_background: true,
  }, f.producer)
  const filmTask = f.runtime.registry.get(delegated.task_id)
  const filmSession = filmTask.child_session_id
  assert.equal(filmTask.film_composition_context, true)
  assert.equal(f.runtime.profiles.get(filmSession).film_composition_context, true)
  assert.equal(await permissionFor(filmSession, "bash", filmCopy), "allow")
  assert.equal(await permissionFor(filmSession, "bash", filmProbe), "allow")
  await before(filmSession, "bash", { command: filmCopy })
  await before(filmSession, "bash", { command: filmProbe })
  assert.equal(await permissionFor(filmSession, "write", `${composition}/index.html`), "allow")
  assert.equal(await permissionFor(filmSession, "bash", videoCopy), "deny")

  const videoSession = "m6-editor-in-m5-workspace"
  f.runtime.profiles.set(videoSession, {
    agent: "Editor", category: null, directory: f.project, video_project_path: videoPath,
  })
  assert.equal(await permissionFor(videoSession, "bash", filmCopy), "deny")
  assert.equal(await permissionFor(videoSession, "bash", filmProbe), "deny")
  assert.equal(await permissionFor(videoSession, "write", `${composition}/index.html`), "deny")
  await assert.rejects(before(videoSession, "bash", { command: filmCopy }), /safe local HyperFrames command/)
  await assert.rejects(before(videoSession, "bash", { command: filmProbe }), /safe local HyperFrames command/)

  const contextlessSession = "editor-without-film-context"
  f.runtime.profiles.set(contextlessSession, { agent: "Editor", category: null, directory: f.project })
  assert.equal(await permissionFor(contextlessSession, "bash", filmCopy), "deny")
  assert.equal(await permissionFor(contextlessSession, "bash", filmProbe), "deny")
  assert.equal(await permissionFor(contextlessSession, "write", `${composition}/index.html`), "deny")
  await assert.rejects(before(contextlessSession, "bash", { command: filmCopy }), /safe local HyperFrames command/)
})

test("Editor render routes reject output hardlinks to Git metadata", async (t) => {
  const f = await fixture(t)
  await mkdir(join(f.project, ".git"), { recursive: true })
  await writeFile(join(f.project, ".git/config"), "[core]\n")

  await rm(join(f.project, rough), { force: true })
  await link(join(f.project, ".git/config"), join(f.project, rough))
  assert.equal(await f.decision("bash", draftCommand), "deny")
  await rm(join(f.project, rough))
  assert.equal(await f.decision("bash", draftCommand), "allow")

  await f.recordRough()
  await f.runtime.productionApproveFinalRender(approval, f.producer)
  await rm(join(f.project, final), { force: true })
  await link(join(f.project, ".git/config"), join(f.project, final))
  assert.equal(await f.decision("bash", finalCommand), "deny")
  await assert.rejects(f.hook("bash", { command: finalCommand }))
})

test("generic checkpoint cannot invent render approval and output registration preserves concurrent checkpoint", async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.runtime.productionCheckpoint({ verification: { final_render_approval_digest: "a".repeat(64) } }, f.producer), /cannot create/)
  await assert.rejects(f.runtime.productionCheckpoint({ verification: { final_render_project_path: composition } }, f.producer), /cannot create/)
  await writeFile(join(f.project, rough), "rough bytes")
  await Promise.all([
    f.runtime.productionRecordOutput({ slot: "rough_cut", canonical_path: rough }, f.producer),
    f.runtime.productionCheckpoint({ current_focus: "rough cut ready", verification: { check: "PASS" } }, f.producer),
  ])
  const manifest = await f.load()
  validateProductionManifest(manifest)
  assert.equal(manifest.outputs.rough_cut.path, rough)
  assert.equal(manifest.latest_checkpoint.current_focus, "rough cut ready")
  assert.equal(manifest.latest_checkpoint.verification.check, "PASS")
})

test("resume preserves composition and QA outputs; blocked QA returns legally to composition", async (t) => {
  const f = await fixture(t)
  await f.recordFinal()
  for (const phase of ["composition", "qa"]) {
    if (phase === "qa") await f.runtime.productionTransition({ to_status: "qa" }, f.producer)
    await f.runtime.productionCheckpoint({ current_focus: `resume ${phase}`, verification: { watch_verdict: "BLOCKED" } }, f.producer)
    const before = await f.load()
    const result = await f.runtime.productionPreflight({}, f.producer)
    assert.equal(result.project_status, phase)
    assert.equal(result.created, false)
    assert.deepEqual(await f.load(), before)
  }
  await f.runtime.productionTransition({ to_status: "composition" }, f.producer)
  assert.equal((await f.load()).outputs.final.path, final)
  await assert.rejects(f.runtime.productionTransition({ to_status: "completed" }, f.producer), /cannot transition/)
})

test("output tampering prevents QA and final completion", async (t) => {
  const f = await fixture(t)
  await f.recordFinal()
  await writeFile(join(f.project, final), "tampered")
  await assert.rejects(f.runtime.productionTransition({ to_status: "qa" }, f.producer), /changed since/)
  await f.recordFinal()
  await f.runtime.productionTransition({ to_status: "qa" }, f.producer)
  await f.runtime.productionCheckpoint({ verification: { watch_verdict: "PASS" } }, f.producer)
  await writeFile(join(f.project, final), "tampered again")
  await assert.rejects(f.runtime.productionTransition({ to_status: "completed" }, f.producer), /changed since/)
})

test("output and render approval require composition state and safe distinct destinations", async (t) => {
  const f = await fixture(t, { compose: false })
  await writeFile(join(f.project, rough), "rough bytes")
  await assert.rejects(f.runtime.productionRecordOutput({ slot: "rough_cut", canonical_path: rough }, f.producer), /requires composition/)
  await assert.rejects(f.runtime.productionApproveFinalRender(approval, f.producer), /requires composition/)
  await f.runtime.productionTransition({ to_status: "composition" }, f.producer)
  await f.recordRough()
  await assert.rejects(f.runtime.productionApproveFinalRender(approval, f.producer), /current composition checkpoint/)
  await f.runtime.productionCheckpoint({}, f.producer)
  for (const args of [{ ...approval, final_path: rough }, { ...approval, final_path: `${composition}/index.html` }, { ...approval, project_path: "production/missing" }, { ...approval, patch: {} }]) {
    await assert.rejects(f.runtime.productionApproveFinalRender(args, f.producer))
  }
})

test("Editor static profile exposes file tools behind the runtime path guard", () => {
  const config = { agent: { Editor: { permission: { read: "allow", edit: "allow", write: "allow", bash: { "npx hyperframes *": "allow" }, external_directory: "ask" } } } }
  applyFilmProductionEditorPermissions(config)
  const p = config.agent.Editor.permission
  assert.equal(p.edit, "allow")
  assert.equal(p.write, "allow")
  assert.equal(p.read, "allow")
  assert.equal(p.bash["*"], "deny")
  assert.equal(p.bash["npx hyperframes render *"], "ask")
  assert.equal(p.bash["npx hyperframes init *"], "ask")
  assert.equal(p.bash["npx hyperframes check *"], "allow")
  assert.equal(p.bash["npx hyperframes skills check --json"], "allow")
  assert.equal(p.bash["npx hyperframes cloud *"], "deny")
  assert.equal(p.external_directory, "ask")
})
