import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  LEGACY_PROJECT_DATA_ROOT_ENV,
  PROJECT_DATA_ROOT_ENV,
  resolveProjectDataRoot,
} from "../plugins/project-data-root.js"

test("AIO_DATA_ROOT is preferred while the legacy environment variable remains supported", () => {
  assert.equal(
    resolveProjectDataRoot({
      env: {
        [PROJECT_DATA_ROOT_ENV]: "/tmp/aio-data",
        [LEGACY_PROJECT_DATA_ROOT_ENV]: "/tmp/legacy-data",
      },
      home: "/tmp/home",
    }),
    "/tmp/aio-data",
  )
  assert.equal(
    resolveProjectDataRoot({
      env: { [LEGACY_PROJECT_DATA_ROOT_ENV]: "/tmp/legacy-data" },
      home: "/tmp/home",
    }),
    "/tmp/legacy-data",
  )
})

test("new installations use the aio data directory and existing legacy data is retained", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "aio-data-root-test-"))
  const dataHome = join(home, "data")
  const env = { XDG_DATA_HOME: dataHome }
  const currentRoot = resolve(dataHome, "all-in-opencode")
  const legacyRoot = resolve(dataHome, "opencode-workflow")
  t.after(() => rm(home, { recursive: true, force: true }))

  assert.equal(resolveProjectDataRoot({ env, home }), currentRoot)
  await mkdir(legacyRoot, { recursive: true })
  assert.equal(resolveProjectDataRoot({ env, home }), legacyRoot)
  await mkdir(currentRoot, { recursive: true })
  assert.equal(resolveProjectDataRoot({ env, home }), currentRoot)
})
