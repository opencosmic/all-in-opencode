import { DEFAULT_DELEGATION, normalizeAioConfig, withDefaultDelegation } from "./aio-config.js"
import { sdkData } from "./sdk.js"

const BUILTIN_NAMED_AGENTS = new Set([
  "Explorer",
  "Librarian",
  "Technical Advisor",
  "Plan Reviewer",
  "Researcher",
  "Validator",
  "Reviewer",
  "QA",
  "Searcher",
])

const CONSULTATION_AGENTS = new Set(["Explorer", "Librarian"])

const PARENT_AGENT_NAMED_AGENTS = new Map([
  ["Strategist", new Set(["Explorer", "Librarian", "Researcher", "Validator"])],
  ["Planner", new Set(["Explorer", "Librarian", "Technical Advisor", "Plan Reviewer"])],
  ["Executor", new Set(["Plan Reviewer", "Reviewer", "QA", "Verifier", "Blender"])],
  ["Producer", new Set(["Director", "Creator", "Editor"])],
  ["Director", new Set()],
  ["Creator", new Set()],
  ["Editor", new Set()],
])

const BUILTIN_PRIMARY_AGENTS = new Set(["Assistant", "Strategist", "Planner", "Executor"])
const CATEGORY_RESTRICTED_PARENTS = new Set(["Strategist", "Planner", "Blender"])
const BROAD_CATEGORY_PARENTS = new Set(["Assistant"])
const CATEGORY_FAMILY_CEILINGS = new Map([
  ["Executor", "implementation"],
  ["Producer", "media"],
])
const PHASE_OWNER_CATEGORY_CEILINGS = new Map([
  ["Director", new Set(["blender-previs", "video-analysis"])],
  ["Creator", new Set(["media-generation", "video-analysis"])],
  ["Editor", new Set(["video-analysis"])],
])
export const DELEGATING_NAMED_AGENTS = new Set(PHASE_OWNER_CATEGORY_CEILINGS.keys())
// A category may need a narrower caller boundary than its family provides.
// Keep that exception in DelegationPolicy so catalogs and runtime resolution
// share the same authorization path; it is not a second permission system.
const CATEGORY_CALLER_ALLOWLISTS = new Map([
  ["blender-previs", new Set(["Producer", "Director"])],
])
const BUILTIN_AGENT_NAMES = new Set([
  ...BUILTIN_PRIMARY_AGENTS,
  "Browser",
  "Blender",
  "Producer",
  "Director",
  "Creator",
  "Editor",
  "Searcher",
  "Professor",
  "Implementer",
  ...BUILTIN_NAMED_AGENTS,
  "Verifier",
])

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizedConfig(config) {
  const source = isObject(config) ? config : {}
  const normalized = Object.hasOwn(source, "version")
    ? normalizeAioConfig(source, { configPath: "<injected>" })
    : normalizeAioConfig({
        version: 1,
        categories: source.categories ?? {},
        agents: source.agents ?? {},
        delegation: source.delegation ?? {},
      }, { configPath: "<injected>" })
  return withDefaultDelegation(normalized)
}

function agentMap(agents) {
  if (agents === undefined || agents === null) return undefined
  const map = new Map()
  const entries = agents instanceof Map
    ? [...agents.entries()]
    : agents instanceof Set
      ? [...agents].map((name) => [name, { name }])
      : Array.isArray(agents)
        ? agents.map((entry) => [typeof entry === "string" ? entry : entry?.name, entry])
        : []
  if (!entries.length && !(
    agents instanceof Map
    || agents instanceof Set
    || Array.isArray(agents)
  )) {
    throw new Error("effective OpenCode agents must be an array, Set, or Map")
  }
  for (const [name, info] of entries) {
    if (typeof name === "string" && name.trim()) map.set(name.trim(), info && typeof info === "object" ? info : { name })
  }
  return map
}

export async function discoverAgents({ client, directory } = {}) {
  if (typeof client?.app?.agents !== "function") return undefined
  const result = await client.app.agents(directory ? { query: { directory } } : undefined)
  const agents = sdkData(result, "app.agents")
  if (!Array.isArray(agents)) throw new Error("app.agents returned an invalid agent list")
  return agents
}

export class DelegationPolicy {
  constructor({ aioConfig, config, categoryEngine, availableAgents } = {}) {
    this.aioConfig = normalizedConfig(aioConfig ?? config)
    this.categoryEngine = categoryEngine
    this.availableAgents = agentMap(availableAgents ?? BUILTIN_AGENT_NAMES)
  }

  setAvailableAgents(agents) {
    this.availableAgents = agentMap(agents)
  }

  isKnownAgent(name) {
    if (this.availableAgents === undefined) return true
    return this.availableAgents.has(name)
  }

