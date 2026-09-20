import test from "node:test"
import assert from "node:assert/strict"

import { AgentDispatcher } from "../plugins/delegation/agent-dispatcher.js"
import { CategoryEngine } from "../plugins/delegation/category-engine.js"
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

function runtime(delegation = {}, extraCategories = {}) {
  if (delegation?.categories && !delegation?.delegation) {
    extraCategories = delegation.categories
    delegation = {}
  }
  const aioConfig = {
    version: 1,
    categories: {
      "caller-only": {
        description: "Caller-only support",
        family: "support",
        model: "example/support",
      },
      disabled: {
        description: "Disabled support",
        model: "example/disabled",
        disable: true,
      },
      ...extraCategories,
    },
    delegation,
  }
  return new DelegationRuntime({
    dispatcher: new AgentDispatcher(new CategoryEngine(aioConfig.categories), {
      aioConfig,
      availableAgents,
    }),
    profiles: new Map(),
    skills: { list: () => [] },
  })
}

async function systemFor(runtimeInstance, agent) {
  const sessionID = `${agent}-session`
  await runtimeInstance.applyChatParams(sessionID, {}, agent)
  const output = { system: ["authored system instructions"] }
  runtimeInstance.applyChatSystem(sessionID, output)
  runtimeInstance.applyChatSystem(sessionID, output)
  return output.system
}

test("catalogs are caller-specific and omit disabled categories", async () => {
  const instance = runtime()
  const assistant = await systemFor(instance, "Assistant")
  const executor = await systemFor(instance, "Executor")

  for (const system of [assistant, executor]) {
    assert.equal(system[0], "authored system instructions")
    assert.equal(system.length, 2)
    assert.match(system[1], /<AIO_Delegation_Categories>/)
    assert.match(system[1], /- quick:/)
    assert.doesNotMatch(system[1], /- disabled:/)
  }
  assert.match(assistant[1], /- caller-only: Caller-only support/)
  assert.match(assistant[1], /- git:/)
  assert.match(assistant[1], /- media-generation:/)
  assert.doesNotMatch(executor[1], /- caller-only:|- video-analysis:|- media-generation:/)
  assert.match(executor[1], /- browser-testing:/)
  assert.match(executor[1], /- git:/)
})

test("primary and formal workflow ceilings shape the injected catalog", async () => {
  const defaults = runtime()
  const producer = await systemFor(defaults, "Producer")
  const blenderDefault = await systemFor(defaults, "Blender")
  const planner = await systemFor(defaults, "Planner")
  const strategist = await systemFor(defaults, "Strategist")

  assert.match(producer[1], /- video-analysis:/)
  assert.match(producer[1], /- media-generation:/)
  assert.doesNotMatch(producer[1], /- quick:|- caller-only:|- git:/)
  assert.deepEqual(blenderDefault, ["authored system instructions"])
  for (const system of [planner, strategist]) {
    assert.match(system[1], /- none/)
    assert.doesNotMatch(system[1], /- quick:|- video-analysis:|- caller-only:/)
  }

  const explicit = runtime({
    Producer: { categories: ["standard"] },
    Blender: { categories: ["video-analysis"], category_families: ["support"] },
  })
  const producerExtended = await systemFor(explicit, "Producer")
  const blenderExtended = await systemFor(explicit, "Blender")
  assert.match(producerExtended[1], /- video-analysis:/)
  assert.match(producerExtended[1], /- media-generation:/)
  assert.doesNotMatch(producerExtended[1], /- standard:/)
  assert.deepEqual(blenderExtended, ["authored system instructions"])
})

test("catalog family ceilings follow future category families", async () => {
  const instance = runtime({
    categories: {
      "implementation-future": {
        description: "Future implementation",
        family: "implementation",
        model: "example/implementation-future",
      },
      "media-future": {
        description: "Future media",
        family: "media",
        model: "example/media-future",
      },
    },
  })
  const assistant = await systemFor(instance, "Assistant")
  const executor = await systemFor(instance, "Executor")
  const producer = await systemFor(instance, "Producer")

  assert.match(assistant[1], /- implementation-future:/)
  assert.match(assistant[1], /- media-future:/)
  assert.match(executor[1], /- implementation-future:/)
  assert.doesNotMatch(executor[1], /- media-future:/)
  assert.match(producer[1], /- media-future:/)
  assert.doesNotMatch(producer[1], /- implementation-future:/)
})

test("Searcher and Browser remain catalog-free leaves", async () => {
  const instance = runtime({
    Searcher: { categories: ["caller-only"] },
    Browser: { categories: ["caller-only"] },
  })
  for (const agent of ["Searcher", "Browser"]) {
    assert.deepEqual(await systemFor(instance, agent), ["authored system instructions"])
  }
})
