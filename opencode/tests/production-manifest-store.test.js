import test from "node:test"
import assert from "node:assert/strict"
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createProductionManifest, validateProductionManifest } from "../plugins/film-production/contracts.js"
import {
  createProductionManifestIfMissing,
  updateProductionManifest,
} from "../plugins/delegation/production-manifest-store.js"

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "production-manifest-store-test-"))
  const manifestPath = join(root, "production", "production-manifest.json")
  const manifest = createProductionManifest({ project: "manifest-store" })
  await mkdir(join(root, "production"))
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { root, manifestPath, manifest }
}

test("a failed ProductionManifest persistence surfaces and leaves the prior canonical file valid", async (t) => {
  const { root, manifestPath, manifest } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const before = await readFile(manifestPath, "utf8")
  await assert.rejects(updateProductionManifest(manifestPath, (draft) => {
    draft.updated_at = new Date().toISOString()
  }, {
    persist: async () => { throw new Error("injected manifest write failure") },
  }), /injected manifest write failure/)
  assert.equal(await readFile(manifestPath, "utf8"), before)
  validateProductionManifest(JSON.parse(await readFile(manifestPath, "utf8")))
  assert.deepEqual(JSON.parse(before), manifest)
  await assert.rejects(lstat(`${manifestPath}.lock`), { code: "ENOENT" })
})

test("manifest lock contention fails within its bound and never removes another writer's lock", async (t) => {
  const { root, manifestPath } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const lockPath = `${manifestPath}.lock`
  await writeFile(lockPath, "held by another writer\n", { flag: "wx" })
  const before = Date.now()
  let updated = false
  await assert.rejects(updateProductionManifest(manifestPath, () => { updated = true }, { timeoutMs: 30 }),
    /timed out after 30ms waiting for the ProductionManifest update lock/)
  assert.equal(Date.now() - before < 1_000, true)
  assert.equal(updated, false)
  assert.equal(await readFile(lockPath, "utf8"), "held by another writer\n")
  validateProductionManifest(JSON.parse(await readFile(manifestPath, "utf8")))
})

test("concurrent initializers create one valid canonical manifest without replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "production-manifest-init-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manifestPath = join(root, "production", "production-manifest.json")
  const results = await Promise.all([
    createProductionManifestIfMissing(manifestPath, createProductionManifest({ project: "initializer-a" })),
    createProductionManifestIfMissing(manifestPath, createProductionManifest({ project: "initializer-b" })),
  ])
  assert.equal(results.filter((result) => result.created).length, 1)
  const persisted = JSON.parse(await readFile(manifestPath, "utf8"))
  validateProductionManifest(persisted)
  assert.equal(persisted.project.id, results.find((result) => result.created).manifest.project.id)
  await assert.rejects(lstat(`${manifestPath}.lock`), { code: "ENOENT" })
})
