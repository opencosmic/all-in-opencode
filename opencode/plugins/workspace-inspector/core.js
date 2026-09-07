import { execFile } from "node:child_process"
import { realpath, stat } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export function workspaceDirectoryFromToolContext(context) {
  if (typeof context?.directory === "string" && context.directory.trim()) return context.directory
  if (typeof context?.worktree === "string" && context.worktree.trim()) return context.worktree
  throw new Error("workspace_inspect requires a non-empty tool context directory or worktree; refusing to infer a filesystem path")
}

async function git(directory, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  })
  return stdout.trim()
}

async function canonical(path) {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function gitSucceeds(directory, args) {
  try {
    await git(directory, args)
    return true
  } catch {
    return false
  }
}

export async function inspectStrategySource(repoRoot, strategyPath, baseRef = "HEAD") {
  const requestedPath = isAbsolute(strategyPath) ? resolve(strategyPath) : resolve(repoRoot, strategyPath)
  const absolutePath = await canonical(requestedPath)
  const relativePath = relative(repoRoot, absolutePath)
  const outsideRepository = relativePath === ".." || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(relativePath)

  if (outsideRepository) {
    return {
      path: absolutePath,
      relativePath: null,
      baseRef,
      classification: "outside_repository",
      availableFromBase: false,
    }
  }

  let baseSha = null
  try {
    baseSha = await git(repoRoot, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`])
  } catch {
    return {
      path: absolutePath,
      relativePath,
      baseRef,
      baseSha,
      classification: "invalid_base",
      availableFromBase: false,
    }
  }

  const fileExists = await exists(absolutePath)
  const [trackedInHead, presentInBase, matchesBase, statusOutput] = await Promise.all([
    gitSucceeds(repoRoot, ["cat-file", "-e", `HEAD:${relativePath}`]),
    gitSucceeds(repoRoot, ["cat-file", "-e", `${baseSha}:${relativePath}`]),
    gitSucceeds(repoRoot, ["diff", "--quiet", baseSha, "--", relativePath]),
    git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all", "--", relativePath]),
  ])

  const availableFromBase = fileExists && presentInBase && matchesBase
  const classification = !fileExists
    ? "missing"
    : !presentInBase
      ? "untracked_or_absent_from_base"
      : matchesBase
        ? "available_from_base"
        : "modified_from_base"

  return {
    path: absolutePath,
    relativePath,
    baseRef,
    baseSha,
    exists: fileExists,
    trackedInHead,
    presentInBase,
    matchesBase,
    status: statusOutput || null,
    classification,
    availableFromBase,
  }
}

export function parseWorktreeList(output) {
  if (!output.trim()) return []
  return output.trim().split(/\n\n+/).map((block) => {
    const entry = { path: "", head: "", branch: null, detached: false, locked: false, prunable: false }
    for (const line of block.split("\n")) {
      const [key, ...rest] = line.split(" ")
      const value = rest.join(" ")
      if (key === "worktree") entry.path = value
      if (key === "HEAD") entry.head = value
      if (key === "branch") entry.branch = value.replace(/^refs\/heads\//, "")
      if (key === "detached") entry.detached = true
      if (key === "locked") entry.locked = true
      if (key === "prunable") entry.prunable = true
    }
    return entry
  })
}

export async function inspectWorkspace(directory, options = {}) {
  const requestedDirectory = await canonical(directory)
  let repoRoot
  try {
    repoRoot = await git(requestedDirectory, ["rev-parse", "--show-toplevel"])
  } catch {
    return { isGit: false, directory: requestedDirectory }
  }

  const [gitDir, commonDir, superproject, branch, head, statusOutput, worktreeOutput] = await Promise.all([
    git(repoRoot, ["rev-parse", "--path-format=absolute", "--git-dir"]),
    git(repoRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    git(repoRoot, ["rev-parse", "--show-superproject-working-tree"]),
    git(repoRoot, ["branch", "--show-current"]),
    git(repoRoot, ["rev-parse", "HEAD"]),
    git(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(repoRoot, ["worktree", "list", "--porcelain"]),
  ])

  const canonicalGitDir = await canonical(gitDir)
  const canonicalCommonDir = await canonical(commonDir)
  const isSubmodule = Boolean(superproject)
  const isLinkedWorktree = !isSubmodule && canonicalGitDir !== canonicalCommonDir
  const worktrees = parseWorktreeList(worktreeOutput)
  const canonicalRoot = await canonical(repoRoot)
  const current = worktrees.find((entry) => entry.path === canonicalRoot) ?? null
  const provenanceHint = canonicalRoot.includes("/.local/share/opencode/worktree/")
    ? "opencode-managed-path-pattern"
    : "unknown"

  const result = {
    isGit: true,
    directory: requestedDirectory,
    repoRoot: canonicalRoot,
    gitDir: canonicalGitDir,
    commonDir: canonicalCommonDir,
    superproject: superproject || null,
    isSubmodule,
    isLinkedWorktree,
    branch: branch || null,
    detached: !branch,
    head,
    status: statusOutput ? statusOutput.split("\0").filter(Boolean) : [],
    clean: statusOutput.length === 0,
    currentWorktree: current,
    worktrees,
    provenanceHint,
    note: "provenanceHint is advisory; path shape alone never authorizes cleanup",
  }
  if (options.strategyPath) {
    result.strategySource = await inspectStrategySource(canonicalRoot, options.strategyPath, options.baseRef)
  }
  return result
}
