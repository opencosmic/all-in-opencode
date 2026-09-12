import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

function parseFrontmatter(source, fallbackName) {
  const match = source.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/)
  const fields = {}
  if (match) {
    for (const line of match[1].split("\n")) {
      const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/)
      if (!field) continue
      fields[field[1]] = field[2].trim().replace(/^("|')(.*)\1$/, "$2")
    }
  }
  return {
    name: fields.name || fallbackName,
    description: fields.description || "",
  }
}

function skillLocationFields(skill) {
  return {
    ...(skill?.path ? { path: skill.path } : {}),
    ...(skill?.location ? { location: skill.location } : {}),
  }
}

function isUnavailablePath(error) {
  return ["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)
}

async function skillFiles(root) {
  const result = []
  const visitedDirectories = new Set()

  async function visit(directory) {
    let identity
    try {
      identity = await realpath(directory)
      if (!(await stat(identity)).isDirectory()) return
    } catch (error) {
      if (isUnavailablePath(error)) return
      throw error
    }
    if (visitedDirectories.has(identity)) return
    visitedDirectories.add(identity)

    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (isUnavailablePath(error)) return
      throw error
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name === "SKILL.md") result.push(path)
      else if (entry.isSymbolicLink()) {
        let target
        try {
          target = await stat(path)
        } catch (error) {
          if (isUnavailablePath(error)) continue
          throw error
        }
        if (target.isDirectory()) await visit(path)
        else if (target.isFile() && entry.name === "SKILL.md") result.push(path)
      }
    }
  }
  await visit(root)
  return result
}

function projectRoots(directory) {
  const roots = []
  let current = resolve(directory)
  while (true) {
    roots.push(join(current, ".opencode", "skills"), join(current, ".opencode", "skill"))
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return roots
}

async function discoverSkills({ directory, home = homedir(), roots } = {}) {
  const candidates = roots ?? [
    ...(directory ? projectRoots(directory) : []),
    join(home, ".config", "opencode", "skills"),
    join(home, ".config", "opencode", "skill"),
    join(home, ".agents", "skills"),
    join(home, ".claude", "skills"),
  ]
  const seen = new Set()
  const skills = []
  for (const root of candidates) {
    for (const path of await skillFiles(root)) {
      const absolute = resolve(path)
      let identity
      try {
        identity = await realpath(absolute)
      } catch (error) {
        if (isUnavailablePath(error)) continue
        throw error
      }
      if (seen.has(identity)) continue
      seen.add(identity)
      const source = await readFile(absolute, "utf8")
      const metadata = parseFrontmatter(source, dirname(absolute).split("/").at(-1))
      if (!metadata.name || !metadata.description) continue
      if (skills.some((skill) => skill.name === metadata.name)) continue
      skills.push({
        ...metadata,
        path: absolute,
        content: source.replace(/^---\s*\n[\s\S]*?\n---(?:\s*\n|$)/, "").trim(),
      })
    }
  }
  return skills
}

export class SkillResolver {
  constructor({ entries = [] } = {}) {
    this.entries = entries.map((entry) => ({ ...entry }))
    this.byName = new Map(this.entries.map((entry) => [entry.name, entry]))
  }

  list() {
    return this.entries.map((skill) => ({
      name: skill.name,
      description: skill.description,
      ...skillLocationFields(skill),
    }))
  }

  resolve(names = []) {
    if (!Array.isArray(names)) throw new Error("load_skills must be an array of skill names")
    const selected = []
    const missing = []
    const seen = new Set()
    for (const name of names) {
      if (typeof name !== "string" || !name.trim()) throw new Error("load_skills entries must be non-empty strings")
      if (seen.has(name)) continue
      seen.add(name)
      const skill = this.byName.get(name)
      if (!skill) missing.push(name)
      else selected.push(skill)
    }
    if (missing.length) {
      const available = this.entries.map((entry) => entry.name).join(", ") || "none"
      throw new Error(`unknown skill(s): ${missing.join(", ")}. Available skills: ${available}`)
    }
    return selected.map((skill) => ({
      name: skill.name,
      description: skill.description,
      ...skillLocationFields(skill),
      content: skill.content,
    }))
  }
}

export { discoverSkills, parseFrontmatter, projectRoots }
