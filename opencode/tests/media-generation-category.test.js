import test from "node:test"
import assert from "node:assert/strict"

import { AgentDispatcher } from "../plugins/delegation/agent-dispatcher.js"
import { CategoryEngine } from "../plugins/delegation/category-engine.js"
import { categoryPermission, categorySessionPermission } from "../plugins/delegation/category-permissions.js"
import { DEFAULT_DELEGATION } from "../plugins/delegation/aio-config.js"
import { createMockMediaRuntime } from "../plugins/delegation/media-runtime.js"
import { delegationPluginHooks } from "../plugins/delegation/plugin-hooks.js"
import { DelegationRuntime } from "../plugins/delegation/runtime.js"
import { systemFor, toolsFor } from "../plugins/delegation/session-runner.js"
import { tool } from "@opencode-ai/plugin"

const availableAgents = [
  "Assistant",
  "Executor",
  "Planner",
  "Strategist",
  "Producer",
  "Creator",
  "Implementer",
  "Blender",
  "Browser",
].map((name) => ({ name, mode: ["Implementer", "Creator"].includes(name) ? "subagent" : "primary" }))

test("media-generation is a built-in Implementer category authorized for Assistant and Creator, not Producer", () => {
  const engine = new CategoryEngine({})
  const route = new AgentDispatcher(engine, { availableAgents })
  const resolved = route.resolve({ category: "media-generation", parentAgent: "Creator" })

  assert.equal(resolved.agent, "Implementer")
  assert.equal(resolved.category, "media-generation")
  assert.equal(resolved.profile.family, "media")
  assert.match(resolved.profile.prompt_append, /Atlas Cloud/i)
  assert.match(resolved.profile.prompt_append, /persisted job to contain Producer approval/i)
  assert.match(resolved.profile.prompt_append, /Caller-supplied digests or ceilings never authorize submission/i)
  assert.equal(DEFAULT_DELEGATION.Producer.categories.includes("media-generation"), false)
  assert.equal(DEFAULT_DELEGATION.Creator.categories.includes("media-generation"), true)

  assert.doesNotThrow(() => route.resolve({ category: "media-generation", parentAgent: "Assistant" }))
  for (const parentAgent of ["Producer", "Blender", "Planner", "Strategist", "Executor", "Implementer", "Browser"]) {
    assert.throws(
      () => route.resolve({ category: "media-generation", parentAgent }),
      /not allowed|category routes are not allowed/,
      parentAgent,
    )
  }

  const widenedProducer = new AgentDispatcher(new CategoryEngine({}), {
    aioConfig: {
      version: 1,
      delegation: {
        Producer: { categories: ["media-generation"], category_families: ["media"] },
      },
    },
    availableAgents,
  })
  assert.throws(
    () => widenedProducer.resolve({ category: "media-generation", parentAgent: "Producer" }),
    /Producer is not allowed to delegate category media-generation/,
  )
})

test("media-generation has a bounded session ceiling and no recursive delegation", () => {
  const engine = new CategoryEngine({})
  const profile = engine.resolve("media-generation").profile
  assert.equal(categoryPermission({ category: "media-generation", tools: profile.tools }, {
    type: "media_calculate",
    pattern: "*",
  }), "allow")
  assert.equal(categoryPermission({ category: "quick" }, {
    type: "media_calculate",
    pattern: "*",
  }), "deny")
  for (const type of [
    "read",
    "glob",
    "grep",
    "list",
    "lsp",
    "edit",
    "write",
    "bash",
    "skill",
    "external_directory",
    "delegate_task",
    "workspace_prepare",
    "task_status",
  ]) assert.equal(categoryPermission({ category: "media-generation" }, { type, pattern: "*" }), "deny", type)

  const rules = categorySessionPermission("media-generation", profile.tools)
  for (const permission of ["read", "glob", "grep", "list", "lsp"]) {
    assert.ok(rules.some((rule) => rule.permission === permission && rule.pattern === "*" && rule.action === "deny"), permission)
  }
  for (const name of [
    "media_calculate",
    "media_upload",
    "media_generate_image",
    "media_generate_video",
    "media_prediction",
    "media_wait_prediction",
  ]) assert.ok(rules.some((rule) => rule.permission === name && rule.action === "allow"), name)
  assert.ok(rules.some((rule) => rule.permission === "delegate_task" && rule.pattern === "*" && rule.action === "deny"))
  assert.ok(rules.some((rule) => rule.permission === "bash" && rule.pattern === "*" && rule.action === "deny"))
  assert.equal(toolsFor("Implementer", profile.tools, "media-generation"), undefined)
  const contract = systemFor("Implementer", "media-generation", profile)
  assert.match(contract, /project-owned Implementer/)
  assert.match(contract, /Atlas Cloud/)
  assert.match(contract, /media_calculate.*records a calculated job.*canonical ProductionManifest/s)
})

