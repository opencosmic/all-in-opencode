import test from "node:test"
import assert from "node:assert/strict"
import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  DEFAULT_AIO_CONFIG_PATH,
  DEFAULT_DELEGATION,
  loadAioConfig,
  normalizeAioConfig,
  withDefaultDelegation,
} from "../plugins/delegation/aio-config.js"

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "aio-config-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  return {
    root,
    configPath: join(root, "aio.json"),
    legacyPath: join(root, "categories.json"),
  }
}

test("missing aio.json returns an empty normalized V1 config", async (t) => {
  const { configPath } = await fixture(t)
  assert.deepEqual(loadAioConfig({ configPath }), {
    version: 1,
    categories: {},
    agents: {},
    delegation: {},
  })
  await assert.rejects(lstat(configPath), { code: "ENOENT" })
  assert.match(DEFAULT_AIO_CONFIG_PATH, /\.config[\\/]opencode[\\/]aio\.json$/)
})

test("valid V1 aio.json is normalized and defaults missing sections", async (t) => {
  const { configPath } = await fixture(t)
  await writeFile(configPath, JSON.stringify({
    version: 1,
    categories: {
      "backend-heavy": {
        family: " backend ",
        description: "Complex backend implementation",
        model: "provider/model",
        variant: "high",
        prompt_append: "Check failure paths.",
      },
    },
    agents: {
      "Security Reviewer": { delegatable: true },
    },
    delegation: {
      " My Architect ": {
        categories: [" standard ", "backend-heavy", "standard"],
        category_families: [" implementation "],
        agents: ["Explorer", "Security Reviewer", "Explorer"],
      },
    },
  }))

  assert.deepEqual(loadAioConfig({ configPath }), {
    version: 1,
    categories: {
      "backend-heavy": {
        family: "backend",
        description: "Complex backend implementation",
        model: "provider/model",
        variant: "high",
        prompt_append: "Check failure paths.",
      },
    },
    agents: {
      "Security Reviewer": { delegatable: true },
    },
    delegation: {
      "My Architect": {
        categories: ["standard", "backend-heavy"],
        category_families: ["implementation"],
        agents: ["Explorer", "Security Reviewer"],
      },
    },
  })
})

test("built-in family labels are immutable while model and variant overrides remain configurable", () => {
  const normalized = normalizeAioConfig({
    version: 1,
    categories: {
      standard: {
        family: " implementation ",
        model: "provider/replacement",
        variant: "high",
      },
      "media-generation": { family: "media" },
      "custom-implementation": { family: "implementation" },
      "custom-media": { family: "media" },
    },
  })

  assert.equal(normalized.categories.standard.family, "implementation")
  assert.equal(normalized.categories.standard.model, "provider/replacement")
  assert.equal(normalized.categories.standard.variant, "high")
  assert.equal(normalized.categories["media-generation"].family, "media")
  assert.equal(normalized.categories["custom-implementation"].family, "implementation")
  assert.equal(normalized.categories["custom-media"].family, "media")

  for (const [name, family] of [["standard", "media"], ["media-generation", "implementation"]]) {
    assert.throws(
      () => normalizeAioConfig({ version: 1, categories: { [name]: { family } } }),
      new RegExp(`Built-in category "${name}" has immutable family`),
    )
  }
})

test("delegation fields default independently to empty arrays", async (t) => {
  const { configPath } = await fixture(t)
  await writeFile(configPath, JSON.stringify({
    version: 1,
    delegation: {
      "Categories Only": { categories: ["standard"] },
      "Families Only": { category_families: ["implementation"] },
      "Agents Only": { agents: ["Explorer"] },
      "Empty Entry": {},
      "Full Entry": {
        categories: ["standard"],
        category_families: ["implementation"],
        agents: ["Explorer"],
      },
    },
  }))

  assert.deepEqual(loadAioConfig({ configPath }).delegation, {
    "Categories Only": { categories: ["standard"], category_families: [], agents: [] },
    "Families Only": { categories: [], category_families: ["implementation"], agents: [] },
    "Agents Only": { categories: [], category_families: [], agents: ["Explorer"] },
    "Empty Entry": { categories: [], category_families: [], agents: [] },
    "Full Entry": { categories: ["standard"], category_families: ["implementation"], agents: ["Explorer"] },
  })
})

test("default delegation is normalized and user lists extend it by union", () => {
  const normalized = normalizeAioConfig({
    version: 1,
    delegation: {
      Producer: { categories: ["standard"], agents: ["Searcher"] },
    },
  })
  const withDefaults = withDefaultDelegation(normalized)

  assert.deepEqual(DEFAULT_DELEGATION.Producer, {
    categories: ["video-analysis", "media-generation", "blender-previs"],
    category_families: ["media"],
    agents: ["Director", "Creator", "Editor"],
  })
  assert.deepEqual(withDefaults.delegation.Producer, {
    categories: ["video-analysis", "media-generation", "blender-previs", "standard"],
    category_families: ["media"],
    agents: ["Director", "Creator", "Editor", "Searcher"],
  })
})

test("malformed JSON fails with the config path", async (t) => {
  const { configPath } = await fixture(t)
  await writeFile(configPath, "{not-json")
  assert.throws(() => loadAioConfig({ configPath }), /invalid AIO config .*JSON/)
})

test("unsupported versions and top-level sections fail closed", async (t) => {
  const { configPath } = await fixture(t)
  await writeFile(configPath, JSON.stringify({ version: 2 }))
  assert.throws(() => loadAioConfig({ configPath }), /unsupported version 2.*expected version 1/)

  await writeFile(configPath, JSON.stringify({ version: 1, presets: {} }))
  assert.throws(() => loadAioConfig({ configPath }), /unsupported top-level field "presets"/)
})

test("invalid section shapes fail clearly", async (t) => {
  const { configPath } = await fixture(t)
  for (const value of [
    { version: 1, categories: [] },
    { version: 1, agents: [] },
    { version: 1, delegation: [] },
    { version: 1, delegation: { Assistant: { categories: "quick" } } },
    { version: 1, agents: { Reviewer: { delegatable: "yes" } } },
    { version: 1, categories: { broken: { model: 42 } } },
  ]) {
    await writeFile(configPath, JSON.stringify(value))
    assert.throws(() => loadAioConfig({ configPath }), /invalid AIO config/)
  }
})

test("legacy categories.json is rejected without fallback or migration", async (t) => {
  const { configPath, legacyPath } = await fixture(t)
  const legacy = JSON.stringify({ categories: { legacy: { model: "provider/model" } } })
  await writeFile(legacyPath, legacy)
  assert.throws(
    () => loadAioConfig({ configPath, legacyConfigPath: legacyPath }),
    /categories\.json is no longer supported.*under "categories"/,
  )
  assert.equal(await import("node:fs/promises").then(({ readFile }) => readFile(legacyPath, "utf8")), legacy)
  await assert.rejects(lstat(configPath), { code: "ENOENT" })
})

test("normalizeAioConfig accepts the supported shape and rejects missing version", () => {
  assert.deepEqual(normalizeAioConfig({ version: 1 }), {
    version: 1,
    categories: {},
    agents: {},
    delegation: {},
  })
  assert.throws(() => normalizeAioConfig({ categories: {} }), /unsupported version undefined/)
})
