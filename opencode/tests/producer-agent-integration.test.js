import test from "node:test"
import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { dirname, resolve } from "node:path"
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
    "production_set_shots", "production_transition",
  ]) {
    assert.match(producer, new RegExp(`^  ${tool}: allow$`, "m"))
  }
  for (const tool of ["task_status", "task_output", "task_cancel"]) {
    assert.match(producer, new RegExp(`^  ${tool}: allow$`, "m"), tool)
  }
  assert.match(producer, /Producer owns production lifecycle, state, phase assignment, budget/i)
  assert.match(producer, /transitional\s+capabilities/i)
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
  assert.match(producer, /Producer must never call `blender-previs` or named\s+Blender as a fallback/s)
  assert.doesNotMatch(producer, /mkdir -p|pwd -P|cd <parent> && pwd -P/)
  assert.doesNotMatch(producer, /delegate_task\(category="blender-previs"\)/)
  assert.match(producer, /Producer may not delegate\s+named Blender/i)
  assert.match(producer, /transitional live generation strategy.*`media-generation` and `video-analysis`/s)
  assert.match(producer, /HyperFrames composition until later milestones/)
  assert.match(producer, /Image shots use GPT Image 2 for ordinary\/value work.*GPT Image 2\.5 Sunburst.*Seedream 5 Pro/s)
  assert.match(producer, /Video shots use Wan 3\.0 for ordinary or\s+balanced work.*MiniMax H3.*Seedance 2\.5/s)
  assert.match(producer, /explicitly supported user model choice\s+always wins/s)
  assert.match(producer, /There is no automatic paid fallback/s)
  assert.match(producer, /GPT Image 2 `quality` is low for drafts/s)
  assert.match(producer, /`generate_audio: false` when downstream audio owns the soundtrack/s)
  assert.match(producer, /reference_audio_asset_ids[\s\S]*generate_audio[\s\S]*independent/s)
  assert.match(producer, /H3 still needs a visual reference[\s\S]*Seedance supports combined\s+audio\/visual references and audio-only references/s)
  assert.match(producer, /does not create a new routing tier/s)
  assert.match(producer, /never auto-escalate or hardcode media prices/s)
  assert.match(producer, /edit:\n    "\*": allow/)
  assert.match(producer, /write:\n    "\*": allow/)
  assert.match(producer, /external_directory:\s+"\*": ask\s+"~\/\.config\/opencode\/skills\/film-production\/references\/\*": allow/)

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
  const { stdout } = await execFileAsync("opencode", ["debug", "agent", "Producer"], { env, encoding: "utf8" })
  const agent = JSON.parse(stdout)
  assert.equal(agent.name, "Producer")
  assert.equal(agent.mode, "primary")
  assert.equal(agent.tools.websearch, true)
  assert.equal(agent.tools.task, false)
  for (const tool of [
    "delegate_task", "task_status", "task_output", "task_cancel",
    "production_preflight", "production_prepare_artifacts", "production_checkpoint",
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

  const filmReferencePattern = `${env.HOME}/.config/opencode/skills/film-production/references/*`
  assert.ok(agent.permission.some((rule) =>
    rule.permission === "external_directory"
      && rule.pattern === filmReferencePattern
      && rule.action === "allow"), "native permission profile must allow the isolated installed film reference subtree")
  assert.equal(permission("external_directory", `${env.HOME}/.config/opencode/skills/film-production/references/shot-spec.md`), "allow")
  assert.equal(permission("external_directory", "/unrelated/external/reference.txt"), "ask")
})

function globMatches(pattern, value) {
  if (typeof pattern !== "string") return false
  const expression = `^${pattern.split("*").map(escapeRegExp).join(".*")}$`
  return new RegExp(expression).test(value)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
