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
  for (const tool of ["task_status", "task_output", "task_cancel"]) {
    assert.match(producer, new RegExp(`^  ${tool}: allow$`, "m"), tool)
  }
  assert.match(producer, /Producer owns production lifecycle, state, phase assignment, budget/i)
  assert.match(producer, /transitional\s+capabilities/i)
  assert.match(producer, /Producer may delegate these three named phase owners/i)
  assert.match(producer, /delegate_task\(category="blender-previs"\)/)
  assert.match(producer, /explicit artifact destinations inside the active\s+production\s+workspace[\s\S]*`production\/previs\/<shot-or-group>\/`/i)
  assert.match(producer, /`\.blend` source destination/i)
  assert.match(producer, /key-stills directory\s+or\s+explicit still paths/i)
  assert.match(producer, /moving-shot preview MP4 destination/i)
  assert.match(producer, /do not omit destinations or let the category invent an output directory/i)
  assert.match(producer, /Before delegation, prepare and verify exactly the parent\s+directories required\s+by those supplied destinations/i)
  assert.match(producer, /targeted `mkdir -p` through Producer's shell access/i)
  assert.match(producer, /do not create artifact\s+files, unrelated directories, or delegate directory creation to\s+`blender-previs`/i)
  assert.match(producer, /If a required parent is still missing, stop and report the\s+missing supplied destination/i)
  assert.match(producer, /Keep canonical artifact paths workspace-relative in ShotSpecs and the\s+ProductionManifest/i)
  assert.match(producer, /resolve separate runtime destinations\s+for Blender: capture the physical active workspace root with `pwd -P`/i)
  assert.match(producer, /accept only canonical paths rooted under `production\/previs\/`\s+that are relative and contain no `\.` or `\.\.` path segments/i)
  assert.match(producer, /resolve each\s+already-prepared parent directory with `cd <parent> && pwd -P`/i)
  assert.match(producer, /separator-aware boundary check/i)
  assert.match(producer, /Build each absolute runtime destination from the verified physical\s+parent/i)
  assert.match(producer, /never pass a workspace-relative value as a Blender\s+destination/i)
  assert.match(producer, /never persist host-specific\s+absolute paths into canonical production state/i)
  assert.match(producer, /editable `\.blend` source, key stills, and a low-resolution preview MP4/s)
  assert.match(producer, /viewport\/OpenGL\/playblast first,\s+Workbench next, and lightweight Eevee only when needed/i)
  assert.match(producer, /ordinary previs must\s+not use Cycles, high samples, expensive denoising/i)
  assert.match(producer, /about 8–12 fps for moving\s+previews while preserving the ShotSpec's full duration and canonical output\s+fps/i)
  assert.match(producer, /For every shot that requests camera and\/or subject motion.*pre-render motion verification before it may\s+generate the preview MP4/s)
  assert.match(producer, /start, middle, and end frames for each requested moving target/i)
  assert.match(producer, /Pan\/tilt can be evidenced by\s+orientation changes with fixed camera location/i)
  assert.match(producer, /Missing or inconsistent requested motion blocks MP4\s+generation until corrected and re-verified/i)
  assert.match(producer, /post-render Watch review, which remains required/i)
  assert.match(producer, /If a save, still render, or playblast MCP call times out, treat completion as\s+ambiguous/i)
  assert.match(producer, /Verify\s+only the exact paths supplied to that child/i)
  assert.match(producer, /do not repeat the same artifact-producing operation automatically/i)
  assert.match(producer, /a still must be non-empty and have its expected image format/i)
  assert.match(producer, /an MP4's non-empty\s+size is preliminary until Watch can decode and review it/i)
  assert.match(producer, /delegate_task\(category="video-analysis", load_skills=\["watch"\]\)/)
  assert.match(producer, /Only after a PASS should Producer finalize generation instructions.*`media-generation`/s)
  assert.match(producer, /Do not use\s+`delegate_task\(agent="Blender"\)` for video production/s)
  assert.match(producer, /Producer may not delegate\s+named Blender/i)
  assert.match(producer, /If the category or review\s+delegation is unavailable, stop and surface the delegation\/tooling problem/s)
  assert.doesNotMatch(producer, /For every Blender-native task.*delegate_task\(agent="Blender"\)/s)
  for (const forbiddenFallback of [
    /must not write a `bpy` Python script/i,
    /call\s+the Blender CLI/i,
    /launch `\/Applications\/Blender\.app\/\.\.\.\/Blender`/i,
    /invoke\s+Blender MCP directly/i,
    /use bash to perform Blender-native implementation/i,
    /create `\.blend` artifacts itself/i,
  ]) assert.match(producer, forbiddenFallback)
  assert.match(producer, /fast, rough previews for validation/s)
  assert.match(producer, /Blender\s+does not receive categor(?:y|ies)/s)
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
  assert.match(producer, /external_directory: ask/)

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
  for (const tool of ["delegate_task", "task_status", "task_output", "task_cancel"]) {
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
})

function globMatches(pattern, value) {
  if (typeof pattern !== "string") return false
  const expression = `^${pattern.split("*").map(escapeRegExp).join(".*")}$`
  return new RegExp(expression).test(value)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
