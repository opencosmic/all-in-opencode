import { dirname, relative, resolve } from "node:path"
import { tmpdir } from "node:os"
import { realpath } from "node:fs/promises"

import { MEDIA_RUNTIME_TOOL_NAMES, isMediaRuntimeTool } from "./media-runtime.js"

const SAFE_GIT = [
  /^git status(?:\s|$)/,
  /^git log(?:\s|$)/,
  /^git diff(?:\s|$)/,
  /^git show(?:\s|$)/,
  /^git rev-parse(?:\s|$)/,
  /^git branch(?:\s+--show-current)?\s*$/,
  /^git add(?:\s|$)/,
  /^git commit(?:\s|$)/,
  /^git cherry-pick\s+(?:--no-commit\s+)?[0-9a-fA-F]{7,64}\s*$/,
]
const GIT_MUTATION = /^\s*git\s+(?:add|commit|cherry-pick)(?:\s|$)/

const OPEN_DESIGN_SERVER = "open-design"
// OpenCode sanitizes the hyphen in the configured server name before joining
// it with the MCP tool name: open-design -> open_design.
const OPEN_DESIGN_RAW_TOOL_PREFIX = "open_design_"
const OPEN_DESIGN_RESOURCE_TOOLS = new Set([
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
])
const MEDIA_WORKSPACE_TOOL_NAMES = Object.freeze(["read", "glob", "grep", "list", "lsp"])
export const PRODUCTION_CONTROL_TOOL_NAMES = Object.freeze([
  "production_preflight", "production_prepare_artifacts", "production_checkpoint",
])
const BLENDER_PREVIS_TOOL_NAMES = Object.freeze([
  "blender_get_addon_status",
  "blender_get_scene_info",
  "blender_get_object_info",
  "blender_get_viewport_screenshot",
  "blender_execute_blender_code",
])
const BLENDER_PREVIS_TOOL_SET = new Set(BLENDER_PREVIS_TOOL_NAMES)
const BLENDER_PREVIS_BLOCKED_PERMISSIONS = new Set([
  ...PRODUCTION_CONTROL_TOOL_NAMES,
  "read",
  "glob",
  "grep",
  "list",
  "lsp",
  "edit",
  "write",
  "bash",
  "skill",
  "external_directory",
  "question",
  "delegate_task",
  "consult_agents",
  "task",
  "workspace_prepare",
  "execution_preflight",
  "workspace_checkpoint_update",
  "task_status",
  "task_output",
  "task_cancel",
  "workspace_release",
])

function isBlenderPrevisTool(value) {
  return BLENDER_PREVIS_TOOL_SET.has(value)
}

function permissionValue(input) {
  // OpenCode may split a compound shell command into separate permission
  // patterns. The metadata retains the original command, so inspect it first
  // to keep compound-token rejection fail-closed.
  if (typeof input.metadata?.command === "string") return input.metadata.command
  if (Array.isArray(input.pattern)) return input.pattern.join(" ")
  if (Array.isArray(input.patterns)) return input.patterns.join(" ")
  if (typeof input.pattern === "string") return input.pattern
  return ""
}

