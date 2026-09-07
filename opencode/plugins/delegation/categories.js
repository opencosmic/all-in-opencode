export const DEFAULT_CATEGORIES = Object.freeze({
  quick: {
    description: "Small contained implementation work",
    models: [
      { model: "openai/gpt-5.6-luna-fast", reasoning: "low" },
      { model: "opencode-go/minimax-m3", reasoning: "high" },
    ],
    prompt_append: "Keep the implementation focused and minimize unnecessary exploration.",
  },
  standard: {
    description: "Normal scoped implementation work",
    models: [{ model: "openai/gpt-5.6-sol", reasoning: "medium" }],
  },
  deep: {
    description: "Complex implementation requiring deeper analysis",
    models: [
      { model: "openai/gpt-5.6-terra", reasoning: "high" },
      { model: "openai/gpt-5.6-sol", reasoning: "xhigh" },
    ],
    prompt_append: "Trace dependencies and validate the implementation thoroughly.",
  },
  migration: {
    description: "Compatibility-sensitive migration work",
    models: [{ model: "openai/gpt-5.6-sol", reasoning: "high" }],
    prompt_append: "Preserve compatibility and make rollback and migration evidence explicit.",
  },
  database: {
    description: "Schema, query, and persistence implementation",
    models: [{ model: "openai/gpt-5.6-sol", reasoning: "high" }],
    prompt_append: "Check transactional, migration, rollback, and data-integrity behavior.",
  },
  testing: {
    description: "Focused automated test implementation",
    models: [{ model: "openai/gpt-5.6-luna-fast", reasoning: "medium" }],
  },
  bugfix: {
    description: "Reproduce and repair a bounded defect",
    models: [{ model: "openai/gpt-5.6-sol", reasoning: "high" }],
    prompt_append: "Reproduce first, repair the root cause, and retain regression coverage.",
  },
  "tiny-refactor": {
    description: "Small behavior-preserving refactor",
    models: [{ model: "openai/gpt-5.6-luna-fast", reasoning: "low" }],
    prompt_append: "Keep the diff small and prove behavior is unchanged.",
  },
})
