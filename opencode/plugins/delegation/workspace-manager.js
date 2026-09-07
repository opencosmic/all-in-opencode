import { createHash, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, realpath, readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"

import { readJson, writeJson } from "./json-store.js"

const execFileAsync = promisify(execFile)

async function defaultGit(directory, args) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error).trim()
    throw new Error(`git ${args.join(" ")} failed: ${detail}`)
  }
}

async function canonical(path) {
  return realpath(path)
}

function slug(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  if (!normalized) throw new Error("task_id must contain at least one safe branch character")
  return normalized.slice(0, 48)
}

function projectKey(commonDir) {
  return createHash("sha256").update(commonDir).digest("hex").slice(0, 20)
}

function parseWorktrees(output) {
  if (!output.trim()) return []
  return output.trim().split(/\n\n+/).map((block) => {
    const item = { directory: null, head: null, branch: null }
    for (const line of block.split("\n")) {
      const [key, ...rest] = line.split(" ")
      const value = rest.join(" ")
      if (key === "worktree") item.directory = value
      if (key === "HEAD") item.head = value
      if (key === "branch") item.branch = value.replace(/^refs\/heads\//, "")
    }
    return item
  })
}

export class WorkspaceManager {
  constructor({
    stateDirectory = process.env.OPENCODE_WORKFLOW_DATA_ROOT
      ? join(process.env.OPENCODE_WORKFLOW_DATA_ROOT, "delegation")
      : join(homedir(), ".local", "share", "opencode-workflow", "delegation"),
    git = defaultGit,
    hasActiveTasks = async () => false,
    now = () => new Date().toISOString(),
  } = {}) {
    this.stateDirectory = resolve(stateDirectory)
    this.git = git
    this.hasActiveTasks = hasActiveTasks
    this.now = now
  }

  async repositoryFacts(directory) {
    const root = await canonical(await this.git(directory, ["rev-parse", "--show-toplevel"]))
    const commonDir = await canonical(await this.git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))
    return { root, commonDir, projectKey: projectKey(commonDir) }
  }

  manifestPath(project, workspaceID) {
    return join(this.stateDirectory, "manifests", project, `${workspaceID}.json`)
  }

  async prepare({ task_id: taskID, change_id: changeID, base_sha: requestedBase } = {}, repositoryDirectory) {
    if (!taskID) throw new Error("workspace_prepare requires task_id")
    const repository = await this.repositoryFacts(repositoryDirectory)
    const baseSha = await this.git(repository.root, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${requestedBase ?? "HEAD"}^{commit}`,
    ])
    const nonce = randomUUID()
    const workspaceID = `ws_${nonce}`
    const branch = `delegation/${slug(taskID)}-${nonce.slice(0, 8)}`
    const workspaceParent = join(this.stateDirectory, "workspaces", repository.projectKey)
    const manifestPath = this.manifestPath(repository.projectKey, workspaceID)
    await mkdir(join(this.stateDirectory, "manifests", repository.projectKey), { recursive: true })
    await mkdir(workspaceParent, { recursive: true })
    const directory = join(await canonical(workspaceParent), workspaceID)
    const manifest = {
      version: 1,
      status: "preparing",
      workspace_id: workspaceID,
      task_id: taskID,
      change_id: changeID ?? null,
      directory,
      branch,
      base_sha: baseSha,
      repository_root: repository.root,
      repository_id: repository.projectKey,
      git_common_dir: repository.commonDir,
      created_at: this.now(),
    }

    await writeJson(manifestPath, manifest)
    try {
      await this.git(repository.root, ["worktree", "add", "-b", branch, directory, baseSha])
      const validated = await this.validateManifest({ ...manifest, status: "active" })
      const active = { ...manifest, ...validated, status: "active" }
      await writeJson(manifestPath, active)
      return this.publicRecord(active)
    } catch (error) {
      await writeJson(manifestPath, {
        ...manifest,
        status: "preserved_error",
        error: error.message,
      })
      throw new Error(`workspace preparation failed; any created Git state was preserved: ${error.message}`)
    }
  }

  async findManifest(workspaceID) {
    const root = join(this.stateDirectory, "manifests")
    let projects
    try {
      projects = await readdir(root)
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`unknown workspace_id: ${workspaceID}`)
      throw error
    }
    for (const project of projects) {
      const path = this.manifestPath(project, workspaceID)
      const manifest = await readJson(path)
      if (manifest) return { manifest, path }
    }
    throw new Error(`unknown workspace_id: ${workspaceID}`)
  }

  async get(workspaceID, { validate = true } = {}) {
    const found = await this.findManifest(workspaceID)
    if (!validate) return found.manifest
    return { ...found.manifest, ...(await this.validateManifest(found.manifest)) }
  }

  async validateManifest(manifest) {
    if (!["active", "preparing"].includes(manifest.status)) {
      throw new Error(`workspace is not active: ${manifest.workspace_id} (${manifest.status})`)
    }
    const actualDirectory = await canonical(manifest.directory)
    if (actualDirectory !== manifest.directory) throw new Error("workspace directory does not match its canonical manifest path")
    const facts = await this.repositoryFacts(actualDirectory)
    if (facts.commonDir !== manifest.git_common_dir || facts.projectKey !== manifest.repository_id) {
      throw new Error("workspace Git common directory or repository identity does not match its manifest")
    }
    const branch = await this.git(actualDirectory, ["branch", "--show-current"])
    if (branch !== manifest.branch) throw new Error(`workspace branch mismatch: expected ${manifest.branch}, found ${branch || "detached"}`)
    const worktrees = parseWorktrees(await this.git(manifest.repository_root, ["worktree", "list", "--porcelain"]))
    const registered = worktrees.find((item) => resolve(item.directory) === actualDirectory)
    if (!registered || registered.branch !== manifest.branch) {
      throw new Error("workspace path/branch is not registered in the expected Git worktree set")
    }
    return { directory: actualDirectory, head: registered.head }
  }

  publicRecord(manifest) {
    return {
      workspace_id: manifest.workspace_id,
      directory: manifest.directory,
      branch: manifest.branch,
      base_sha: manifest.base_sha,
      git_common_dir: manifest.git_common_dir,
    }
  }

  async listPreserved(repositoryDirectory) {
    const repository = await this.repositoryFacts(repositoryDirectory)
    const directory = join(this.stateDirectory, "manifests", repository.projectKey)
    let files
    try {
      files = await readdir(directory)
    } catch (error) {
      if (error?.code === "ENOENT") return []
      throw error
    }
    const records = []
    for (const file of files.filter((name) => name.endsWith(".json"))) {
      const manifest = await readJson(join(directory, file))
      if (manifest?.status !== "released") records.push(manifest)
    }
    return records
  }

  async release(workspaceID) {
    const { manifest, path } = await this.findManifest(workspaceID)
    const validated = await this.get(workspaceID)
    if (await this.hasActiveTasks(workspaceID)) {
      throw new Error("workspace has a pending or running task; cancellation does not imply release")
    }
    const status = await this.git(validated.directory, ["status", "--porcelain=v1", "--untracked-files=all"])
    if (status) throw new Error("workspace is dirty; preserving it")
    try {
      await this.git(manifest.repository_root, ["merge-base", "--is-ancestor", manifest.branch, "HEAD"])
    } catch {
      throw new Error("workspace branch is not proven integrated into repository HEAD; preserving it")
    }
    await this.git(manifest.repository_root, ["worktree", "remove", manifest.directory])
    try {
      await this.git(manifest.repository_root, ["branch", "-d", manifest.branch])
    } catch (error) {
      await writeJson(path, { ...manifest, status: "worktree_released_branch_preserved", error: error.message })
      throw new Error(`worktree was normally removed but safe branch deletion refused: ${error.message}`)
    }
    const released = { ...manifest, status: "released", released_at: this.now() }
    await writeJson(path, released)
    return { workspace_id: workspaceID, status: "released", branch: manifest.branch, directory: manifest.directory }
  }
}

export { parseWorktrees }
