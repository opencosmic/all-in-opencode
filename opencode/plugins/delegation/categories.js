export const DEFAULT_CATEGORIES = Object.freeze({
  quick: {
    description: "Small contained implementation work",
    family: "implementation",
    model: "openai/gpt-5.6-luna-fast",
    variant: "low",
    prompt_append: `<Category_Context name="quick">
You are working on a small, contained task. Move quickly, inspect only the context needed to make the change, follow an existing pattern, and prefer the simplest direct solution. Avoid new abstractions, unrelated cleanup, and broad exploration. Finish with a focused check of the affected path.
</Category_Context>`,
  },
  standard: {
    description: "Normal scoped implementation work",
    family: "implementation",
    model: "openai/gpt-5.6-sol",
    variant: "medium",
    prompt_append: `<Category_Context name="standard">
You are working on ordinary implementation work. Understand the local context and established patterns before editing, make the smallest clean change that meets the goal, and verify the affected behavior. Do not expand a bounded assignment into unrelated improvements.
</Category_Context>`,
  },
  deep: {
    description: "Complex implementation requiring deeper analysis",
    family: "implementation",
    model: "openai/gpt-5.6-terra",
    variant: "high",
    prompt_append: `<Category_Context name="deep">
You are working on a complex goal that rewards understanding before action. Trace the relevant callers, dependencies, and failure paths broadly enough to explain the mechanism, favor a root-cause fix over a symptom guard, consider important alternatives, and complete the requested goal rather than stopping at a proposal. Validate the affected behavior thoroughly and report the evidence.
</Category_Context>`,
  },
  ultrabrain: {
    description: "Genuinely difficult logic or architecture-sensitive implementation",
    family: "implementation",
    model: "openai/gpt-5.6-sol",
    variant: "xhigh",
    prompt_append: `<Category_Context name="ultrabrain">
You are working on a genuinely difficult logic or architecture-sensitive problem. Establish the constraints and load-bearing assumptions first, compare the strongest viable approaches, and choose the simplest one that preserves correctness and maintainability. Try to disprove the chosen approach with boundary cases, then deliver a decision-complete implementation or conclusion with evidence. Keep the work inside the assignment.
</Category_Context>`,
  },
  "visual-engineering": {
    description: "Frontend, UI, styling, layout, and interaction implementation",
    family: "implementation",
    model: "opencode-go/kimi-k3",
    variant: "high",
    prompt_append: `<Category_Context name="visual-engineering">
You are working on frontend, UI, styling, layout, or interaction work. Inspect the existing design system, tokens, shared components, and nearby screens before editing. Extend established patterns instead of introducing arbitrary one-off styling, and verify the rendered state at the relevant viewport or interaction points before claiming completion.
</Category_Context>`,
  },
  writing: {
    description: "Documentation and technical writing",
    family: "implementation",
    model: "opencode-go/kimi-k3",
    variant: "low",
    prompt_append: `<Category_Context name="writing">
You are working on documentation or prose. Identify the audience and purpose, use the project's terminology, organize the material so it is easy to scan, and write clearly in a natural human voice. Remove generic filler and verify that examples and claims match the current implementation.
</Category_Context>`,
  },
  artistry: {
    description: "Creative implementation where conventional approaches are insufficient",
    family: "implementation",
    model: "opencode-go/kimi-k3",
    variant: "high",
    prompt_append: `<Category_Context name="artistry">
You are working on a creative task where a conventional implementation would miss the intent. Explore a small number of distinct directions, choose one that is both expressive and coherent with the product, and refine it against the requested experience. Keep novelty purposeful and verify the result rather than leaving a sketch.
</Category_Context>`,
  },
  "unspecified-low": {
    description: "Low-effort implementation not covered by a narrower category",
    family: "implementation",
    model: "openai/gpt-5.6-terra",
    variant: "medium",
    prompt_append: `<Category_Context name="unspecified-low">
No narrower category fits this contained task. Use a practical, moderate-effort implementation mindset: inspect the few relevant files, follow local conventions, avoid unnecessary abstractions, and verify the concrete result.
</Category_Context>`,
  },
  "unspecified-high": {
    description: "High-effort implementation not covered by a narrower category",
    family: "implementation",
    model: "openai/gpt-5.6-terra",
    variant: "high",
    prompt_append: `<Category_Context name="unspecified-high">
No narrower category fits this broad task. Survey the affected modules, callers, configuration, tests, and documentation before choosing an approach. Weigh meaningful alternatives, deliver the change across every surface that encodes the behavior, and validate the important end-to-end path.
</Category_Context>`,
  },
  git: {
    description: "Bounded Git mechanics explicitly selected by the caller",
    family: "git",
    model: "openai/gpt-5.6-luna-fast",
    variant: "low",
    tools: {
      edit: false,
      write: false,
      skill: false,
    },
    prompt_append: `<Category_Context name="git">
You are working on one explicitly authorized Git operation. Inspect the current repository facts before acting, perform only the named staging, task-local commit, history investigation, comparison, or source-derived integration operation, then verify the resulting status and history. Report exact SHAs and evidence when applicable. The caller owns branch, integration-order, shipping, pushing, and history-rewrite decisions; do not expand the operation or silently discard user changes.
</Category_Context>`,
  },
  "video-analysis": {
    description: "Grounded analysis of spoken and visual video content",
    family: "video-analysis",
    model: "openai/gpt-5.6-sol",
    variant: "high",
    tools: {
      edit: false,
      write: false,
      bash: true,
      skill: true,
    },
    prompt_append: `<Category_Context name="video-analysis">
You are working on VIDEO ANALYSIS tasks. Analyze evidence from the actual video, not from metadata or assumptions. Use transcript or audio evidence for what is said, and visual-frame evidence for what is shown, movement, UI state, editing, composition, actions, demonstrations, or on-screen text. Prefer transcript-first analysis when visuals are unnecessary, and use focused timestamp ranges when the request identifies a moment or section. For long videos, avoid unnecessarily dense full-video extraction. Distinguish spoken from visual evidence, use timestamps when they support the conclusion, never invent unobserved events, and return the requested analysis rather than a raw transcript or frame dump.
</Category_Context>`,
  },
  migration: {
    description: "Compatibility-sensitive migration work",
    family: "implementation",
    model: "openai/gpt-5.6-sol",
    variant: "high",
    prompt_append: `<Category_Context name="migration">
You are working on a compatibility-sensitive migration. Understand the current state and existing migration conventions first, preserve backward or forward compatibility where relevant, make transformations safe and appropriately idempotent, and validate both the upgraded state and the affected path. Make rollback or recovery evidence explicit when it matters.
</Category_Context>`,
  },
  database: {
    description: "Schema, query, and persistence implementation",
    family: "implementation",
    model: "openai/gpt-5.6-sol",
    variant: "high",
    prompt_append: `<Category_Context name="database">
You are working on schema, query, or persistence behavior. Inspect the current data model and nearby database patterns, preserve constraints and compatibility, reason about transaction and data-safety boundaries, and validate query correctness against realistic affected paths. Do not treat a migration or data rewrite as complete without checking its resulting state.
</Category_Context>`,
  },
  testing: {
    description: "Focused automated test implementation",
    family: "implementation",
    model: "openai/gpt-5.6-luna-fast",
    variant: "medium",
    prompt_append: `<Category_Context name="testing">
You are working on tests. Reproduce or characterize the behavior first, identify the correct testing layer, match existing conventions, and write discriminating tests that fail for the regression rather than merely exercising lines. Run focused validation before broader checks and preserve useful regression coverage.
</Category_Context>`,
  },
  bugfix: {
    description: "Reproduce and repair a bounded defect",
    family: "implementation",
    model: "openai/gpt-5.6-sol",
    variant: "high",
    prompt_append: `<Category_Context name="bugfix">
You are working on a reported defect. Reproduce or concretely understand the symptom, trace it to the root cause, and repair the cause instead of hiding the symptom. Add or update regression coverage when appropriate, then verify the actual reported failure path and nearby boundary behavior.
</Category_Context>`,
  },
  "tiny-refactor": {
    description: "Small behavior-preserving refactor",
    family: "implementation",
    model: "openai/gpt-5.6-luna-fast",
    variant: "low",
    prompt_append: `<Category_Context name="tiny-refactor">
You are working on a small behavior-preserving refactor. Find the narrowest existing pattern to improve, keep the diff deliberately small, avoid semantic changes or opportunistic cleanup, and run a focused check that demonstrates behavior is unchanged.
</Category_Context>`,
  },
})
