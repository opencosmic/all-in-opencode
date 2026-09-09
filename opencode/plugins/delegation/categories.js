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
  ultrabrain: {
    description: "Genuinely difficult logic or architecture-sensitive implementation",
    models: [{ model: "openai/gpt-5.6-sol", reasoning: "xhigh" }],
    prompt_append: "Resolve the hard reasoning problem without expanding beyond the assignment.",
  },
  "visual-engineering": {
    description: "Frontend, UI, styling, layout, and interaction implementation",
    models: [
      { model: "opencode-go/kimi-k3", reasoning: "high" },
      { model: "opencode-go/glm-5.2", reasoning: "high" },
      { model: "openai/gpt-5.6-sol", reasoning: "medium" },
    ],
    prompt_append: "Preserve established product patterns and verify the rendered user experience.",
  },
  writing: {
    description: "Documentation and technical writing",
    models: [{ model: "opencode-go/kimi-k3", reasoning: "low" }],
  },
  artistry: {
    description: "Creative implementation where conventional approaches are insufficient",
    models: [{ model: "opencode-go/kimi-k3", reasoning: "high" }],
  },
  "unspecified-low": {
    description: "Low-effort implementation not covered by a narrower category",
    models: [{ model: "openai/gpt-5.6-terra", reasoning: "medium" }],
  },
  "unspecified-high": {
    description: "High-effort implementation not covered by a narrower category",
    models: [{ model: "openai/gpt-5.6-terra", reasoning: "high" }],
  },
  git: {
    description: "Bounded Git mechanics explicitly selected by the caller",
    models: [{ model: "openai/gpt-5.6-luna-fast", reasoning: "low" }],
    tools: {
      edit: false,
      write: false,
      skill: false,
    },
    prompt_append: "Execute only the explicitly authorized Git operation. Never reset, clean, force-remove, force-push, rewrite history, or discard user changes.",
  },
  "browser-automation": {
    description: "Website interaction and browser-state verification through the currently installed browser capability",
    models: [{ model: "openai/gpt-5.6-luna-fast", reasoning: "low" }],
    tools: {
      edit: false,
      write: false,
      skill: true,
      bash: true,
    },
    prompt_append: "Load and use the installed browser automation skill, interact only with the requested website, verify the resulting UI state, avoid repository mutation, and return concise evidence.",
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
