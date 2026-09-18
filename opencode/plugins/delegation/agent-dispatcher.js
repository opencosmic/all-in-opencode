import { DelegationPolicy, discoverAgents } from "./delegation-policy.js"

function namedAgentRoute(agent) {
  return {
    category: null,
    agent,
    profile: {
      description: `Read-only ${agent} specialist`,
      tools: {
        workspace_prepare: false,
        delegate_task: false,
        workspace_checkpoint_update: false,
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
