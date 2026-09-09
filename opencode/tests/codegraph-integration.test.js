import test from "node:test"
import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"

const root = "/Users/code/.config/opencode"
const enabled = [
  "assistant.md",
  "explorer.md",
  "technical-advisor.md",
  "planner.md",
  "plan-reviewer.md",
  "executor.md",
  "reviewer.md",
  "verifier.md",
]
const excluded = ["strategist.md", "researcher.md", "validator.md", "qa.md", "librarian.md"]
const permission = "codegraph_codegraph_explore: allow"

async function agent(name) {
  return readFile(`${root}/agents/${name}`, "utf8")
}

test("only structurally relevant agents receive the exact explore permission", async () => {
  for (const name of enabled) {
    const source = await agent(name)
    assert.equal(source.split(permission).length - 1, 1, `${name} must allow exactly one explore permission`)
    assert.match(source, /permission:\n  "\*": deny/)
    assert.doesNotMatch(source, /codegraph[^\n]*\*/i)
  }

  for (const name of excluded) {
    assert.doesNotMatch(await agent(name), /codegraph/i)
  }

  const files = (await readdir(`${root}/agents`)).filter((name) => name.endsWith(".md"))
  const holders = []
  for (const name of files) {
    if ((await agent(name)).includes(permission)) holders.push(name)
  }
  assert.deepEqual(holders.sort(), [...enabled].sort())
})

test("CodeGraph doctrine is bounded and evidence calibrated", async () => {
  for (const name of ["explorer.md", "planner.md", "plan-reviewer.md", "executor.md", "reviewer.md", "verifier.md"]) {
    const source = await agent(name)
    assert.match(source, /available and (?:its index is )?current/i)
    assert.match(source, /Treat current source returned by CodeGraph as already read/i)
    assert.match(source, /do not duplicate|do not repeat/i)
    assert.match(source, /Fall back immediately/i)
    assert.match(source, /unavailable, pending, unindexed, stale, ambiguous, insufficient/i)
    assert.match(source, /structural evidence/i)
    assert.match(source, /not proof/i)
    assert.match(source, /never (?:become a )?block|must never block/i)
    assert.doesNotMatch(source, /codegraph (?:init|sync|serve|watch|clean|delete)/i)
  }
})

test("role-specific CodeGraph guidance preserves evidence boundaries", async () => {
  assert.match(await agent("explorer.md"), /architecture, structural relationships, and cross-file call\/data flow/)
  assert.match(await agent("planner.md"), /architecture, dependencies, callers\/consumers, and task topology/)
  assert.match(await agent("plan-reviewer.md"), /high-impact structural claims/)
  assert.match(await agent("executor.md"), /Worker access is not assumed/)
  assert.match(await agent("reviewer.md"), /Start from the actual comparison diff/)
  assert.match(await agent("verifier.md"), /read-only requirement navigator/)
  assert.match(await agent("verifier.md"), /actual source and diff plus fresh tests\/runtime proof/)
})

test("commands and excluded roles do not acquire CodeGraph lifecycle ownership", async () => {
  for (const directory of ["commands"]) {
    const files = (await readdir(`${root}/${directory}`)).filter((name) => name.endsWith(".md"))
    for (const name of files) {
      assert.doesNotMatch(await readFile(`${root}/${directory}/${name}`, "utf8"), /codegraph/i)
    }
  }
  for (const name of excluded) {
    assert.doesNotMatch(await agent(name), /codegraph/i)
  }
})

test("CodeGraph is configured directly through its public MCP server", async () => {
  const config = await readFile(`${root}/opencode.jsonc`, "utf8")
  assert.match(config, /"codegraph",\s*"serve",\s*"--mcp"/s)
  assert.doesNotMatch(config, /oh-my-openagent/i)
})
