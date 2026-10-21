import test from "node:test"
import assert from "node:assert/strict"
import { access, readFile, realpath } from "node:fs/promises"
import { execFile } from "node:child_process"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { isolatedOpenCodeEnv } from "./support/isolated-opencode.js"

const here = dirname(fileURLToPath(import.meta.url))
const repository = resolve(here, "../..")
const execFileAsync = promisify(execFile)

test("Producer is the shared HyperFrames and film-production primary route", async (t) => {
  const env = await isolatedOpenCodeEnv(t, repository)
  const producer = await readFile(`${repository}/opencode/agents/producer.md`, "utf8")
  const command = await readFile(`${repository}/opencode/commands/video.md`, "utf8")

  assert.match(producer, /^name: Producer$/m)
  assert.match(producer, /^mode: primary$/m)
  assert.match(producer, /single primary orchestration owner for AIO video\s+production/i)
  assert.match(producer, /not a general coding agent/i)
  assert.match(producer, /OpenSpec planner or executor/i)
  assert.match(producer, /official upstream\s+`hyperframes` skill/i)
  assert.match(producer, /User -> \/video -> Producer -> \/hyperframes/s)
  assert.match(producer, /question: allow/)
  assert.match(producer, /websearch: allow/)
  assert.match(producer, /^  delegate_task: allow$/m)
  for (const tool of [
    "production_preflight", "production_prepare_artifacts", "production_checkpoint",
    "production_approve_generation", "production_record_output", "production_approve_final_render",
    "production_set_shots", "production_transition",
  ]) {
    assert.match(producer, new RegExp(`^  ${tool}: allow$`, "m"))
  }
  for (const tool of ["task_status", "task_output", "task_cancel"]) {
    assert.match(producer, new RegExp(`^  ${tool}: allow$`, "m"), tool)
  }
  assert.match(producer, /Producer owns production lifecycle, state, phase assignment, budget/i)
  assert.match(producer, /Producer may delegate these three named phase owners/i)
  assert.match(producer, /production_preflight.*production\/production-manifest\.json/s)
  assert.match(producer, /delegates Director\s+`PLAN` with the user brief/s)
  assert.match(producer, /Director authors the CreativeBrief.*complete provider-neutral ShotSpecs/s)
  assert.match(producer, /DIRECTOR_NEEDS_USER_INPUT.*ask the user and re-delegate/s)
  assert.match(producer, /pass the complete Director-authored ShotSpec array to\s+`production_set_shots`/s)
  assert.match(producer, /If validation fails, send the exact error.*complete corrected ShotSpec collection/s)
  assert.match(producer, /Do not search for or\s+read `contracts\.js`/s)
  assert.match(producer, /`production_transition`.*to_status: "previs".*to_status: "production"/s)
  assert.match(producer, /Never\s+manually edit `project\.status`, `revision`, or `history`/)
  assert.match(producer, /`production_transition` with `to_status: "production"`.*then write the\s+meaningful `production_checkpoint`/s)
  assert.match(producer, /production_prepare_artifacts.*preferably once for all known shots/s)
  assert.match(producer, /Delegate Director `PREVIS`.*absolute runtime path/s)
  assert.match(producer, /Director, not Producer,.*delegates `blender-previs`.*`video-analysis` with Watch/s)
  assert.match(producer, /DIRECTOR_NEEDS_ARTIFACT_PREPARATION.*prepare only its new\s+canonical destinations/s)
  assert.match(producer, /DIRECTOR_PREVIS_COMPLETE.*per-shot PASS evidence/s)
  assert.match(producer, /After every required\s+previs shot passes, call `production_transition`.*then write the meaningful `production_checkpoint`/s)
  assert.match(producer, /If Director returns a blocked PREVIS result, keep the manifest in `previs` and\s+write a current `production_checkpoint`.*first-pass artifacts and Watch finding.*blocked or canceled revision\s+attempt.*Do not\s+transition to `production`.*until Watch returns\s+PASS/s)
  assert.match(producer, /Producer must never call `blender-previs` or named\s+Blender as a fallback/s)
  assert.doesNotMatch(producer, /mkdir -p|pwd -P|cd <parent> && pwd -P/)
  assert.doesNotMatch(producer, /delegate_task\(category="blender-previs"\)/)
  assert.match(producer, /Producer may not delegate\s+named Blender/i)
  assert.match(producer, /Creator owns generated-media strategy, execution coordination, generated-output\s+Watch review, and bounded revisions/s)
  assert.match(producer, /Creator performs model selection, request calculation, execution,\s+polling, output interpretation, and Watch review/s)
  assert.match(producer, /explicit user approval.*maximum USD\s+exposure.*production_approve_generation/s)
  assert.match(producer, /Then delegate `\/film` post-production\s+to Editor/s)
  assert.match(producer, /production_record_output.*production_approve_final_render/s)
  assert.match(producer, /transitions? `composition -> qa`.*transition `qa -> completed`/s)
  assert.match(producer, /must not delegate `media-generation` directly/)
  assert.doesNotMatch(producer, /GPT Image 2\.5 Sunburst|Seedream 5 Pro|MiniMax H3|Seedance 2\.5/)
  assert.doesNotMatch(producer, /delegate_task\(category="media-generation"\)/)
  assert.match(producer, /edit:\n    "\*": allow/)
  assert.match(producer, /write:\n    "\*": allow/)
  assert.match(producer, /external_directory:\n    "\*": ask/)
  assert.doesNotMatch(producer, /~\/\.config\/opencode\/skills\/film-production/)

  for (const skill of [
    "hyperframes",
    "hyperframes-*",
    "media-use",
    "general-video",
    "product-launch-video",
    "faceless-explainer",
    "motion-graphics",
    "music-to-video",
    "pr-to-video",
    "embedded-captions",
    "talking-head-recut",
    "slideshow",
    "remotion-to-hyperframes",
    "figma",
  ]) assert.match(producer, new RegExp(`"${skill.replace("*", "\\*")}": allow`), skill)

  for (const tool of ["task", "workspace_prepare", "workspace_release"]) {
    assert.match(producer, new RegExp(`  ${tool}: deny`), tool)
  }
  assert.match(producer, /AIO task controls.*only for AIO children that Producer created/s)
  assert.match(producer, /Never use them to manage HyperFrames internal workers/s)

  assert.match(producer, /"git \*": deny/)
  assert.doesNotMatch(producer, /"git \*": allow/)
  assert.match(producer, /"npx skills \*": deny/)
  assert.match(producer, /"npx hyperframes skills update \*": ask/)
  assert.match(producer, /"npx hyperframes init \*": ask/)
  assert.match(command, /^agent: Producer$/m)
  assert.match(command, /^subtask: false$/m)
  assert.match(command, /\$ARGUMENTS/)
  assert.doesNotMatch(command, /film-production|media-generation|paid media generation/i)
  assert.doesNotMatch(`${producer}\n${command}`, /oh-my-openagent|call_omo_agent|Sisyphus-Junior/i)
  assert.doesNotMatch(command, /fal[.]ai|fal-mcp|seedance|kling|veo/i)

  const assistant = await readFile(`${repository}/opencode/agents/assistant.md`, "utf8")
  const watchSetup = await readFile(`${repository}/scripts/setup-watch.sh`, "utf8")
  assert.match(assistant, /category="video-analysis".*load_skills=\["watch"\]/s)
  assert.match(watchSetup, /bradautomates\/claude-video/)
  assert.doesNotMatch(producer, /video-analysis\s*->\s*watch/i)

  await assert.rejects(access(`${repository}/opencode/agents/video.md`))
  const agents = await execFileAsync("opencode", ["agent", "list"], { env, encoding: "utf8" })
  assert.match(agents.stdout, /Producer/)
  assert.doesNotMatch(agents.stdout, /\bVideo\b/)
})

