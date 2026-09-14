import { dirname, relative, resolve } from "node:path"
import { tmpdir } from "node:os"

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

const OPEN_DESIGN_SERVER = "open-design"
// OpenCode sanitizes the hyphen in the configured server name before joining
// it with the MCP tool name: open-design -> open_design.
const OPEN_DESIGN_RAW_TOOL_PREFIX = "open_design_"
const OPEN_DESIGN_RESOURCE_TOOLS = new Set([
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
])

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

function isBrowserRuntimeCommand(command) {
  return /^ego-browser(?:\s|$)/.test(command.trim())
}

function isCategoryScopedGitMutation(command) {
  return /^git\s+(?:commit|cherry-pick)(?:\s|$)/.test(command.trim())
}

export function isGitMutationCommand(command) {
  return /^git\s+(?:add|commit|cherry-pick)(?:\s|$)/.test(String(command ?? "").trim())
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
    ["git", "browser-automation", "video-analysis"].includes(category)
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

  // OpenCode 1.18.29 names an MCP tool as sanitize(server) + "_" +
  // sanitize(tool). Keep the entire OpenDesign tool namespace denied,
  // including when a profile is unavailable during a parent or recovered
  // session. Resource access is a separate generic `read` permission.
  if (isOpenDesignRawToolPermission(type)) return "deny"
  if (type === "read" && isOpenDesignResourcePattern(value)) {
    return hasOpenDesignCapability(profile) && profile.tools?.read !== false ? "allow" : "deny"
  }

  if (!profile?.category) return null

  if (profile.category === "git" && type === "bash") {
    if (profile.tools?.bash === false) return "deny"
    return isSafeGitCommand(value) ? "allow" : "deny"
  }

  if (profile.category !== "git" && type === "bash" && isCategoryScopedGitMutation(value)) {
    return "deny"
  }

  if (profile.category === "browser-automation") {
    if (type === "skill") return profile.tools?.skill === false || value !== "ego-browser" ? "deny" : "allow"
    if (type === "bash") return profile.tools?.bash === false || !isBrowserRuntimeCommand(value) ? "deny" : "allow"
    if (type === "external_directory") {
      if (profile.tools?.skill === false) return "deny"
      return /\/(?:\.config\/opencode|\.agents|\.claude)\/skills\/ego-browser(?:\/|$)/.test(value)
        ? "allow"
        : "deny"
    }
  }

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
  if (category === "git") {
    const rules = [
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
  if (category === "browser-automation") {
    const rules = [
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "write", pattern: "*", action: "deny" },
      { permission: "skill", pattern: "*", action: "deny" },
      { permission: "external_directory", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "deny" },
    ]
    if (tools.skill !== false) rules.push(
      { permission: "skill", pattern: "ego-browser", action: "allow" },
      { permission: "external_directory", pattern: "*/skills/ego-browser", action: "allow" },
      { permission: "external_directory", pattern: "*/skills/ego-browser/*", action: "allow" },
    )
    if (tools.bash !== false) rules.push(
      { permission: "bash", pattern: "ego-browser", action: "allow" },
      { permission: "bash", pattern: "ego-browser *", action: "allow" },
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

export { isBrowserRuntimeCommand, isCategoryScopedGitMutation, isSafeGitCommand, permissionValue }
