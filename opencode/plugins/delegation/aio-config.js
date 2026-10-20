import { lstatSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { DEFAULT_CATEGORIES } from "./categories.js"
import { builtinFamilyConflict, normalizeCategory, validateCategory } from "./category-engine.js"

const DEFAULT_AIO_CONFIG_PATH = join(homedir(), ".config", "opencode", "aio.json")
const DEFAULT_LEGACY_CATEGORY_CONFIG_PATH = join(homedir(), ".config", "opencode", "categories.json")
const SUPPORTED_TOP_LEVEL_FIELDS = new Set(["version", "categories", "agents", "delegation"])
const SUPPORTED_AGENT_FIELDS = new Set(["delegatable"])
const SUPPORTED_DELEGATION_FIELDS = new Set(["categories", "category_families", "agents"])

// Built-in delegation capabilities use the same normalized shape as user
// delegation entries. User entries extend these defaults by list union; they
// do not silently broaden callers that have no configured capability.
export const DEFAULT_DELEGATION = Object.freeze({
  Producer: Object.freeze({
    categories: Object.freeze(["video-analysis"]),
    category_families: Object.freeze(["media"]),
    agents: Object.freeze(["Director", "Creator", "Editor"]),
  }),
  Director: Object.freeze({
    categories: Object.freeze(["blender-previs", "video-analysis"]),
    category_families: Object.freeze([]),
    agents: Object.freeze([]),
  }),
  Creator: Object.freeze({
    categories: Object.freeze(["media-generation", "video-analysis"]),
    category_families: Object.freeze([]),
    agents: Object.freeze([]),
  }),
  Editor: Object.freeze({
    categories: Object.freeze(["video-analysis"]),
    category_families: Object.freeze([]),
    agents: Object.freeze([]),
  }),
})

function configError(configPath, message) {
  return new Error(`invalid AIO config ${configPath}: ${message}`)
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizedName(name, label, configPath) {
  const normalized = String(name).trim()
  if (!normalized) throw configError(configPath, `${label} names must not be empty`)
  return normalized
}

function objectSection(value, name, configPath) {
  if (value === undefined) return {}
  if (!isObject(value)) throw configError(configPath, `top-level ${name} must be an object`)
  return value
}

function stringList(value, path, configPath) {
  if (!Array.isArray(value)) throw configError(configPath, `${path} must be an array of strings`)
  const result = []
  const seen = new Set()
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !item.trim()) {
      throw configError(configPath, `${path}[${index}] must be a non-empty string`)
    }
    const normalized = item.trim()
    if (!seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  }
  return result
}

function validateConfigCategory(name, source, configPath) {
  try {
    validateCategory(name, source, configPath)
  } catch (error) {
    const prefix = `invalid category config ${configPath}: `
    const message = error?.message?.startsWith(prefix) ? error.message.slice(prefix.length) : error?.message ?? String(error)
    throw configError(configPath, message)
  }
}

function normalizeCategories(value, configPath) {
  const categories = objectSection(value, "categories", configPath)
  const result = {}
  for (const [rawName, source] of Object.entries(categories)) {
    const name = normalizedName(rawName, "category", configPath)
    if (Object.hasOwn(result, name)) throw configError(configPath, `duplicate category name after normalization: ${name}`)
    validateConfigCategory(name, source, configPath)
    const normalized = normalizeCategory(name, source, configPath)
    const conflict = builtinFamilyConflict(name, DEFAULT_CATEGORIES[name], normalized)
    if (conflict) throw configError(configPath, conflict)
    result[name] = normalized
  }
  return result
}

function normalizeAgents(value, configPath) {
  const agents = objectSection(value, "agents", configPath)
  const result = {}
  for (const [rawName, source] of Object.entries(agents)) {
    const name = normalizedName(rawName, "agent", configPath)
    if (Object.hasOwn(result, name)) throw configError(configPath, `duplicate agent name after normalization: ${name}`)
    if (!isObject(source)) throw configError(configPath, `agent "${name}" must be an object`)
    for (const field of Object.keys(source)) {
      if (!SUPPORTED_AGENT_FIELDS.has(field)) {
        throw configError(configPath, `agent "${name}" has unsupported field "${field}"`)
      }
    }
    if (source.delegatable !== undefined && typeof source.delegatable !== "boolean") {
      throw configError(configPath, `agent "${name}" field "delegatable" must be boolean`)
    }
    result[name] = { ...(source.delegatable === undefined ? {} : { delegatable: source.delegatable }) }
  }
  return result
}

function normalizeDelegation(value, configPath) {
  const delegation = objectSection(value, "delegation", configPath)
  const result = {}
  for (const [rawCaller, source] of Object.entries(delegation)) {
    const caller = normalizedName(rawCaller, "delegation caller", configPath)
    if (Object.hasOwn(result, caller)) throw configError(configPath, `duplicate delegation caller after normalization: ${caller}`)
    if (!isObject(source)) throw configError(configPath, `delegation entry for "${caller}" must be an object`)
    for (const field of Object.keys(source)) {
      if (!SUPPORTED_DELEGATION_FIELDS.has(field)) {
        throw configError(configPath, `delegation entry for "${caller}" has unsupported field "${field}"`)
      }
    }
    const entry = {}
    for (const field of SUPPORTED_DELEGATION_FIELDS) {
      entry[field] = source[field] === undefined
        ? []
        : stringList(source[field], `delegation.${caller}.${field}`, configPath)
    }
    result[caller] = entry
  }
  return result
}

function union(values, additions) {
  return [...new Set([...additions, ...values])]
}

export function withDefaultDelegation(config, defaults = DEFAULT_DELEGATION) {
  const delegation = { ...config.delegation }
  for (const [caller, defaultEntry] of Object.entries(defaults)) {
    const configuredEntry = delegation[caller] ?? {}
    delegation[caller] = {
      categories: union(configuredEntry.categories ?? [], defaultEntry.categories ?? []),
      category_families: union(configuredEntry.category_families ?? [], defaultEntry.category_families ?? []),
      agents: union(configuredEntry.agents ?? [], defaultEntry.agents ?? []),
    }
  }
  return { ...config, delegation }
}

export function normalizeAioConfig(value, { configPath = DEFAULT_AIO_CONFIG_PATH } = {}) {
  if (!isObject(value)) throw configError(configPath, "top-level value must be an object")
  for (const field of Object.keys(value)) {
    if (!SUPPORTED_TOP_LEVEL_FIELDS.has(field)) throw configError(configPath, `unsupported top-level field "${field}"`)
  }
  if (value.version !== 1) throw configError(configPath, `unsupported version ${JSON.stringify(value.version)}; expected version 1`)
  return {
    version: 1,
    categories: normalizeCategories(value.categories, configPath),
    agents: normalizeAgents(value.agents, configPath),
    delegation: normalizeDelegation(value.delegation, configPath),
  }
}

function pathExists(path) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

export function loadAioConfig({ configPath = DEFAULT_AIO_CONFIG_PATH, legacyConfigPath } = {}) {
  const resolvedConfigPath = resolve(configPath)
  const resolvedLegacyPath = resolve(legacyConfigPath ?? (
    resolvedConfigPath === resolve(DEFAULT_AIO_CONFIG_PATH)
      ? DEFAULT_LEGACY_CATEGORY_CONFIG_PATH
      : join(dirname(resolvedConfigPath), "categories.json")
  ))
  if (pathExists(resolvedLegacyPath)) {
    throw new Error(
      `categories.json is no longer supported. Move category configuration to ${resolvedConfigPath} under "categories".`,
    )
  }

  let parsed
  try {
    parsed = JSON.parse(readFileSync(resolvedConfigPath, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { version: 1, categories: {}, agents: {}, delegation: {} }
    }
    throw configError(resolvedConfigPath, error?.message ?? String(error))
  }
  return normalizeAioConfig(parsed, { configPath: resolvedConfigPath })
}

export { DEFAULT_AIO_CONFIG_PATH, DEFAULT_LEGACY_CATEGORY_CONFIG_PATH }
