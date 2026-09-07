import { DEFAULT_CATEGORIES } from "./categories.js"

const SUPPORTED_PROFILE_FIELDS = new Set([
  "description",
  "models",
  "reasoning",
  "variant",
  "temperature",
  "top_p",
  "max_tokens",
  "tools",
  "prompt_append",
  "max_prompt_tokens",
  "disable",
])

function normalizeModel(entry, inheritedReasoning) {
  const item = typeof entry === "string" ? { model: entry } : { ...entry }
  for (const field of Object.keys(item)) {
    if (!["model", "reasoning"].includes(field)) throw new Error(`unsupported category model field: ${field}`)
  }
  if (!item.model || typeof item.model !== "string") throw new Error("category model entries require model")
  return {
    model: item.model,
    reasoning: item.reasoning ?? inheritedReasoning,
  }
}

export { DEFAULT_CATEGORIES }

export class CategoryEngine {
  constructor(categories = DEFAULT_CATEGORIES) {
    this.categories = structuredClone(categories)
  }

  resolve(name) {
    const source = this.categories[name]
    if (!source) throw new Error(`unknown delegation category: ${name}`)
    if (source.disable) throw new Error(`delegation category is disabled: ${name}`)
    for (const field of Object.keys(source)) {
      if (!SUPPORTED_PROFILE_FIELDS.has(field)) throw new Error(`unsupported category field: ${field}`)
    }
    if (source.models !== undefined && !Array.isArray(source.models)) throw new Error("category models must be an array")
    for (const field of ["description", "reasoning", "variant", "prompt_append"]) {
      if (source[field] !== undefined && typeof source[field] !== "string") {
        throw new Error(`category ${field} must be a string`)
      }
    }
    for (const field of ["temperature", "top_p", "max_tokens", "max_prompt_tokens"]) {
      if (source[field] !== undefined && (!Number.isFinite(source[field]) || source[field] < 0)) {
        throw new Error(`category ${field} must be a non-negative finite number`)
      }
    }
    if (source.top_p !== undefined && source.top_p > 1) throw new Error("category top_p must be at most 1")
    for (const field of ["max_tokens", "max_prompt_tokens"]) {
      if (source[field] !== undefined && !Number.isInteger(source[field])) {
        throw new Error(`category ${field} must be an integer`)
      }
    }
    if (source.disable !== undefined && typeof source.disable !== "boolean") throw new Error("category disable must be boolean")
    if (source.tools !== undefined && (
      !source.tools
      || Array.isArray(source.tools)
      || typeof source.tools !== "object"
      || Object.values(source.tools).some((value) => typeof value !== "boolean")
    )) {
      throw new Error("category tools must map tool names to booleans")
    }
    const models = (source.models ?? []).map((entry) => normalizeModel(entry, source.reasoning))
    const profile = {
      ...source,
      models,
      tools: source.tools ? { ...source.tools } : undefined,
      prompt_append: source.prompt_append ?? "",
      unsupported_public_fields: ["reasoning", "variant"].filter((field) =>
        source[field] !== undefined || models.some((entry) => entry[field] !== undefined),
      ),
    }
    return { category: name, agent: "Implementer", profile }
  }
}
