import test from "node:test"
import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"

const root = "/Users/code/.config/opencode"

const commandTargets = new Map([
  ["omo.md", "Prometheus - Plan Builder"],
  ["spec.md", "Strategist"],
  ["plan.md", "Planner"],
  ["execute.md", "Executor"],
  ["verify.md", "Verifier"],
  ["ship.md", "Executor"],
])

const oldCommands = [
  "strategy-to-plan.md",
  "strategy-to-spec.md",
  "spec-plan.md",
  "spec-execute.md",
  "verify-change.md",
  "spec-ship.md",
]

const agentNames = new Map([
  ["strategist.md", "Strategist"],
  ["researcher.md", "Researcher"],
  ["validator.md", "Validator"],
  ["planner.md", "Planner"],
  ["plan-reviewer.md", "Plan Reviewer"],
  ["executor.md", "Executor"],
  ["reviewer.md", "Reviewer"],
  ["qa.md", "QA"],
  ["verifier.md", "Verifier"],
])

const oldAgents = [
  "chaos.md",
  "chaos-researcher.md",
  "chaos-validator.md",
  "spec-planner.md",
  "spec-reviewer.md",
  "spec-executor.md",
  "code-reviewer.md",
  "qa-runner.md",
  "change-verifier.md",
]

test("new agent files expose exact role names and old definitions are absent", async () => {
  const files = (await readdir(`${root}/agents`)).filter((name) => !name.includes(".bak."))
  for (const [file, name] of agentNames) {
    assert.ok(files.includes(file))
    assert.match(await readFile(`${root}/agents/${file}`, "utf8"), new RegExp(`^name: ${name}$`, "m"))
  }
  for (const file of oldAgents) assert.equal(files.includes(file), false)
})

test("new command files exist with exact agent targets and old commands are absent", async () => {
  const files = (await readdir(`${root}/commands`)).filter((name) => !name.includes(".bak."))
  assert.deepEqual(files.filter((name) => name.endsWith(".md")).sort(), [...commandTargets.keys()].sort())
  for (const [file, agent] of commandTargets) {
    assert.ok(files.includes(file), `${file} must be discovered from its filename`)
    const content = await readFile(`${root}/commands/${file}`, "utf8")
    assert.match(content, new RegExp(`^agent: ${agent}$`, "m"))
  }
  for (const file of oldCommands) assert.equal(files.includes(file), false)
  assert.equal(files.includes("worktree.md"), false)
})

test("plan command targets custom Planner and cannot select native plan implicitly", async () => {
  const content = await readFile(`${root}/commands/plan.md`, "utf8")
  assert.match(content, /^agent: Planner$/m)
  assert.doesNotMatch(content, /^agent: (plan|Prometheus - Plan Builder)$/m)
})

test("active workflow files contain no old command handoffs", async () => {
  const oldReferences = /\/(?:strategy-to-plan|strategy-to-spec|spec-plan|spec-execute|verify-change|spec-ship)\b/
  for (const directory of ["agents", "commands", "plugins", "tests"]) {
    const files = (await readdir(`${root}/${directory}`)).filter(
      (name) => !name.includes(".bak.") && /\.(?:md|js)$/.test(name),
    )
    for (const file of files) {
      assert.doesNotMatch(await readFile(`${root}/${directory}/${file}`, "utf8"), oldReferences)
    }
  }
})