test("mock media runtime is deterministic and exposes only bounded operations", () => {
  const first = createMockMediaRuntime()
  const second = createMockMediaRuntime()
  const request = {
    shot_id: "shot_03",
    request_digest: "digest-03",
    duration_seconds: 6,
  }
  assert.deepEqual(first.media_generate_video(request), second.media_generate_video(request))
  const image = first.media_generate_image({ shot_id: "shot_03", request_digest: "image-03" })
  assert.equal(image.status, "completed")
  assert.equal(first.media_prediction({ job_id: image.job_id }).status, "completed")
  assert.equal(first.media_wait_prediction({ job_id: image.job_id }).job_id, image.job_id)
  assert.throws(
    () => first.media_prediction({ job_id: "missing-job" }),
    /Unknown media generation job: missing-job/,
  )
  assert.throws(
    () => first.media_wait_prediction({ job_id: "missing-job" }),
    /Unknown media generation job: missing-job/,
  )
  assert.equal(first.media_calculate({
    shot_id: "shot_03",
    media_type: "video",
    duration_seconds: 6,
    request_digest: "digest-03",
  }).estimated_usd, 0)
  assert.throws(() => first.media_upload({ asset_id: "asset" }), /filename/)
})

test("media tool registrations expose raw OpenCode argument schema maps", () => {
  const runtime = new DelegationRuntime({
    profiles: new Map(),
    registry: { list: () => [] },
    skills: { list: () => [] },
  })
  const registered = delegationPluginHooks(runtime).tool

  const fields = {
    media_calculate: ["shot_id", "media_type", "prompt", "model"],
    media_upload: ["asset_id", "path", "manifest_path"],
    media_generate_image: ["job_id", "shot_id", "prompt", "manifest_path", "model"],
    media_generate_video: ["job_id", "shot_id", "prompt", "manifest_path", "model"],
    media_prediction: ["job_id"],
    media_wait_prediction: ["job_id"],
  }

  for (const [name, requiredFields] of Object.entries(fields)) {
    for (const field of requiredFields) {
      assert.equal(typeof registered[name].args[field]?.safeParse, "function", `${name}.${field}`)
    }
  }

  const calculateSchema = tool.schema.object(registered.media_calculate.args)
  const uploadSchema = tool.schema.object(registered.media_upload.args)
  const imageSchema = tool.schema.object(registered.media_generate_image.args)
  const videoSchema = tool.schema.object(registered.media_generate_video.args)
  for (const field of ["approved_request_digest", "approved_max_usd", "approved_price_usd"]) {
    assert.equal(registered.media_generate_image.args[field], undefined)
    assert.equal(registered.media_generate_video.args[field], undefined)
  }
  const predictionSchema = tool.schema.object(registered.media_prediction.args)
  for (const field of ["size", "output_format", "quality", "background", "thinking", "prompt_optimization_mode"]) {
    assert.equal(typeof registered.media_generate_image.args[field]?.safeParse, "function", `image.${field}`)
    assert.equal(registered.media_generate_video.args[field], undefined, `video must not expose ${field}`)
  }
  for (const field of ["reference_image_asset_ids", "reference_video_asset_ids", "reference_audio_asset_ids", "duration_seconds", "resolution", "ratio", "generate_audio", "seed", "prompt_expansion", "video_output_format"]) {
    assert.equal(typeof registered.media_generate_video.args[field]?.safeParse, "function", `video.${field}`)
    assert.equal(registered.media_generate_image.args[field], undefined, `image must not expose ${field}`)
  }
  assert.doesNotThrow(() => calculateSchema.parse({
    shot_id: "shot_01",
    media_type: "video",
    prompt: "a reveal",
    manifest_path: "production-manifest.json",
    model: "alibaba/wan-3.0/reference-to-video",
    duration_seconds: -1,
    resolution: "1080p-esr",
    generate_audio: false,
    seed: -1,
  }))
  assert.doesNotThrow(() => calculateSchema.parse({
    shot_id: "shot_01",
    media_type: "video",
    prompt: "a reveal",
    manifest_path: "production-manifest.json",
    model: "minimax/h3/reference-to-video",
    reference_image_asset_ids: ["asset-01"],
    reference_audio_asset_ids: ["voice-01"],
    duration_seconds: 8,
    resolution: "2k",
    prompt_expansion: true,
  }))
  assert.doesNotThrow(() => calculateSchema.parse({
    shot_id: "shot_01",
    media_type: "video",
    prompt: "a complex reveal",
    manifest_path: "production-manifest.json",
    model: "bytedance/seedance-2.5/reference-to-video",
    reference_image_asset_ids: Array.from({ length: 30 }, (_, index) => `image-${index}`),
    reference_video_asset_ids: Array.from({ length: 10 }, (_, index) => `video-${index}`),
    reference_audio_asset_ids: Array.from({ length: 10 }, (_, index) => `audio-${index}`),
    duration_seconds: 30,
    resolution: "1080p-esr & 60fps",
    ratio: "21:9",
  }))
  assert.throws(() => calculateSchema.parse({ shot_id: "shot_01", media_type: "video", prompt: "a reveal" }), /manifest_path/)
  assert.throws(() => uploadSchema.parse({ asset_id: "asset-01" }), /manifest_path/)
  assert.doesNotThrow(() => uploadSchema.parse({
    asset_id: "voice-01",
    manifest_path: "production-manifest.json",
    media_type: "audio",
  }))
  assert.doesNotThrow(() => imageSchema.parse({
    job_id: "job-01",
    shot_id: "shot_01",
    prompt: "a reveal",
    manifest_path: "production-manifest.json",
    size: "1024*1024",
    quality: "high",
    background: "transparent",
  }))
  assert.doesNotThrow(() => videoSchema.parse({
    job_id: "job-01",
    shot_id: "shot_01",
    prompt: "a reveal",
    manifest_path: "production-manifest.json",
    duration_seconds: 4,
    generate_audio: false,
    seed: 123,
    video_output_format: "mov",
  }))
  assert.doesNotThrow(() => predictionSchema.parse({ job_id: "mock-job-01" }))
  assert.throws(() => calculateSchema.parse({ shot_id: "", media_type: "video", prompt: "a reveal" }))
})

test("plugin media tools enforce the category boundary at execution time", async () => {
  const runtime = new DelegationRuntime({
    profiles: new Map([
      ["media-session", { category: "media-generation", tools: { media_calculate: true } }],
      ["ordinary-session", { category: "standard", tools: {} }],
    ]),
    registry: { list: () => [] },
    skills: { list: () => [] },
  })
  const hooks = delegationPluginHooks(runtime)
  const args = {
    shot_id: "shot_03",
    media_type: "video",
    prompt: "a reveal",
    manifest_path: "production-manifest.json",
    duration_seconds: 6,
  }
  const result = await hooks.tool.media_calculate.execute(args, { sessionID: "media-session" })
  assert.match(result, /"estimated_usd": 0/)
  await assert.rejects(
    hooks.tool.media_calculate.execute(args, { sessionID: "ordinary-session" }),
    /require an Implementer child in category=media-generation/,
  )
})
