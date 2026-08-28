const PLANNER_IDENTITIES = new Set(["planner"])
const ALLOWED_TASK_SUBAGENTS = new Set(["plan reviewer", "explore", "librarian", "oracle"])
const ALLOWED_OMO_SUBAGENTS = new Set(["explore", "librarian"])

export function extractAgentName(agent) {
  if (typeof agent === "string") return agent
  if (agent && typeof agent === "object" && typeof agent.name === "string") return agent.name
  return ""
}

function normalize(value) {
  return extractAgentName(value).replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim().toLowerCase()
}

export function isPlannerIdentity(value) {
  return PLANNER_IDENTITIES.has(normalize(value))
}

export function evaluatePlannerDelegation(toolName, args = {}) {
  const tool = normalize(toolName)
  if (tool === "task") {
    if (Object.prototype.hasOwnProperty.call(args, "task_id")) {
      return { allowed: false, reason: "Planner cannot continue task sessions." }
    }
    if (normalize(args.category)) {
      return { allowed: false, reason: "Planner cannot dispatch category implementation workers." }
    }
    const target = normalize(args.subagent_type)
    if (!target) {
      return {
        allowed: false,
        reason: "Planner task calls require an explicit allowed subagent_type.",
      }
    }
    if (!ALLOWED_TASK_SUBAGENTS.has(target)) {
      return { allowed: false, reason: `Planner cannot delegate to '${target}'.` }
    }
    return { allowed: true }
  }

  if (tool === "call_omo_agent") {
    const target = normalize(args.subagent_type)
    if (!ALLOWED_OMO_SUBAGENTS.has(target)) {
      return { allowed: false, reason: `Planner call_omo_agent target '${target || "<missing>"}' is not allowed.` }
    }
  }

  return { allowed: true }
}

export default async function PlannerDelegationGuard() {
  const activeAgents = new Map()

  return {
    "chat.params": async (input) => {
      activeAgents.set(input.sessionID, extractAgentName(input.agent))
    },
    "tool.execute.before": async (input, output) => {
      if (!isPlannerIdentity(activeAgents.get(input.sessionID))) return
      const decision = evaluatePlannerDelegation(input.tool, output.args)
      if (!decision.allowed) {
        throw new Error(`[planner-delegation-guard] ${decision.reason}`)
      }
    },
  }
}
