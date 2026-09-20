import test from "node:test"
import assert from "node:assert/strict"

import { AgentDispatcher } from "../plugins/delegation/agent-dispatcher.js"
import { CategoryEngine, DEFAULT_CATEGORIES } from "../plugins/delegation/category-engine.js"
import { categoryPermission, categorySessionPermission } from "../plugins/delegation/category-permissions.js"
import { DelegationRuntime } from "../plugins/delegation/runtime.js"

const availableAgents = [
  "Assistant",
  "Executor",
  "Planner",
  "Strategist",
  "Producer",
  "Blender",
  "Searcher",
  "Browser",
].map((name) => ({ name, mode: name === "Searcher" ? "all" : "primary" }))

function dispatcher(aioConfig = { version: 1, delegation: {} }, agents = availableAgents) {
  const engine = new CategoryEngine(aioConfig.categories ?? {})
  return new AgentDispatcher(engine, { aioConfig, availableAgents: agents })
}

async function catalogFor(runtime, agent) {
  const sessionID = `${agent}-browser-testing-session`
  await runtime.applyChatParams(sessionID, {}, agent)
  const output = { system: ["authored system instructions"] }
  runtime.applyChatSystem(sessionID, output)
  return output.system
}

test("browser-testing is a built-in Implementer category using its configured model profile", () => {
  const category = DEFAULT_CATEGORIES["browser-testing"]
  assert.ok(category)
  assert.equal(category.family, "implementation")
  assert.equal(category.model, "openai/gpt-5.6-terra")
  assert.equal(category.variant, "medium")
  const engine = new CategoryEngine({})
  assert.equal(engine.has("browser-testing"), true)
  assert.equal(engine.resolve("browser-testing").agent, "Implementer")
  assert.match(category.prompt_append, /agent-browser/)
  assert.match(category.prompt_append, /session-setup command in its own Bash invocation/i)
  assert.match(category.prompt_append, /agent-browser session id --scope worktree --prefix "browser-testing-\$\(date \+%s\)-\$\$"/)
  assert.match(category.prompt_append, /prints the literal session ID to stdout/i)
  assert.match(category.prompt_append, /capture that exact output/i)
  assert.match(category.prompt_append, /browser-testing-<timestamp>-<pid>-<worktree-hash>/)
  assert.match(category.prompt_append, /open -> wait -> snapshot -> interact -> re-snapshot/i)
  assert.match(category.prompt_append, /successful browser command as proof only/i)
  assert.match(category.prompt_append, /never as proof that the application interaction succeeded/i)
  assert.match(category.prompt_append, /observable postcondition/i)
  assert.match(category.prompt_append, /perform the action -> verify.*postcondition/i)
  assert.match(category.prompt_append, /re-snapshot.*target or ref.*retry once.*normal agent-browser interaction/i)
  assert.match(category.prompt_append, /suspected no-op interaction/i)
  assert.match(category.prompt_append, /PASS requires the expected observable postcondition/i)
  assert.match(category.prompt_append, /FAIL \/ MISMATCH.*interaction occurred/i)
  assert.match(category.prompt_append, /relevant console or error evidence.*network evidence/i)
  assert.match(category.prompt_append, /DOM or JavaScript event dispatch.*diagnostic experiment/i)
  assert.match(category.prompt_append, /do not mark the original interaction as PASS/i)
  assert.match(category.prompt_append, /do not use a fixed --prefix task/i)
  assert.match(category.prompt_append, /fresh processes/i)
  assert.match(category.prompt_append, /do not rely on a shell variable or exported AGENT_BROWSER_SESSION persisting/i)
  assert.match(category.prompt_append, /do not substitute a shell variable in later calls/i)
  assert.doesNotMatch(category.prompt_append, /session_id=/)
  assert.match(category.prompt_append, /only agent-browser command that may run without an existing --session selection/i)
  assert.match(category.prompt_append, /every subsequent guidance, browser interaction, inspection, diagnostic, screenshot, recording, and cleanup command must explicitly use --session "<literal-session-id>"/i)
  assert.match(category.prompt_append, /use that exact literal in every later invocation/i)
  assert.doesNotMatch(category.prompt_append, /agent-browser --session "\$session_id"/)
  assert.match(category.prompt_append, /shared unnamed\/default agent-browser session/i)
  assert.match(category.prompt_append, /agent-browser --session "browser-testing-<timestamp>-<pid>-<worktree-hash>" close/)
  assert.match(category.prompt_append, /runtime readiness is uncertain/i)
  assert.match(category.prompt_append, /agent-browser --session "browser-testing-<timestamp>-<pid>-<worktree-hash>" doctor --offline --quick/)
  assert.match(category.prompt_append, /lightweight check may skip browser launch validation/i)
  assert.match(category.prompt_append, /browser startup actually fails and the quick check is insufficient/i)
  assert.match(category.prompt_append, /agent-browser --session "browser-testing-<timestamp>-<pid>-<worktree-hash>" doctor\./)
  assert.match(category.prompt_append, /do not run doctor unconditionally/i)
  assert.match(category.prompt_append, /distinguish a browser\/runtime setup failure from an application failure/i)
  assert.match(category.prompt_append, /existing Playwright, Cypress, WebdriverIO, or other project-native E2E suite/i)
  assert.match(category.prompt_append, /do not rewrite existing tests.*agent-browser scripts/i)
  assert.match(category.prompt_append, /do not install a new E2E framework automatically/i)
  assert.match(category.prompt_append, /make Playwright the default/i)
  assert.match(category.prompt_append, /missing.*prerequisite/i)
  assert.match(category.prompt_append, /separate from the dedicated Browser agent.*ego-browser backend/i)
})

