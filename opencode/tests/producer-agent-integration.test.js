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
  assert.match(producer, /bounded supporting capabilities.*AIO delegation policy/s)
  assert.match(producer, /category ceiling is the\s+`media` family, currently `video-analysis` and `media-generation`; its named\s+specialist route is `Blender`/s)
  assert.match(producer, /delegate_task\(agent="Blender"\)/)
  assert.match(producer, /scene\s+blocking, subject staging, camera placement or movement/s)
  assert.match(producer, /fast, rough previews for validation/s)
  assert.match(producer, /Blender\s+does not receive categor(?:y|ies)/s)
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
  assert.doesNotMatch(`${producer}\n${command}`, /fal[.]ai|fal-mcp|seedance|kling|veo/i)

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
