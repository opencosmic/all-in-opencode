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

export function categoryPermission(profile, input) {
  if (!profile?.category) return null
  const value = permissionValue(input)
  const type = input.type ?? input.permission

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

  if (type === "skill" || type === "external_directory") return "deny"

  return null
}

export function categorySessionPermission(category, tools = {}) {
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
  return undefined
}

export { isBrowserRuntimeCommand, isCategoryScopedGitMutation, isSafeGitCommand, permissionValue }
