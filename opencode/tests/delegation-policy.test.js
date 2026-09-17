import test from "node:test"
import assert from "node:assert/strict"

import { AgentDispatcher } from "../plugins/delegation/agent-dispatcher.js"
import { CategoryEngine } from "../plugins/delegation/category-engine.js"
import { DelegationPolicy, discoverAgents } from "../plugins/delegation/delegation-policy.js"

const effectiveAgents = [
  ...["Assistant", "Strategist", "Planner", "Executor", "Implementer"].map((name) => ({
    name,
    mode: name === "Implementer" ? "subagent" : "primary",
    builtIn: true,
  })),
  ...[
    "Explorer",
    "Librarian",
    "Technical Advisor",
    "Plan Reviewer",
    "Researcher",
    "Validator",
    "Reviewer",
    "QA",
    "Verifier",
  ].map((name) => ({ name, mode: "subagent", builtIn: true })),
  { name: "My Architect", mode: "primary", builtIn: false },
  { name: "Security Reviewer", mode: "subagent", builtIn: false },
  { name: "Untrusted Specialist", mode: "subagent", builtIn: false },
]

function config() {
  return {
    version: 1,
    categories: {
      "backend-heavy": {
        family: "backend",
        model: "provider/backend",
      },
      "family-git": {
        family: "git",
        model: "provider/family-git",
      },
    },
    agents: {
      "Security Reviewer": { delegatable: true },
      "Untrusted Specialist": { delegatable: false },
    },
    delegation: {
      "My Architect": {
        categories: ["backend-heavy", "family-git"],
        category_families: ["implementation"],
        agents: ["Explorer", "Librarian", "Security Reviewer", "Untrusted Specialist"],
      },
    },
  }
}

function dispatcher() {
  return new AgentDispatcher(new CategoryEngine(config().categories), {
    aioConfig: config(),
    availableAgents: effectiveAgents,
  })
}

test("configured callers receive explicit and family category union", () => {
  const route = dispatcher()
  assert.equal(route.resolve({ category: "standard", parentAgent: "My Architect" }).category, "standard")
  assert.equal(route.resolve({ category: "backend-heavy", parentAgent: "My Architect" }).category, "backend-heavy")
  assert.equal(route.resolve({ category: "family-git", parentAgent: "My Architect" }).category, "family-git")
  assert.throws(
    () => route.resolve({ category: "video-analysis", parentAgent: "My Architect" }),
    /My Architect is not allowed to delegate category video-analysis/,
  )
})

test("Assistant and Executor preserve broad category orchestration defaults", () => {
  const route = dispatcher()
  assert.equal(route.resolve({ category: "backend-heavy", parentAgent: "Assistant" }).agent, "Implementer")
  assert.equal(route.resolve({ category: "backend-heavy", parentAgent: "Executor" }).agent, "Implementer")
})

test("Strategist and Planner category restrictions remain hard ceilings", () => {
  const route = dispatcher()
  for (const caller of ["Strategist", "Planner"]) {
    assert.throws(
      () => route.resolve({ category: "standard", parentAgent: caller }),
      new RegExp(caller + ".*category routes are not allowed"),
    )
  }
})

test("custom delegated agents require OpenCode existence, AIO opt-in, and caller permission", () => {
  const route = dispatcher()
  assert.equal(route.resolve({ agent: "Security Reviewer", parentAgent: "My Architect" }).agent, "Security Reviewer")
  assert.throws(
    () => route.resolve({ agent: "Untrusted Specialist", parentAgent: "My Architect" }),
    /not AIO-delegatable/,
  )
  assert.throws(
    () => route.resolve({ agent: "Reviewer", parentAgent: "My Architect" }),
    /named agent is not allowed/,
  )
  assert.throws(
    () => route.resolve({ agent: "Missing Specialist", parentAgent: "My Architect" }),
    /not available in OpenCode/,
  )
})

