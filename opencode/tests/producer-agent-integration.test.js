import test from "node:test"
import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const here = dirname(fileURLToPath(import.meta.url))
const repository = resolve(here, "../..")
const execFileAsync = promisify(execFile)

test("Producer is a dedicated HyperFrames primary route", async () => {
  const producer = await readFile(`${repository}/opencode/agents/producer.md`, "utf8")
  const command = await readFile(`${repository}/opencode/commands/video.md`, "utf8")

  assert.match(producer, /^name: Producer$/m)
  assert.match(producer, /^mode: primary$/m)
  assert.match(producer, /dedicated primary agent for HyperFrames/i)
  assert.match(producer, /not a general coding agent/i)
  assert.match(producer, /OpenSpec planner or executor/i)
  assert.match(producer, /official upstream\s+`hyperframes` skill/i)
  assert.match(producer, /User -> \/video -> Producer -> \/hyperframes/s)
  assert.match(producer, /question: allow/)
  assert.match(producer, /websearch: allow/)
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

  for (const tool of [
    "task",
    "delegate_task",
    "workspace_prepare",
    "workspace_release",
    "task_status",
    "task_output",
    "task_cancel",
  ]) assert.match(producer, new RegExp(`  ${tool}: deny`), tool)

  assert.match(producer, /"git \*": deny/)
  assert.doesNotMatch(producer, /"git \*": allow/)
  assert.match(producer, /"npx skills \*": deny/)
  assert.match(producer, /"npx hyperframes skills update \*": ask/)
  assert.match(producer, /"npx hyperframes init \*": ask/)
  assert.match(command, /^agent: Producer$/m)
  assert.match(command, /^subtask: false$/m)
  assert.match(command, /\$ARGUMENTS/)
  assert.doesNotMatch(`${producer}\n${command}`, /oh-my-openagent|call_omo_agent|Sisyphus-Junior/i)
  assert.doesNotMatch(`${producer}\n${command}`, /fal[.]ai|fal-mcp|seedance|kling|veo/i)

  const assistant = await readFile(`${repository}/opencode/agents/assistant.md`, "utf8")
  const watchSetup = await readFile(`${repository}/scripts/setup-watch.sh`, "utf8")
  assert.match(assistant, /category="video-analysis".*load_skills=\["watch"\]/s)
  assert.match(watchSetup, /bradautomates\/claude-video/)
  assert.doesNotMatch(producer, /video-analysis\s*->\s*watch/i)

  await assert.rejects(access(`${repository}/opencode/agents/video.md`))
  const agents = await execFileAsync("opencode", ["agent", "list"], { encoding: "utf8" })
  assert.match(agents.stdout, /Producer/)
  assert.doesNotMatch(agents.stdout, /\bVideo\b/)
})

test("Producer's effective shell policy gates global HyperFrames updates", async () => {
  const { stdout } = await execFileAsync("opencode", ["debug", "agent", "Producer"], { encoding: "utf8" })
  const agent = JSON.parse(stdout)
  assert.equal(agent.name, "Producer")
  assert.equal(agent.mode, "primary")
  assert.equal(agent.tools.websearch, true)
  assert.equal(agent.tools.task, false)
  assert.equal(agent.tools.delegate_task, false)
  assert.equal(agent.tools.workspace_prepare, false)
  assert.equal(agent.tools.workspace_release, false)

  const permission = (type, value) => {
    let action
    for (const rule of agent.permission ?? []) {
      if (rule.permission === type && globMatches(rule.pattern, value)) action = rule.action
    }
    return action
  }

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