test("browser-testing follows generic caller policy without special-case grants", () => {
  const route = dispatcher()
  for (const caller of ["Assistant", "Executor"]) {
    assert.equal(route.resolve({ category: "browser-testing", parentAgent: caller }).agent, "Implementer")
  }
  for (const caller of ["Planner", "Strategist", "Implementer", "Producer", "Blender"]) {
    assert.throws(
      () => route.resolve({ category: "browser-testing", parentAgent: caller }),
      /(?:not allowed|category routes are not allowed)/,
      caller,
    )
  }

  const customCaller = "Browser QA Coordinator"
  const extended = dispatcher({
    version: 1,
    delegation: { [customCaller]: { category_families: ["implementation"] } },
  }, [...availableAgents, { name: customCaller, mode: "primary" }])
  assert.equal(extended.resolve({ category: "browser-testing", parentAgent: customCaller }).agent, "Implementer")
})

test("caller-specific catalogs include browser-testing only for authorized orchestrators", async () => {
  const instance = new DelegationRuntime({
    dispatcher: dispatcher(),
    profiles: new Map(),
    skills: { list: () => [] },
  })
  for (const agent of ["Assistant", "Executor"]) {
    const system = await catalogFor(instance, agent)
    assert.match(system[1], /- browser-testing: Technical browser verification for web implementations/)
  }
  for (const agent of ["Producer", "Blender", "Planner", "Strategist", "Searcher", "Browser"]) {
    const system = await catalogFor(instance, agent)
    assert.doesNotMatch(system.join("\n"), /browser-testing/)
  }
})

test("browser-testing reuses ordinary Implementer permissions", () => {
  assert.equal(categorySessionPermission("browser-testing"), undefined)
  assert.equal(categoryPermission({ category: "browser-testing" }, {
    type: "bash",
    pattern: "agent-browser --session browser-testing-id open http://localhost:3000",
  }), null)
  assert.equal(categoryPermission({ category: "browser-testing" }, {
    type: "bash",
    pattern: "git add -- src/app.js",
  }), "deny")
  assert.equal(categoryPermission({ category: "browser-testing" }, {
    type: "skill",
    pattern: "ego-browser",
  }), "deny")
})