test("independently optional delegation lists authorize only their configured routes", () => {
  const caller = { name: "My Agent", mode: "primary", builtIn: false }
  const availableAgents = [...effectiveAgents, caller]
  const cases = [
    {
      name: "categories only",
      entry: { categories: ["standard"] },
      allowed: { category: "standard" },
      denied: { agent: "Explorer" },
    },
    {
      name: "category families only",
      entry: { category_families: ["implementation"] },
      allowed: { category: "standard" },
      denied: { agent: "Explorer" },
    },
    {
      name: "agents only",
      entry: { agents: ["Explorer"] },
      allowed: { agent: "Explorer" },
      denied: { category: "standard" },
    },
    {
      name: "empty entry",
      entry: {},
      denied: { category: "standard" },
      alsoDenied: { agent: "Explorer" },
    },
    {
      name: "full entry",
      entry: { categories: ["standard"], category_families: ["implementation"], agents: ["Explorer"] },
      allowed: { category: "standard" },
      alsoAllowed: { agent: "Explorer" },
    },
  ]

  for (const testCase of cases) {
    const policy = new AgentDispatcher(new CategoryEngine({}), {
      aioConfig: { version: 1, delegation: { [caller.name]: testCase.entry } },
      availableAgents,
    })
    if (testCase.allowed) {
      assert.doesNotThrow(() => policy.resolve({ ...testCase.allowed, parentAgent: caller.name }), testCase.name)
    }
    if (testCase.alsoAllowed) {
      assert.doesNotThrow(() => policy.resolve({ ...testCase.alsoAllowed, parentAgent: caller.name }), testCase.name)
    }
    for (const denied of [testCase.denied, testCase.alsoDenied].filter(Boolean)) {
      assert.throws(
        () => policy.resolve({ ...denied, parentAgent: caller.name }),
        /not allowed/,
        testCase.name,
      )
    }
  }
})

test("workflow named-agent ceilings and Verifier boundary remain hard", () => {
  const route = dispatcher()
  assert.equal(route.resolve({ agent: "Researcher", parentAgent: "Strategist" }).agent, "Researcher")
  assert.equal(route.resolve({ agent: "Verifier", parentAgent: "Executor" }).agent, "Verifier")
  assert.throws(
    () => route.resolve({ agent: "Security Reviewer", parentAgent: "Strategist" }),
    /Strategist cannot delegate named agent Security Reviewer/,
  )
  assert.throws(
    () => route.resolve({ agent: "Verifier", parentAgent: "My Architect" }),
    /Verifier may only be delegated by Executor/,
  )
})

test("unknown callers fail closed", () => {
  const route = dispatcher()
  assert.throws(
    () => route.resolve({ category: "standard", parentAgent: "Unknown Architect" }),
    /Unknown Architect is not allowed/,
  )
  assert.throws(
    () => route.resolve({ agent: "Explorer", parentAgent: "Unknown Architect" }),
    /named agent is not allowed/,
  )
})

test("custom primary agents must be effective OpenCode agents", () => {
  const categoryEngine = new CategoryEngine({})
  const policy = new DelegationPolicy({
    aioConfig: {
      version: 1,
      delegation: { "My Architect": { categories: ["standard"] } },
    },
    categoryEngine,
    availableAgents: [{ name: "Assistant", mode: "primary" }],
  })
  assert.equal(policy.canUseCategory({ caller: "My Architect", category: "standard" }), false)
})

test("configured custom agents fail closed when no public discovery result exists", () => {
  const categoryEngine = new CategoryEngine({})
  const policy = new DelegationPolicy({
    aioConfig: {
      version: 1,
      agents: { "Security Reviewer": { delegatable: true } },
      delegation: {
        "My Architect": { agents: ["Security Reviewer"], categories: ["standard"] },
      },
    },
    categoryEngine,
  })
  assert.equal(policy.canUseCategory({ caller: "My Architect", category: "standard" }), false)
  assert.equal(policy.canDelegateAgent({ caller: "My Architect", agent: "Security Reviewer" }), false)
})

test("agent discovery uses the public OpenCode app API", async () => {
  const calls = []
  const result = await discoverAgents({
    directory: "/workspace/project",
    client: {
      app: {
        agents: async (input) => {
          calls.push(input)
          return { data: [{ name: "My Architect", mode: "primary" }] }
        },
      },
    },
  })
  assert.deepEqual(result, [{ name: "My Architect", mode: "primary" }])
  assert.deepEqual(calls, [{ query: { directory: "/workspace/project" } }])
})