test("Producer's effective shell policy gates global HyperFrames updates", async (t) => {
  const env = await isolatedOpenCodeEnv(t, repository)
  env.OPENCODE_ENABLE_EXA = "1"
  const { stdout } = await execFileAsync("opencode", ["debug", "agent", "Producer"], { env, encoding: "utf8" })
  const agent = JSON.parse(stdout)
  assert.equal(agent.name, "Producer")
  assert.equal(agent.mode, "primary")
  assert.deepEqual(agent.model, { providerID: "openai", modelID: "gpt-6-sol" })
  assert.equal(agent.variant, "high")
  assert.equal(agent.tools.websearch, true)
  assert.equal(agent.tools.task, false)
  for (const tool of [
    "delegate_task", "task_status", "task_output", "task_cancel",
    "production_preflight", "production_prepare_artifacts", "production_checkpoint",
    "production_approve_generation", "production_record_output", "production_approve_final_render",
    "production_set_shots", "production_transition",
  ]) {
    assert.equal(agent.tools[tool], true, `${tool} must remain available`)
  }

  const permission = (type, value) => {
    let action
    for (const rule of agent.permission ?? []) {
      if (rule.permission === type && globMatches(rule.pattern, value)) action = rule.action
    }
    return action
  }

  assert.equal(permission("delegate_task", "anything"), "allow")
  assert.equal(permission("task_status", "anything"), "allow")
  assert.equal(permission("task_output", "anything"), "allow")
  assert.equal(permission("task_cancel", "anything"), "allow")
  assert.equal(permission("production_preflight", "anything"), "allow")
  assert.equal(permission("production_prepare_artifacts", "anything"), "allow")
  assert.equal(permission("production_checkpoint", "anything"), "allow")
  assert.equal(permission("production_record_output", "anything"), "allow")
  assert.equal(permission("production_approve_final_render", "anything"), "allow")
  assert.equal(permission("production_set_shots", "anything"), "allow")
  assert.equal(permission("production_transition", "anything"), "allow")
  assert.equal(permission("workspace_prepare", "anything"), "deny")
  assert.equal(permission("workspace_release", "anything"), "deny")
  assert.equal(permission("bash", "npx hyperframes lint"), "allow")
  assert.equal(permission("bash", "npx hyperframes skills"), "deny")
  assert.equal(permission("bash", "npx hyperframes skills update"), "ask")
  assert.equal(permission("bash", "npx hyperframes skills update product-launch-video"), "ask")
  assert.equal(permission("bash", "npx hyperframes init"), "ask")
  assert.equal(permission("bash", "npx hyperframes init demo"), "ask")
  assert.equal(permission("bash", "HYPERFRAMES_SKIP_SKILLS=1 npx hyperframes init demo"), "ask")
  assert.equal(permission("bash", "npx skills add anything"), "deny")
  assert.equal(permission("bash", "git commit -m change"), "deny")

  const filmRoot = `${env.HOME}/.config/opencode/skills/film-production`
  const filmPhysicalRoot = await realpath(filmRoot)
  const filmReference = `${filmRoot}/references/shot-spec.md`
  assert.equal(permission("external_directory", filmReference), "allow")
  assert.equal(permission("external_directory", `${filmRoot}/SKILL.md`), "deny")
  assert.equal(permission("external_directory", `${filmPhysicalRoot}/SKILL.md`), "deny")
  assert.equal(permission("external_directory", "/unrelated/external/reference.txt"), "ask")

  for (const type of ["edit", "write"]) {
    for (const target of [
      relative(repository, `${filmRoot}/SKILL.md`),
      relative(repository, `${filmRoot}/references/shot-spec.md`),
      relative(repository, `${filmPhysicalRoot}/SKILL.md`),
      relative(repository, `${filmPhysicalRoot}/references/shot-spec.md`),
    ]) assert.equal(permission(type, target), "deny", `${type}: ${target}`)
    assert.equal(permission(type, "src/producer-workspace-output.md"), "allow", `${type} must remain usable in the project workspace`)
  }
})