  isKnownCaller(caller) {
    if (typeof caller !== "string" || !caller.trim()) return false
    if (!this.isKnownAgent(caller)) return false
    return BUILTIN_PRIMARY_AGENTS.has(caller) || Object.hasOwn(this.aioConfig.delegation, caller)
  }

  customAgentIsDelegatable(agent, caller) {
    if (!this.isKnownAgent(agent)) return false
    if (BUILTIN_NAMED_AGENTS.has(agent)) return true
    if (BUILTIN_AGENT_NAMES.has(agent)) {
      return DEFAULT_DELEGATION[caller]?.agents?.includes(agent) === true
    }
    const info = this.availableAgents?.get(agent)
    if (info?.mode === "primary") return false
    return this.aioConfig.agents[agent]?.delegatable === true
  }

  canUseCategory({ caller, category, profile } = {}) {
    if (!this.isKnownCaller(caller)) return false
    const phaseCeiling = PHASE_OWNER_CATEGORY_CEILINGS.get(caller)
    if (phaseCeiling && !phaseCeiling.has(category)) return false
    const callerAllowlist = CATEGORY_CALLER_ALLOWLISTS.get(category)
    if (callerAllowlist) return callerAllowlist.has(caller)
    if (CATEGORY_RESTRICTED_PARENTS.has(caller)) return false
    if (caller === "Implementer" || caller === "Browser") return false
    if (BROAD_CATEGORY_PARENTS.has(caller)) return true
    const familyCeiling = CATEGORY_FAMILY_CEILINGS.get(caller)
    if (familyCeiling) {
      const categoryProfile = profile ?? this.categoryEngine?.resolve(category)?.profile
      return categoryProfile?.family === familyCeiling
    }
    const entry = this.aioConfig.delegation[caller]
    if (!entry) return false
    if (entry.categories.includes(category)) return true
    const categoryProfile = profile ?? this.categoryEngine?.resolve(category)?.profile
    return Boolean(categoryProfile?.family && entry.category_families.includes(categoryProfile.family))
  }

  canDelegateAgent({ caller, agent } = {}) {
    if (!this.isKnownCaller(caller) || !this.isKnownAgent(agent)) return false
    const parentAllowlist = PARENT_AGENT_NAMED_AGENTS.get(caller)
    if (parentAllowlist && !parentAllowlist.has(agent)) return false
    if (agent === "Verifier") return caller === "Executor"
    if (parentAllowlist?.has(agent)) return true
    if (caller === "Assistant" && BUILTIN_NAMED_AGENTS.has(agent)) return true
    const entry = this.aioConfig.delegation[caller]
    if (!entry?.agents.includes(agent)) return false
    return this.customAgentIsDelegatable(agent, caller)
  }

  assertCategory({ caller, category, profile } = {}) {
    if (CATEGORY_RESTRICTED_PARENTS.has(caller)) {
      throw new Error(String(caller) + " may only delegate its allowlisted named agents; category routes are not allowed")
    }
    if (!this.canUseCategory({ caller, category, profile })) {
      throw new Error((caller || "unknown caller") + " is not allowed to delegate category " + category)
    }
  }

  assertAgent({ caller, agent } = {}) {
    const parentAllowlist = PARENT_AGENT_NAMED_AGENTS.get(caller)
    if (parentAllowlist && !parentAllowlist.has(agent)) {
      throw new Error(caller + " cannot delegate named agent " + agent + "; allowed: " + [...parentAllowlist].join(", "))
    }
    if (agent === "Verifier" && caller !== "Executor") {
      throw new Error("Verifier may only be delegated by Executor")
    }
    if (!this.isKnownAgent(agent)) throw new Error("named agent is not available in OpenCode: " + agent)
    if (!this.canDelegateAgent({ caller, agent })) {
      if (Object.hasOwn(this.aioConfig.agents, agent) && this.aioConfig.agents[agent]?.delegatable !== true) {
        throw new Error("named agent is not AIO-delegatable: " + agent)
      }
      throw new Error("named agent is not allowed: " + agent)
    }
  }

  assertConsultationAgent(agent) {
    if (!CONSULTATION_AGENTS.has(agent)) {
      throw new Error("consult_agents target is not allowed: " + agent)
    }
    if (!this.isKnownAgent(agent)) throw new Error("named agent is not available in OpenCode: " + agent)
  }
}

export {
  BUILTIN_AGENT_NAMES,
  BUILTIN_NAMED_AGENTS,
  CATEGORY_RESTRICTED_PARENTS,
  CATEGORY_FAMILY_CEILINGS,
  CATEGORY_CALLER_ALLOWLISTS,
  CONSULTATION_AGENTS,
  PARENT_AGENT_NAMED_AGENTS,
}