function isSafeGitCommand(command) {
  if (/(?:&&|\|\||;|\r|\n|`|\$\()/.test(command)) return false
  if (!SAFE_GIT.some((pattern) => pattern.test(command.trim()))) return false
  return !/(?:^|\s)(?:--force|-f|--hard|--delete|-D|--amend)(?:\s|$)/.test(command)
}

function isCategoryScopedGitMutation(command) {
  return isGitMutationCommand(command)
}

export function isGitMutationCommand(command) {
  const text = String(command ?? "").trim()
  let quote = ""
  let segmentStart = 0
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const escaped = text[index - 1] === "\\"
    if (quote) {
      if (character === quote && !escaped) quote = ""
      continue
    }
    if ((character === "'" || character === '"') && !escaped) {
      quote = character
      continue
    }
    const doubleBoundary = (character === "&" && text[index + 1] === "&")
      || (character === "|" && text[index + 1] === "|")
    const boundary = doubleBoundary || character === ";" || character === "\r" || character === "\n"
    if (!boundary || escaped) continue
    if (GIT_MUTATION.test(text.slice(segmentStart, index))) return true
    if (doubleBoundary) index += 1
    segmentStart = index + 1
  }
  return GIT_MUTATION.test(text.slice(segmentStart))
}

function skillLocation(skill) {
  return skill?.path ?? skill?.location
}

function watchSkillRoot(path) {
  const absolute = resolve(path)
  return absolute.endsWith("/SKILL.md") ? dirname(absolute) : absolute
}

function watchSkillPaths(profile) {
  const selected = profile?.selected_skills
    ?? profile?.skills
    ?? (profile?.skill_paths ?? []).map((path) => ({ name: "watch", path }))
  return selected
    .filter((skill) => skill?.name === "watch")
    .map(skillLocation)
    .filter(Boolean)
    .map(watchSkillRoot)
}

function hasSelectedSkill(profile, name) {
  return (
    profile?.skill_names
    ?? profile?.selected_skills?.map((skill) => skill?.name)
    ?? profile?.skills?.map((skill) => skill?.name)
    ?? []
  ).includes(name)
}

function hasSkill(skills, name) {
  return Array.isArray(skills) && skills.some((skill) => skill?.name === name)
}

function isOpenDesignRawToolPermission(permission) {
  return typeof permission === "string"
    && permission.startsWith(OPEN_DESIGN_RAW_TOOL_PREFIX)
    && permission.length > OPEN_DESIGN_RAW_TOOL_PREFIX.length
}

function isOpenDesignResourcePattern(pattern) {
  if (typeof pattern !== "string" || /\s/.test(pattern)) return false
  const prefix = `mcp:${OPEN_DESIGN_SERVER}:`
  return pattern.startsWith(prefix) && pattern.length > prefix.length
}

export function hasOpenDesignCapability(profile) {
  return profile?.agent === "Implementer"
    && profile?.category === "visual-engineering"
    && hasSelectedSkill(profile, "open-design")
}

export function openDesignResourceDecision(profile, tool, args = {}) {
  if (!OPEN_DESIGN_RESOURCE_TOOLS.has(tool)) return null
  const server = typeof args?.server === "string" && args.server ? args.server : undefined
  // An omitted server asks OpenCode to enumerate every resource-capable MCP
  // server, so it must be gated as an OpenDesign-targeting operation too.
  if (server !== undefined && server !== OPEN_DESIGN_SERVER) return null
  return hasOpenDesignCapability(profile) && profile.tools?.read !== false ? "allow" : "deny"
}

export function requiresPreservedSessionPermissions(agent, category, skills = []) {
  return agent === "Implementer" && (
    ["git", "video-analysis", "media-generation", "blender-previs"].includes(category)
    || (category === "visual-engineering" && hasSkill(skills, "open-design"))
  )
}

function containsShellControl(command) {
  let quote = ""
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (quote) {
      if (character === quote && command[index - 1] !== "\\") quote = ""
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (";&|<>`\r\n".includes(character) || (character === "$" && command[index + 1] === "(")) return true
  }
  return Boolean(quote)
}

export function isWatchRuntimeCommand(command, paths = []) {
  if (typeof command !== "string" || containsShellControl(command)) return false
  const trimmed = command.trim()
  const match = trimmed.match(/^(python3|python)\s+("([^"]+)"|'([^']+)'|([^\s]+))(?:\s+|$)/)
  if (!match) return false
  const argumentsText = trimmed.slice(match[0].length)
  if (/(?:^|\s)--out-dir(?:\s|=|$)/.test(argumentsText)) return false
  const script = match[3] ?? match[4] ?? match[5]
  const allowed = paths.map(watchSkillRoot).flatMap((root) => [
    resolve(root, "scripts/watch.py"),
    resolve(root, "scripts/setup.py"),
  ])
  return allowed.includes(resolve(script))
}

function watchTempPatterns() {
  const root = resolve(tmpdir())
  return [`${root}/watch-*`, `${root}/watch-*/*`]
}

function isWithin(candidate, root) {
  const path = resolve(candidate)
  const base = resolve(root)
  const remainder = relative(base, path)
  return remainder === "" || (!remainder.startsWith("..") && !remainder.startsWith("/"))
}

export async function resolveFilmProductionSkillAccess(skills) {
  const skill = skills?.list().find((entry) => entry.name === "film-production")
  const location = skillLocation(skill)
  if (!location || !resolve(location).endsWith("/SKILL.md")) return null
  try {
    const physicalRoot = dirname(await realpath(location))
    return {
      roots: [...new Set([dirname(resolve(location)), physicalRoot])],
      physicalRoot,
    }
  } catch {
    return null
  }
}

export async function isFilmProductionExternalPath(path, access) {
  if (typeof path !== "string" || !access || /(?:^|\/)\.env(?:$|[/.])/.test(path)) return false
  if (!access.roots.some((root) => isWithin(path, root))) return false
  try {
    return isWithin(await realpath(path), access.physicalRoot)
  } catch {
    return false
  }
}

export function filmProductionSessionPermission(agent, access) {
  if (agent !== "Director" || !access) return undefined
  return [
    { permission: "external_directory", pattern: "*", action: "deny" },
    ...access.roots.flatMap((root) => [root, `${root}/*`].map((pattern) => ({
      permission: "external_directory", pattern, action: "allow",
    }))),
  ]
}

function isWatchTempPath(path) {
  const candidate = resolve(path)
  const remainder = relative(resolve(tmpdir()), candidate)
  const [first] = remainder.split("/")
  return Boolean(first && first.startsWith("watch-") && !remainder.startsWith(".."))
}

export function isWatchExternalPath(path, skillPaths = []) {
  if (typeof path !== "string" || /(?:^|\/)\.env(?:$|[/.])/.test(path)) return false
  if (skillPaths.map(watchSkillRoot).some((root) => isWithin(path, root))) return true
  return isWatchTempPath(path)
}

function watchBashPatterns(skillPaths) {
  return skillPaths.flatMap((root) => ["watch.py", "setup.py"].flatMap((script) => {
    const path = resolve(root, "scripts", script)
    return [
      `python3 ${path} *`,
      `python3 "${path}" *`,
      `python ${path} *`,
      `python "${path}" *`,
    ]
  }))
}

export function categoryPermission(profile, input = {}) {
  const value = permissionValue(input)
  const type = input.type ?? input.permission
  if (PRODUCTION_CONTROL_TOOL_NAMES.includes(type) && profile) return "deny"

  if (isBlenderPrevisTool(type)) {
    // A missing category profile belongs to a direct named Blender session;
    // leave its existing agent permissions intact.
    if (!profile?.category) return null
    return profile.category === "blender-previs" && profile.tools?.[type] !== false
      ? "allow"
      : "deny"
  }

  if (profile?.category === "blender-previs" && typeof type === "string" && type.startsWith("blender_")) {
    return "deny"
  }

  if (profile?.category === "blender-previs" && BLENDER_PREVIS_BLOCKED_PERMISSIONS.has(type)) {
    return "deny"
  }

  // OpenCode 1.18.29 names an MCP tool as sanitize(server) + "_" +
  // sanitize(tool). Keep the entire OpenDesign tool namespace denied,
  // including when a profile is unavailable during a parent or recovered
  // session. Resource access is a separate generic `read` permission.
  if (isOpenDesignRawToolPermission(type)) return "deny"
  if (type === "read" && isOpenDesignResourcePattern(value)) {
    return hasOpenDesignCapability(profile) && profile.tools?.read !== false ? "allow" : "deny"
  }

  if (isMediaRuntimeTool(type)) {
    return profile?.category === "media-generation" && profile.tools?.[type] !== false ? "allow" : "deny"
  }

  if (!profile?.category) return null

  if (profile.category === "git" && type === "bash") {
    if (profile.tools?.bash === false) return "deny"
    return isSafeGitCommand(value) ? "allow" : "deny"
  }

  if (profile.category !== "git" && type === "bash" && isCategoryScopedGitMutation(value)) {
    return "deny"
  }

  if (profile.category === "media-generation" && [
    ...MEDIA_WORKSPACE_TOOL_NAMES,
    "edit",
    "write",
    "bash",
    "skill",
    "external_directory",
    "delegate_task",
    "task",
    "workspace_prepare",
    "execution_preflight",
    "workspace_checkpoint_update",
    "task_status",
    "task_output",
    "task_cancel",
    "workspace_release",
    "consult_agents",
  ].includes(type)) return "deny"

  if (profile.category === "video-analysis") {
    const skillPaths = watchSkillPaths(profile)
    if (type === "skill") {
      return profile.tools?.skill === false || value !== "watch" || !hasSelectedSkill(profile, "watch")
        ? "deny"
        : "allow"
    }
    if (type === "bash") {
      return profile.tools?.bash === false || !hasSelectedSkill(profile, "watch") || !isWatchRuntimeCommand(value, skillPaths)
        ? "deny"
        : "allow"
    }
    if (type === "external_directory") {
      return profile.tools?.skill === false || !hasSelectedSkill(profile, "watch") || !isWatchExternalPath(value, skillPaths)
        ? "deny"
        : "allow"
    }
  }

  if (type === "skill" || type === "external_directory") return "deny"

  return null
}

export function categorySessionPermission(category, tools = {}, skills = []) {
  const productionControlDeny = PRODUCTION_CONTROL_TOOL_NAMES.map((permission) => ({
    permission, pattern: "*", action: "deny",
  }))
  if (category === "git") {
    const rules = [
      ...productionControlDeny,
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "write", pattern: "*", action: "deny" },
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "deny" },
    ]
    if (tools.bash !== false) rules.push(...[
      "git status", "git status *",
      "git log", "git log *",
      "git diff", "git diff *",
      "git show", "git show *",
      "git rev-parse", "git rev-parse *",
      "git branch", "git branch --show-current",
      "git add *",
      "git commit *",
      "git cherry-pick *",
    ].map((pattern) => ({ permission: "bash", pattern, action: "allow" })))
    rules.push(
      { permission: "bash", pattern: "git commit *--amend*", action: "deny" },
      { permission: "bash", pattern: "git commit *--force*", action: "deny" },
      { permission: "bash", pattern: "git cherry-pick --*", action: "deny" },
    )
    return rules
  }
  if (category === "video-analysis") {
    const skillPaths = skills
      .filter((skill) => skill?.name === "watch")
      .map(skillLocation)
      .filter(Boolean)
      .map(watchSkillRoot)
    const rules = [
      ...productionControlDeny,
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "write", pattern: "*", action: "deny" },
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "external_directory", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "deny" },
    ]
    if (tools.skill !== false && skillPaths.length) {
      rules.push({ permission: "skill", pattern: "watch", action: "allow" })
      rules.push(...watchTempPatterns().map((pattern) => ({
        permission: "external_directory",
        pattern,
        action: "allow",
      })))
      for (const root of skillPaths) rules.push(
        { permission: "external_directory", pattern: root, action: "allow" },
        { permission: "external_directory", pattern: `${root}/*`, action: "allow" },
      )
    }
    if (tools.bash !== false && skillPaths.length) {
      rules.push(...watchBashPatterns(skillPaths).map((pattern) => ({
        permission: "bash",
        pattern,
        action: "allow",
      })))
      for (const root of skillPaths) for (const script of ["watch.py", "setup.py"]) {
        const path = resolve(root, "scripts", script)
        rules.push(...[
          `python3 ${path} *--out-dir*`,
          `python3 "${path}" *--out-dir*`,
          `python ${path} *--out-dir*`,
          `python "${path}" *--out-dir*`,
        ].map((pattern) => ({
          permission: "bash",
          pattern,
          action: "deny",
        })))
      }
    }
    return rules
  }
  if (category === "media-generation") {
    const rules = [
      ...productionControlDeny,
      ...MEDIA_WORKSPACE_TOOL_NAMES.map((permission) => ({ permission, pattern: "*", action: "deny" })),
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "write", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "external_directory", pattern: "*", action: "deny" },
      { permission: "delegate_task", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "workspace_prepare", pattern: "*", action: "deny" },
      { permission: "execution_preflight", pattern: "*", action: "deny" },
      { permission: "workspace_checkpoint_update", pattern: "*", action: "deny" },
      { permission: "task_status", pattern: "*", action: "deny" },
      { permission: "task_output", pattern: "*", action: "deny" },
      { permission: "task_cancel", pattern: "*", action: "deny" },
      { permission: "workspace_release", pattern: "*", action: "deny" },
      { permission: "consult_agents", pattern: "*", action: "deny" },
    ]
    for (const name of MEDIA_RUNTIME_TOOL_NAMES) {
      if (tools[name] !== false) rules.push({ permission: name, pattern: "*", action: "allow" })
    }
    return rules
  }
  if (category === "blender-previs") {
    const rules = [
      ...productionControlDeny,
      ...MEDIA_RUNTIME_TOOL_NAMES.map((permission) => ({ permission, pattern: "*", action: "deny" })),
      ...[
        "read",
        "glob",
        "grep",
        "list",
        "lsp",
        "edit",
        "write",
        "bash",
        "skill",
        "external_directory",
        "question",
        "delegate_task",
        "consult_agents",
        "task",
        "workspace_prepare",
        "execution_preflight",
        "workspace_checkpoint_update",
        "task_status",
        "task_output",
        "task_cancel",
        "workspace_release",
      ].map((permission) => ({ permission, pattern: "*", action: "deny" })),
    ]
    for (const name of BLENDER_PREVIS_TOOL_NAMES) {
      if (tools[name] !== false) rules.push({ permission: name, pattern: "*", action: "allow" })
    }
    return rules
  }
  if (category === "visual-engineering" && hasSkill(skills, "open-design")) {
    const rules = Object.entries(tools ?? {}).map(([tool, enabled]) => ({
      permission: ["write", "patch", "apply_patch"].includes(tool) ? "edit" : tool,
      pattern: "*",
      action: enabled ? "allow" : "deny",
    }))
    if (tools?.read !== false) {
      rules.push({ permission: "read", pattern: `mcp:${OPEN_DESIGN_SERVER}:*`, action: "allow" })
    }
    // This final rule is the hard ceiling. Category tool overrides may narrow
    // the session, but never broaden access to an OpenDesign raw tool.
    rules.push({ permission: `${OPEN_DESIGN_RAW_TOOL_PREFIX}*`, pattern: "*", action: "deny" })
    return rules
  }
  return undefined
}

export { BLENDER_PREVIS_TOOL_NAMES, isBlenderPrevisTool, isCategoryScopedGitMutation, isSafeGitCommand, permissionValue }