test("Director resolves to GPT-6 Sol high", async (t) => {
  const env = await isolatedOpenCodeEnv(t, repository)
  const { stdout } = await execFileAsync("opencode", ["debug", "agent", "Director"], { env, encoding: "utf8" })
  const agent = JSON.parse(stdout)
  const director = await readFile(`${repository}/opencode/agents/director.md`, "utf8")

  assert.equal(agent.name, "Director")
  assert.equal(agent.mode, "subagent")
  assert.deepEqual(agent.model, { providerID: "openai", modelID: "gpt-6-sol" })
  assert.equal(agent.variant, "high")
  assert.match(director, /external_directory:\n    "\*": deny/)
  assert.doesNotMatch(director, /~\/\.config\/opencode\/skills\/film-production/)

  const permission = (type, value = "anything") => {
    let action
    for (const rule of agent.permission ?? []) {
      if (rule.permission === type && globMatches(rule.pattern, value)) action = rule.action
    }
    return action
  }

  const filmReferences = `${env.HOME}/.config/opencode/skills/film-production/references/shot-spec.md`
  const filmRoot = `${env.HOME}/.config/opencode/skills/film-production`
  assert.equal(permission("external_directory", filmReferences), "allow")
  assert.equal(permission("external_directory", `${filmRoot}/SKILL.md`), "deny")
  assert.equal(permission("external_directory", filmRoot), "deny")
  assert.equal(permission("external_directory", `${env.HOME}/.config/opencode/skills/hyperframes/SKILL.md`), "deny")
  assert.equal(permission("external_directory", "/tmp/aio-director-unrelated.txt"), "deny")
  assert.equal(permission("delegate_task"), "allow")

  for (const tool of [
    "production_preflight", "production_prepare_artifacts", "production_checkpoint",
    "production_approve_generation", "production_record_output", "production_approve_final_render", "production_set_shots", "production_transition", "bash", "write", "edit", "question",
  ]) {
    assert.equal(permission(tool), "deny", `${tool} must remain denied`)
  }
})

