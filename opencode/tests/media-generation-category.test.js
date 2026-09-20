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
  "Implementer",
  "Blender",
  "Browser",
].map((name) => ({ name, mode: name === "Implementer" ? "subagent" : "primary" }))

test("media-generation is a built-in Implementer category authorized for Assistant and Producer", () => {
  const engine = new CategoryEngine({})
  const route = new AgentDispatcher(engine, { availableAgents })
  const resolved = route.resolve({ category: "media-generation", parentAgent: "Producer" })

  assert.equal(resolved.agent, "Implementer")
  assert.equal(resolved.category, "media-generation")
  assert.equal(resolved.profile.family, "media")
  assert.match(resolved.profile.prompt_append, /Atlas Cloud/i)
  assert.match(resolved.profile.prompt_append, /approved request digest/i)
  assert.equal(DEFAULT_DELEGATION.Producer.categories.includes("media-generation"), true)

  assert.doesNotThrow(() => route.resolve({ category: "media-generation", parentAgent: "Assistant" }))
  for (const parentAgent of ["Blender", "Planner", "Strategist", "Executor", "Implementer", "Browser"]) {
    assert.throws(
      () => route.resolve({ category: "media-generation", parentAgent }),
      /not allowed|category routes are not allowed/,
      parentAgent,
    )
  }
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
  assert.match(contract, /media_calculate does not create a job or charge/)
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
    media_calculate: ["shot_id", "media_type", "prompt"],
    media_upload: ["asset_id", "path"],
    media_generate_image: ["job_id", "shot_id", "prompt", "approved_request_digest", "approved_max_usd"],
    media_generate_video: ["job_id", "shot_id", "prompt", "approved_request_digest", "approved_max_usd"],
    media_prediction: ["job_id"],
    media_wait_prediction: ["job_id"],
  }

  for (const [name, requiredFields] of Object.entries(fields)) {
    for (const field of requiredFields) {
      assert.equal(typeof registered[name].args[field]?.safeParse, "function", `${name}.${field}`)
    }
  }

  const calculateSchema = tool.schema.object(registered.media_calculate.args)
  const videoSchema = tool.schema.object(registered.media_generate_video.args)
  const predictionSchema = tool.schema.object(registered.media_prediction.args)
  assert.doesNotThrow(() => calculateSchema.parse({ shot_id: "shot_01", media_type: "video", prompt: "a reveal" }))
  assert.doesNotThrow(() => videoSchema.parse({
    job_id: "job-01",
    shot_id: "shot_01",
    prompt: "a reveal",
    approved_request_digest: "a".repeat(64),
    approved_max_usd: 1,
    duration_seconds: 4,
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
  const args = { shot_id: "shot_03", media_type: "video", prompt: "a reveal", duration_seconds: 6 }
  const result = await hooks.tool.media_calculate.execute(args, { sessionID: "media-session" })
  assert.match(result, /"estimated_usd": 0/)
  await assert.rejects(
    hooks.tool.media_calculate.execute(args, { sessionID: "ordinary-session" }),
    /require an Implementer child in category=media-generation/,
  )
})
