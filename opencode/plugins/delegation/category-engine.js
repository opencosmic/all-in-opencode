import { DEFAULT_CATEGORIES } from "./categories.js"

const SUPPORTED_FIELDS = new Set([
  "description",
  "model",
  "variant",
  "tools",
  "prompt_append",
  "disable",
  "family",
])

const RETIRED_CATEGORIES = new Set(["browser-automation"])

function categoryConfigError(configPath, message) {
  return new Error(`invalid category config ${configPath}: ${message}`)
}

function validateCategory(name, source, configPath) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw categoryConfigError(configPath, `category "${name}" must be an object`)
  }
  for (const field of Object.keys(source)) {
    if (!SUPPORTED_FIELDS.has(field)) {
      throw categoryConfigError(configPath, `category "${name}" has unsupported field "${field}"`)
    }
  }
  for (const field of ["description", "model", "variant", "prompt_append"]) {
    if (source[field] !== undefined && typeof source[field] !== "string") {
      throw categoryConfigError(configPath, `category "${name}" field "${field}" must be a string`)
    }
  }
  if (source.family !== undefined && (typeof source.family !== "string" || !source.family.trim())) {
    throw categoryConfigError(configPath, `category "${name}" field "family" must be a non-empty string`)
  }
  if (source.model !== undefined && !source.model.trim()) {
    throw categoryConfigError(configPath, `category "${name}" field "model" must not be empty`)
  }
  if (source.disable !== undefined && typeof source.disable !== "boolean") {
    throw categoryConfigError(configPath, `category "${name}" field "disable" must be boolean`)
  }
  if (source.tools !== undefined && (
    !source.tools
    || Array.isArray(source.tools)
    || typeof source.tools !== "object"
    || Object.values(source.tools).some((value) => typeof value !== "boolean")
  )) {
    throw categoryConfigError(configPath, `category "${name}" field "tools" must map tool names to booleans`)
  }
}

function builtinFamilyConflict(name, builtin, override) {
  if (!builtin || override?.family === undefined || builtin.family === undefined) return null
  const received = typeof override.family === "string" ? override.family.trim() : override.family
  if (received === builtin.family) return null
  return `Built-in category "${name}" has immutable family "${builtin.family}"; received "${received}"`
}

function assertBuiltinFamilyOverride(name, builtin, override, configPath = "<injected>") {
  const conflict = builtinFamilyConflict(name, builtin, override)
  if (conflict) throw categoryConfigError(configPath, conflict)
}

function normalizeCategory(name, source, configPath = "<injected>") {
  validateCategory(name, source, configPath)
  const result = structuredClone(source)
  if (result.family !== undefined) result.family = result.family.trim()
  return result
}

function mergeCategory(builtin, override) {
  if (!builtin) return override ? structuredClone(override) : undefined
  if (!override) return structuredClone(builtin)
  return {
    ...structuredClone(builtin),
    ...structuredClone(override),
    ...(builtin.family !== undefined && override.family === undefined ? { family: builtin.family } : {}),
    ...(override.tools === undefined && builtin.tools ? { tools: { ...builtin.tools } } : {}),
  }
}

function validateModel(name, model) {
  if (typeof model !== "string" || !model.trim()) {
    throw new Error(`Category "${name}" has no configured model. Configure categories.${name}.model and retry.`)
  }
  const separator = model.indexOf("/")
  if (separator < 1 || separator === model.length - 1) {
    throw new Error(`Category "${name}" has invalid model "${model}". Configure it as provider/model and retry.`)
  }
}

export { DEFAULT_CATEGORIES, assertBuiltinFamilyOverride, builtinFamilyConflict, normalizeCategory, validateCategory }

export class CategoryEngine {
  constructor(userCategories = {}, { builtins = DEFAULT_CATEGORIES } = {}) {
    if (userCategories && Object.hasOwn(userCategories, "userCategories") && Object.keys(userCategories).length === 1) {
      userCategories = userCategories.userCategories
    }
    this.builtins = structuredClone(builtins)
    this.userCategories = structuredClone(userCategories)
    if (!this.userCategories || typeof this.userCategories !== "object" || Array.isArray(this.userCategories)) {
      throw categoryConfigError("<injected>", "categories must be an object")
    }
    for (const [name, source] of Object.entries(this.userCategories)) {
      validateCategory(name, source, "<injected>")
      assertBuiltinFamilyOverride(name, this.builtins[name], source)
    }
    this.categories = Object.fromEntries(
      [...new Set([...Object.keys(this.builtins), ...Object.keys(this.userCategories)])]
        .filter((name) => !RETIRED_CATEGORIES.has(name))
        .map((name) => [name, normalizeCategory(name, mergeCategory(this.builtins[name], this.userCategories[name]))]),
    )
  }

  has(name) {
    return Boolean(this.categories[name] && !this.categories[name].disable)
  }

  list() {
    return Object.entries(this.categories)
      .filter(([, source]) => !source.disable)
      .map(([name, source]) => ({
        name,
        description: source.description ?? "",
        model: source.model,
        variant: source.variant,
        ...(source.family === undefined ? {} : { family: source.family }),
      }))
  }

  resolve(name) {
    const source = this.categories[name]
    if (!source) throw new Error(`unknown delegation category: ${name}. Available: ${this.list().map((entry) => entry.name).join(", ")}`)
    if (source.disable) throw new Error(`delegation category is disabled: ${name}`)
    validateModel(name, source.model)
    return {
      category: name,
      agent: "Implementer",
      profile: {
        ...structuredClone(source),
        tools: source.tools ? { ...source.tools } : undefined,
        prompt_append: source.prompt_append ?? "",
      },
    }
  }
}
