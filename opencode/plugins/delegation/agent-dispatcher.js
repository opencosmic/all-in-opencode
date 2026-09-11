const NAMED_AGENTS = new Set([
  "Explorer",
  "Librarian",
  "Technical Advisor",
  "Plan Reviewer",
  "Researcher",
  "Validator",
  "Reviewer",
  "QA",
])

const CONSULTATION_AGENTS = new Set(["Explorer", "Librarian"])

function namedAgentRoute(agent) {
  return {
    category: null,
    agent,
    profile: {
      description: `Read-only ${agent} specialist`,
      tools: {
        workspace_prepare: false,
        delegate_task: false,
        consult_agents: false,
        task_status: false,
        task_output: false,
        task_cancel: false,
        workspace_release: false,
        task: false,
      },
      prompt_append: "",
    },
  }
}

export class AgentDispatcher {
  constructor(categoryEngine) {
    this.categoryEngine = categoryEngine
  }

  resolve({ category, agent }) {
    if (Boolean(category) === Boolean(agent)) {
      throw new Error("delegate_task requires exactly one of category or agent")
    }
    if (category) return this.categoryEngine.resolve(category)
    if (!NAMED_AGENTS.has(agent)) throw new Error(`named agent is not allowed: ${agent}`)
    return namedAgentRoute(agent)
  }

  resolveConsultation(agent) {
    if (!CONSULTATION_AGENTS.has(agent)) {
      throw new Error(`consult_agents target is not allowed: ${agent}`)
    }
    return namedAgentRoute(agent)
  }
}
