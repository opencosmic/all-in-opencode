// This is intentionally a probe-local contract check, not a general OMO
// compatibility layer. It is bound to the measured OMO source revision used
// by the lane E2E and fails closed if that projection changes.
export const MEASURED_OMO_CATEGORY_PROJECTION_FIELDS = Object.freeze([
  "description", "model", "fallback_models", "variant", "temperature", "top_p",
  "maxTokens", "thinking", "reasoningEffort", "textVerbosity", "tools",
  "prompt_append", "max_prompt_tokens", "is_unstable_agent", "disable",
])

export const LANE_E2E_CATEGORY_ROUTE_INVALID = "LANE_E2E_CATEGORY_ROUTE_INVALID"

function invalid(reason, projected = {}) {
  return {
    valid: false,
    code: LANE_E2E_CATEGORY_ROUTE_INVALID,
    reason,
    projected,
    source: "measured-omo-category-projection",
  }
}

function sourceMatchesMeasuredCategoryProjection(source) {
  const projection = source.match(/const categories = isPlainRecord\(view\.categories\)[\s\S]*?\n  return \{/)
  if (!projection) return false
  const text = projection[0]
  return MEASURED_OMO_CATEGORY_PROJECTION_FIELDS.every((field) =>
    new RegExp(`(?:[\\\"'])${field}(?:[\\\"'])`).test(text),
  ) &&
    !/(?:[\"'])models(?:[\"'])/.test(text) &&
    !/(?:[\"'])reasoning(?:[\"'])/.test(text)
}

// Reproduce only the measured source's category *projection*, rather than a
// second category resolver. Resolution remains OMO-owned; this check proves
// that the isolated configuration survives the exact projection that feeds it.
export function projectMeasuredOmoCategoryConfig(category) {
  if (!category || typeof category !== "object" || Array.isArray(category)) return {}
  return Object.fromEntries(MEASURED_OMO_CATEGORY_PROJECTION_FIELDS
    .filter((field) => Object.hasOwn(category, field))
    .map((field) => [field, category[field]]))
}

export function assessMeasuredOmoCategoryRoute({ category, model, projectionSource }) {
  if (typeof projectionSource !== "string" || !sourceMatchesMeasuredCategoryProjection(projectionSource)) {
    return invalid("measured OMO category projection no longer matches the pinned E2E contract")
  }
  const projected = projectMeasuredOmoCategoryConfig(category)
  if (projected.model !== model) return invalid("category projection has no exact allowed primary model", projected)
  if (!Array.isArray(projected.fallback_models) || projected.fallback_models.length !== 0) {
    return invalid("category fallback chain must be explicitly empty", projected)
  }
  if (projected.reasoningEffort !== "high") return invalid("category reasoning effort must be high", projected)
  return {
    valid: true,
    category: "lane-e2e",
    provider: "openai",
    model: model.split("/")[1],
    reasoning: "high",
    fallbackModels: [],
    source: "measured-omo-category-projection",
    projected,
  }
}