test("Creator resolves with bounded effective subagent permissions", async (t) => {
  const env = await isolatedOpenCodeEnv(t, repository)
  const { stdout } = await execFileAsync("opencode", ["debug", "agent", "Creator"], { env, encoding: "utf8" })
  const agent = JSON.parse(stdout)
  const creator = await readFile(`${repository}/opencode/agents/creator.md`, "utf8")

  assert.equal(agent.name, "Creator")
  assert.equal(agent.mode, "subagent")
  assert.deepEqual(agent.model, { providerID: "openai", modelID: "gpt-6.1-sol" })
  assert.equal(agent.variant, "high")
  assert.match(creator, /external_directory: deny/)
  assert.doesNotMatch(creator, /~\/.config\/opencode\/skills\/film-production/)
  assert.equal(agent.tools.delegate_task, true)

  const permission = (type, value = "anything") => {
    let action
    for (const rule of agent.permission ?? []) {
      if (rule.permission === type && globMatches(rule.pattern, value)) action = rule.action
    }
    return action
  }

  assert.equal(permission("delegate_task"), "allow")
  for (const tool of [
    "production_preflight", "production_prepare_artifacts", "production_checkpoint",
    "production_approve_generation", "production_record_output", "production_approve_final_render", "production_set_shots", "production_transition", "bash", "write", "edit", "question",
  ]) assert.equal(permission(tool), "deny", `${tool} must remain denied`)
  assert.equal(permission("external_directory", "/unrelated/external/reference.txt"), "deny")
})

function globMatches(pattern, value) {
  if (typeof pattern !== "string") return false
  const expression = `^${pattern.split("*").map(escapeRegExp).join(".*")}$`
  return new RegExp(expression).test(value)
}

test("Editor profile exposes composition tools for the runtime path guard", async (t) => {
  const env = await isolatedOpenCodeEnv(t, repository)
  const { stdout } = await execFileAsync("opencode", ["debug", "agent", "Editor"], { env, encoding: "utf8" })
  const agent = JSON.parse(stdout)
  assert.equal(agent.mode, "subagent")
  assert.deepEqual(agent.model, { providerID: "openai", modelID: "gpt-6.1-sol" })
  assert.equal(agent.variant, "high")
  const permission = (type, value = "anything") => {
    let result
    for (const rule of agent.permission ?? []) {
      if (rule.permission === type && globMatches(rule.pattern, value)) result = rule.action
    }
    return result
  }
  for (const type of ["edit", "write"]) {
    // OpenCode's static profile grants the tool; DelegationRuntime applies the
    // per-path allow/deny decision in its permission and execution hooks.
    assert.equal(permission(type, `${repository}/production/production-manifest.json`), "allow")
    assert.equal(permission(type, `${repository}/production/composition/index.html`), "allow")
  }
  for (const type of ["production_record_output", "production_approve_final_render", "production_transition", "question"]) {
    assert.equal(permission(type), "deny")
  }
  assert.equal(permission("bash", "npx hyperframes check production/composition"), "allow")
  assert.equal(permission("bash", "npx hyperframes render production/composition --output production/outputs/final.mp4"), "ask")
  assert.equal(permission("bash", "HYPERFRAMES_SKIP_SKILLS=1 npx hyperframes init production/composition"), "ask")
  assert.equal(permission("bash", "git commit -m bypass"), "deny")
  assert.equal(permission("bash", "npx hyperframes cloud production/composition"), "deny")
  assert.equal(permission("external_directory", "/unrelated/private/file"), "ask")
})

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
