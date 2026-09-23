import { DELEGATING_NAMED_AGENTS, DelegationPolicy, discoverAgents } from "./delegation-policy.js"

function namedAgentRoute(agent) {
  const phaseOwner = DELEGATING_NAMED_AGENTS.has(agent)
  return {
    category: null,
    agent,
    profile: {
      description: phaseOwner ? `${agent} production phase owner` : `Read-only ${agent} specialist`,
      tools: {
        production_preflight: false,
        production_prepare_artifacts: false,
        production_checkpoint: false,
        workspace_prepare: false,
        delegate_task: phaseOwner,
        workspace_checkpoint_update: false,
        consult_agents: false,
        task_status: phaseOwner,
        task_output: phaseOwner,
        task_cancel: phaseOwner,
        workspace_release: false,
        task: false,
      },
      prompt_append: "",
    },
  }
}

export class AgentDispatcher {
  static discoverAgents = discoverAgents

  constructor(categoryEngine, { policy, aioConfig, config, availableAgents } = {}) {
    this.categoryEngine = categoryEngine
    this.policy = policy ?? new DelegationPolicy({
      aioConfig: aioConfig ?? config,
      categoryEngine,
      availableAgents,
    })
  }

  setAvailableAgents(agents) {
    this.policy.setAvailableAgents(agents)
  }

  authorizedCategories(parentAgent) {
    return this.categoryEngine.list().filter((entry) => this.policy.canUseCategory({
      caller: parentAgent,
      category: entry.name,
      profile: entry,
    }))
  }

  resolve({ category, agent, parentAgent }) {
    if (Boolean(category) === Boolean(agent)) {
      throw new Error("delegate_task requires exactly one of category or agent")
    }
    if (category) {
      const route = this.categoryEngine.resolve(category)
      this.policy.assertCategory({ caller: parentAgent, category, profile: route.profile })
      return route
    }
    this.policy.assertAgent({ caller: parentAgent, agent })
    return namedAgentRoute(agent)
  }

  resolveConsultation(agent) {
    this.policy.assertConsultationAgent(agent)
    return namedAgentRoute(agent)
  }
}
