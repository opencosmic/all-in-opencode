export const DEFAULT_CATEGORIES = Object.freeze({
  quick: {
    description: "Small contained implementation work",
    model: "openai/gpt-5.6-luna-fast",
    variant: "low",
    prompt_append: "Keep the implementation focused and minimize unnecessary exploration.",
  },
  standard: {
    description: "Normal scoped implementation work",
    model: "openai/gpt-5.6-sol",
    variant: "medium",
  },
  deep: {
    description: "Complex implementation requiring deeper analysis",
    model: "openai/gpt-5.6-terra",
    variant: "high",
    prompt_append: "Trace dependencies and validate the implementation thoroughly.",
  },
  ultrabrain: {
    description: "Genuinely difficult logic or architecture-sensitive implementation",
    model: "openai/gpt-5.6-sol",
    variant: "xhigh",
    prompt_append: "Resolve the hard reasoning problem without expanding beyond the assignment.",
  },
  "visual-engineering": {
    description: "Frontend, UI, styling, layout, and interaction implementation",
    model: "opencode-go/kimi-k3",
    variant: "high",
    prompt_append: "Preserve established product patterns and verify the rendered user experience.",
  },
  writing: {
    description: "Documentation and technical writing",
    model: "opencode-go/kimi-k3",
    variant: "low",
  },
  artistry: {
    description: "Creative implementation where conventional approaches are insufficient",
    model: "opencode-go/kimi-k3",
    variant: "high",
  },
  "unspecified-low": {
    description: "Low-effort implementation not covered by a narrower category",
    model: "openai/gpt-5.6-terra",
    variant: "medium",
  },
  "unspecified-high": {
    description: "High-effort implementation not covered by a narrower category",
    model: "openai/gpt-5.6-terra",
    variant: "high",
  },
  git: {
    description: "Bounded Git mechanics explicitly selected by the caller",
    model: "openai/gpt-5.6-luna-fast",
    variant: "low",
    tools: {
      edit: false,
      write: false,
      skill: false,
    },
    prompt_append: "Execute only the explicitly authorized Git operation. Never reset, clean, force-remove, force-push, rewrite history, or discard user changes.",
  },
  "browser-automation": {
    description: "Website interaction and browser-state verification through the currently installed browser capability",
    model: "openai/gpt-5.6-luna-fast",
    variant: "low",
    tools: {
      edit: false,
      write: false,
      skill: true,
      bash: true,
    },
    prompt_append: "Use only the explicitly selected browser skill, interact only with the requested website, verify the resulting UI state, avoid repository mutation, and return concise evidence.",
  },
  migration: {
    description: "Compatibility-sensitive migration work",
    model: "openai/gpt-5.6-sol",
    variant: "high",
    prompt_append: "Preserve compatibility and make rollback and migration evidence explicit.",
  },
  database: {
    description: "Schema, query, and persistence implementation",
    model: "openai/gpt-5.6-sol",
    variant: "high",
    prompt_append: "Check transactional, migration, rollback, and data-integrity behavior.",
  },
  testing: {
    description: "Focused automated test implementation",
    model: "openai/gpt-5.6-luna-fast",
    variant: "medium",
  },
  bugfix: {
    description: "Reproduce and repair a bounded defect",
    model: "openai/gpt-5.6-sol",
    variant: "high",
    prompt_append: "Reproduce first, repair the root cause, and retain regression coverage.",
  },
  "tiny-refactor": {
    description: "Small behavior-preserving refactor",
    model: "openai/gpt-5.6-luna-fast",
    variant: "low",
    prompt_append: "Keep the diff small and prove behavior is unchanged.",
  },
})
