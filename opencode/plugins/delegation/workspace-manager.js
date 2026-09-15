import { createHash, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { access, mkdir, realpath, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { promisify } from "node:util"

import { analyzeExecutionTasks } from "./execution-preflight.js"
import { readJson, writeJson } from "./json-store.js"
import { resolveProjectDataRoot } from "../project-data-root.js"

const execFileAsync = promisify(execFile)

export const PROTECTED_BASE_BRANCHES = Object.freeze(["main", "master"])

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
  if (!normalized) throw new Error("change or task identifier must contain at least one safe branch character")
  return normalized.slice(0, 48)
}

function branchName(changeID, requestedBranch) {
  if (requestedBranch !== undefined && requestedBranch !== null) {
    const branch = String(requestedBranch).trim().replace(/^refs\/heads\//, "")
    if (!branch || branch.startsWith("-") || branch.includes("..") || branch.includes("//") || /[\s~^:?*[\\]/.test(branch)) {
      throw new Error("change branch must be a safe Git branch name")
    }
    return branch
  }
  return `feat/${slug(changeID)}`
}

function primaryBranchCandidates(changeID, requestedBranch) {
  if (requestedBranch !== undefined && requestedBranch !== null) return [branchName(changeID, requestedBranch)]
  const safeChangeID = slug(changeID)
  return [
    `feat/${safeChangeID}`,
    `feature/${safeChangeID}`,
    `fix/${safeChangeID}`,
    `refactor/${safeChangeID}`,
    `change/${safeChangeID}`,
  ]
}

function isProtectedBranch(branch, protectedBranches = PROTECTED_BASE_BRANCHES) {
  const normalized = String(branch ?? "").replace(/^refs\/heads\//, "")
  return protectedBranches.includes(normalized)
}

function sameDirectory(left, right) {
  return Boolean(left && right) && resolve(left) === resolve(right)
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function projectKey(commonDir) {
  return createHash("sha256").update(commonDir).digest("hex").slice(0, 20)
}

function isNotGitRepositoryError(error) {
  return /not a git repository|outside any repository|not inside a Git worktree/i.test(String(error?.message ?? error))
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
    stateDirectory = join(resolveProjectDataRoot(), "delegation"),
    git = defaultGit,
    hasActiveTasks = async () => false,
    hasActiveDirectoryTasks = async () => false,
    now = () => new Date().toISOString(),
    protectedBranches = PROTECTED_BASE_BRANCHES,
  } = {}) {
    this.stateDirectory = resolve(stateDirectory)
    this.git = git
    this.hasActiveTasks = hasActiveTasks
    this.hasActiveDirectoryTasks = hasActiveDirectoryTasks
    this.now = now
    this.protectedBranches = [...protectedBranches]
  }

  async repositoryFacts(directory) {
    const root = await canonical(await this.git(directory, ["rev-parse", "--show-toplevel"]))
    const commonDir = await canonical(await this.git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))
    return { root, commonDir, projectKey: projectKey(commonDir) }
  }

  async requireRepositoryFacts(directory, operation) {
    try {
      return await this.repositoryFacts(directory)
    } catch (error) {
      if (!isNotGitRepositoryError(error)) throw error
      throw new Error(`${operation} requires a Git repository. Current directory is not inside a Git worktree.`)
    }
  }

  manifestPath(project, workspaceID) {
    return join(this.stateDirectory, "manifests", project, `${workspaceID}.json`)
  }

  async currentState(repository) {
    const [branch, head, statusOutput, worktreeOutput] = await Promise.all([
      this.git(repository.root, ["branch", "--show-current"]),
      this.git(repository.root, ["rev-parse", "HEAD"]),
      this.git(repository.root, ["status", "--porcelain=v1", "--untracked-files=all"]),
      this.git(repository.root, ["worktree", "list", "--porcelain"]),
    ])
    const worktrees = parseWorktrees(worktreeOutput)
    return {
      directory: repository.root,
      branch: branch || null,
      head,
      status: statusOutput ? statusOutput.split("\n").filter(Boolean) : [],
      clean: !statusOutput,
      protected: isProtectedBranch(branch, this.protectedBranches),
      worktrees,
      current_worktree: worktrees.find((item) => resolve(item.directory) === repository.root) ?? null,
    }
  }

  async branchFor(directory) {
    const repository = await this.requireRepositoryFacts(directory, "workspace branch inspection")
    return {
      ...repository,
      branch: (await this.git(repository.root, ["branch", "--show-current"])) || null,
      head: await this.git(repository.root, ["rev-parse", "HEAD"]),
    }
  }

  async projectManifests(project, { includeReleased = false, changeID, taskID } = {}) {
    const directory = join(this.stateDirectory, "manifests", project)
    let files
    try {
      files = await readdir(directory)
    } catch (error) {
      if (error?.code === "ENOENT") return []
      throw error
    }
    const manifests = []
    for (const file of files.filter((name) => name.endsWith(".json"))) {
      const manifest = await readJson(join(directory, file))
      if (!manifest) continue
      if (!includeReleased && ["released", "superseded", "finalized"].includes(manifest.status)) continue
      if (changeID !== undefined) {
        const manifestChangeID = String(manifest.change_id ?? "").trim()
        const implicitLegacyChangeID = String(manifest.task_id ?? "").trim()
        if ((manifestChangeID || implicitLegacyChangeID) !== String(changeID).trim()) continue
      }
      manifests.push(manifest)
    }
    return manifests
  }

  async listManifests(repositoryDirectory, options = {}) {
    const repository = await this.requireRepositoryFacts(repositoryDirectory, "workspace manifest inspection")
    return this.projectManifests(repository.projectKey, options)
  }

  async preflight({
    change_id: changeID,
    task_id: taskID,
    branch: requestedBranch,
    tasks = [],
    acceptance_criteria: acceptanceCriteria = [],
    verification = [],
    persisted_tasks: persistedTasks = [],
    dirty_ownership: dirtyOwnership = null,
    dirty_changes_belong_to_change: dirtyChangesBelongToChange = null,
  } = {}, repositoryDirectory) {
    const repository = await this.requireRepositoryFacts(repositoryDirectory, "execution preflight")
    const current = await this.currentState(repository)
    const manifests = await this.projectManifests(repository.projectKey, { changeID, taskID })
    const validWorkspaces = []
    const invalidWorkspaces = []
    for (const manifest of manifests) {
      try {
        const validated = await this.validateManifest(manifest)
        const statusOutput = await this.git(validated.directory, ["status", "--porcelain=v1", "--untracked-files=all"])
        validWorkspaces.push({
          ...this.publicRecord({ ...manifest, ...validated }),
          status: manifest.status,
          valid: true,
          clean: !statusOutput,
          dirty_changes: statusOutput ? statusOutput.split("\n").filter(Boolean) : [],
        })
      } catch (error) {
        invalidWorkspaces.push({
          ...this.publicRecord(manifest),
          status: manifest.status,
          valid: false,
          error: error.message,
        })
      }
    }

    const knownDirectories = new Set([
      repository.root,
      ...current.worktrees.map((worktree) => worktree.directory),
      ...validWorkspaces.map((workspace) => workspace.directory),
    ].filter(Boolean).map((directory) => resolve(directory)))
    const analysis = analyzeExecutionTasks(tasks)
    const relevantPersistedTasks = (Array.isArray(persistedTasks) ? persistedTasks : [])
      .filter((task) => task.change_id === changeID
        || validWorkspaces.some((workspace) => workspace.workspace_id === task.workspace_id)
        || (task.execution_directory && knownDirectories.has(resolve(task.execution_directory))))
      .map((task) => ({
        task_id: task.task_id,
        change_id: task.change_id ?? null,
        status: task.status,
        workspace_id: task.workspace_id ?? null,
        execution_directory: task.execution_directory ?? null,
        agent: task.agent ?? null,
        category: task.category ?? null,
        description: task.description ?? null,
        started_at: task.started_at ?? null,
        completed_at: task.completed_at ?? null,
        error: task.error ?? null,
      }))
    const activeTasks = relevantPersistedTasks.filter((task) => !["completed", "error", "cancelled"].includes(task.status))
    const activeWorkspaceIDs = [...new Set(activeTasks.map((task) => task.workspace_id).filter(Boolean))]
    const workspaceIsContended = (workspace) => Boolean(
      workspace && (
        activeWorkspaceIDs.includes(workspace.workspace_id)
        || activeTasks.some((task) => sameDirectory(task.execution_directory, workspace.directory))
      ),
    )
    const desiredBranches = changeID ? primaryBranchCandidates(changeID, requestedBranch) : []
    const existingPrimary = validWorkspaces.find((workspace) => workspace.role === "primary") ?? null
    const dirtyOwnershipProven = dirtyOwnership === "same-change" || dirtyChangesBelongToChange === true
    const existingPrimaryDirty = Boolean(existingPrimary?.dirty_changes?.length)
    const currentWorkspaceContended = activeTasks.some((task) => sameDirectory(task.execution_directory, repository.root))
    const currentMatchesChange = Boolean(
      desiredBranches.length
      && desiredBranches.includes(current.branch)
      && !current.protected,
    ) && (!current.status.length || dirtyOwnershipProven) && !currentWorkspaceContended
    const protectedBase = await this.configuredProtectedBaseBranch(repository, current)
    const protectedBaseHead = protectedBase
      ? await this.git(repository.root, ["rev-parse", "--verify", "--end-of-options", `${protectedBase}^{commit}`]).catch(() => null)
      : null
    const requestedVerification = Array.isArray(verification)
      ? [...new Set(verification.map((item) => String(item ?? "").trim()).filter(Boolean))]
      : verification && typeof verification === "object"
        ? structuredClone(verification)
        : []
    const verificationStrategy = Array.isArray(requestedVerification) && requestedVerification.length === 0
      ? [
          "focused checks for affected paths",
          "whole-change tests, lint, typecheck, or build as applicable",
          "fresh Reviewer approval",
          "QA or browser/runtime evidence when the change requires it",
        ]
      : requestedVerification
    const criteria = [...new Set([
      ...(Array.isArray(acceptanceCriteria) ? acceptanceCriteria : []),
      ...analysis.tasks.flatMap((task) => task.acceptance_criteria),
    ].map((item) => String(item ?? "").trim()).filter(Boolean))]
    const workspaceStrategy = existingPrimary
      ? workspaceIsContended(existingPrimary)
        ? "primary-contended"
        : existingPrimaryDirty && !dirtyOwnershipProven
          ? dirtyOwnership === "unrelated" || dirtyChangesBelongToChange === false
            ? "isolate-dirty-primary"
            : "reconcile-dirty-primary"
        : "reuse-existing-primary"
      : currentMatchesChange
        ? "reuse-current"
        : "create-primary"
    const parallelism = analysis.execution_mode
    const logicalChange = {
      change_id: changeID ?? null,
      task_count: analysis.tasks.length,
      acceptance_criteria: criteria,
      likely_affected_subsystems: [...new Set([
        ...analysis.tasks.flatMap((task) => task.write_scope.map((path) => path.split(/[\\/]/)[0])),
        ...current.status.map((line) => line.slice(3).trim().split(/[\\/]/)[0]),
      ].filter(Boolean))],
    }
    const repositoryReality = {
      root: repository.root,
      common_dir: repository.commonDir,
      repository_id: repository.projectKey,
      current,
      protected_base_branch: protectedBase,
      protected_base_head: protectedBaseHead,
      worktrees: current.worktrees,
      clean: current.clean,
      dirty_changes: current.status,
    }
    const contention = {
      active: activeTasks.length > 0,
      active_tasks: activeTasks,
      active_workspace_ids: activeWorkspaceIDs,
      current_workspace_contended: currentWorkspaceContended,
    }
    return {
      version: 1,
      preflight_id: `preflight_${randomUUID()}`,
      change_id: changeID ?? null,
      logical_change: logicalChange,
      repository: repositoryReality,
      repository_reality: repositoryReality,
      persisted: {
        tasks: relevantPersistedTasks,
        managed_workspaces: validWorkspaces,
        invalid_workspaces: invalidWorkspaces,
      },
      tasks: analysis.tasks,
      dependencies: {
        edges: analysis.dependency_edges,
        unknown: analysis.unknown_dependencies,
        cycles: analysis.cycles,
      },
      source_overlap: {
        pairs: analysis.overlap_pairs,
        unknown_scope_tasks: analysis.unknown_scope_tasks,
        required_uncommitted_tasks: analysis.uncommitted_tasks,
      },
      contention,
      verification_strategy: verificationStrategy,
      dirty_ownership: dirtyOwnership,
      decisions: {
        workspace_strategy: workspaceStrategy,
        execution_mode: parallelism,
        parallel_safe: analysis.parallel_safe,
        must_serialize: analysis.must_serialize,
        primary_branch_candidates: desiredBranches,
        child_worktrees_require_reason: true,
        implementation_on_protected_base: false,
      },
      recommended_primary_workspace: existingPrimary
        && !workspaceIsContended(existingPrimary)
        && (!existingPrimaryDirty || dirtyOwnershipProven)
        ? existingPrimary
        : currentMatchesChange
        ? {
            workspace_id: null,
            directory: current.directory,
            branch: current.branch,
            base_sha: current.head,
            role: "primary",
            managed_worktree: false,
          }
        : null,
    }
  }

  async prepare(input = {}, repositoryDirectory) {
    const taskID = input.task_id ? String(input.task_id).trim() : null
    const changeID = String(input.change_id ?? taskID ?? "").trim()
    if (!changeID) throw new Error("workspace_prepare requires change_id or task_id")
    const repository = await this.requireRepositoryFacts(repositoryDirectory, "workspace_prepare")
    // Keep the read-only reconciliation immediately before every topology
    // decision. A caller cannot create a branch from an uninspected tree.
    const preflight = await this.preflight({
      change_id: changeID,
      task_id: taskID,
      branch: input.branch,
      persisted_tasks: input.persisted_tasks,
      dirty_ownership: input.dirty_ownership,
      dirty_changes_belong_to_change: input.dirty_changes_belong_to_change,
    }, repository.root)
    const role = input.role ?? (input.isolation ? "child" : "primary")
    if (!["primary", "child"].includes(role)) throw new Error("workspace_prepare role must be primary or child")
    if (role === "child") return this.prepareChild(input, taskID, changeID, repository, preflight)
    return this.preparePrimary(input, taskID, changeID, repository, preflight)
  }

  async directoryHasActiveTasks(directory, preflight) {
    const persistedContention = preflight?.contention?.active_tasks?.some((task) =>
      sameDirectory(task.execution_directory, directory))
    return Boolean(persistedContention) || await this.hasActiveDirectoryTasks(directory)
  }

  async workspaceHasActiveTasks(workspace, preflight) {
    const persistedContention = preflight?.contention?.active_tasks?.some((task) =>
      (workspace.workspace_id && task.workspace_id === workspace.workspace_id)
      || sameDirectory(task.execution_directory, workspace.directory))
    return Boolean(persistedContention)
      || await this.hasActiveTasks(workspace.workspace_id)
      || await this.hasActiveDirectoryTasks(workspace.directory)
  }

  dependentChildren(workspaces, primaryWorkspaceID) {
    return workspaces.filter((workspace) =>
      workspace.role === "child"
      && workspace.primary_workspace_id === primaryWorkspaceID
      && !["released", "superseded", "finalized"].includes(workspace.status))
  }

  async assertPrimaryReplacementAllowed(preflight, replacementWorkspaceID = null) {
    const candidates = [
      ...(preflight.persisted.managed_workspaces ?? []),
      ...(preflight.persisted.invalid_workspaces ?? []),
    ].filter((workspace) =>
      workspace.role === "primary"
      && workspace.change_id === preflight.change_id
      && workspace.workspace_id !== replacementWorkspaceID)
    const projectWorkspaces = await this.projectManifests(preflight.repository.repository_id)
    for (const candidate of candidates) {
      const children = this.dependentChildren(projectWorkspaces, candidate.workspace_id)
      if (children.length) {
        throw new Error(`cannot supersede primary workspace ${candidate.workspace_id} while dependent child workspace(s) remain active or unreleased; complete, integrate, and release them first`)
      }
    }
  }

  async supersedePrimary(workspaceID, replacementWorkspaceID, reason) {
    const { manifest, path } = await this.findManifest(workspaceID)
    if (!["active", "preparing"].includes(manifest.status)) return
    await writeJson(path, {
      ...manifest,
      status: "superseded",
      canonical: false,
      superseded_by: replacementWorkspaceID,
      superseded_at: this.now(),
      supersede_reason: reason,
    })
  }

  async canonicalizePrimary(preflight, workspaceID, reason) {
    await this.assertPrimaryReplacementAllowed(preflight, workspaceID)
    const candidates = preflight.persisted.managed_workspaces.filter((workspace) =>
      workspace.role === "primary"
      && workspace.valid
      && workspace.change_id === preflight.change_id
      && workspace.workspace_id !== workspaceID)
    for (const candidate of candidates) {
      if (await this.workspaceHasActiveTasks(candidate, preflight)) {
        throw new Error(`cannot supersede active primary workspace ${candidate.workspace_id}; serialize its task first`)
      }
    }
    for (const candidate of candidates) {
      await this.supersedePrimary(candidate.workspace_id, workspaceID, reason)
    }
  }

  async reusablePrimary(changeID, taskID, preflight, input = {}) {
    const candidates = preflight.persisted.managed_workspaces.filter((workspace) =>
      workspace.role === "primary" && workspace.valid && workspace.change_id === changeID)
    if (!candidates.length) return null
    const candidate = candidates.find((workspace) => !workspace.dirty_changes?.length) ?? candidates[0]
    const manifest = await this.get(candidate.workspace_id)
    const status = await this.git(manifest.directory, ["status", "--porcelain=v1", "--untracked-files=all"])
    const dirtyOwnershipProven = input.dirty_ownership === "same-change"
      || input.dirty_changes_belong_to_change === true
    const active = await this.workspaceHasActiveTasks({
      workspace_id: manifest.workspace_id,
      directory: manifest.directory,
    }, preflight)
    if (status && !dirtyOwnershipProven) {
      if (active) {
        throw new Error(`primary workspace for change ${changeID} is currently in use; reconcile or serialize its dirty work first`)
      }
      if (input.dirty_ownership === "unrelated" || input.dirty_changes_belong_to_change === false) return null
      throw new Error(`primary workspace for change ${changeID} is dirty; declare dirty_ownership="same-change" after reconciling its ownership`)
    }
    if (active && manifest.task_id !== taskID) {
      throw new Error(`primary workspace for change ${changeID} is currently in use; request an explicit isolated child workspace`)
    }
    await this.canonicalizePrimary(preflight, manifest.workspace_id, "existing-primary-reused")
    return { ...this.publicRecord(manifest), reused: true }
  }

  async preparePrimary(input, taskID, changeID, repository, preflight) {
    const branchCandidates = primaryBranchCandidates(changeID, input.branch)
    if (branchCandidates.some((branch) => isProtectedBranch(branch, this.protectedBranches))) {
      throw new Error(`protected base branch ${branchCandidates.find((branch) => isProtectedBranch(branch, this.protectedBranches))} cannot be used as a change workspace`)
    }
    const existing = await this.reusablePrimary(changeID, taskID, preflight, input)
    if (existing) return existing
    await this.assertPrimaryReplacementAllowed(preflight)

    const current = preflight.repository.current
    const dirtyOwnershipProven = input.dirty_ownership === "same-change"
      || input.dirty_changes_belong_to_change === true
    const currentIsCandidate = (current.branch && (branchCandidates.includes(current.branch) || (input.reuse_current === true && !current.protected)))
      && (!current.status.length || dirtyOwnershipProven)
    const currentDirtyRequiresIsolation = current.branch
      && branchCandidates.includes(current.branch)
      && current.status.length
      && !dirtyOwnershipProven
      && (input.dirty_ownership === "unrelated" || input.dirty_changes_belong_to_change === false)
    if (current.branch && branchCandidates.includes(current.branch) && current.status.length && !dirtyOwnershipProven && !currentDirtyRequiresIsolation) {
      throw new Error(`current branch ${current.branch} is dirty; declare dirty_ownership="same-change" after reconciling its ownership`)
    }
    if (currentIsCandidate && !current.protected) {
      if (await this.directoryHasActiveTasks(repository.root, preflight)) {
        throw new Error(`primary workspace for change ${changeID} is currently in use; request an explicit isolated child workspace`)
      }
      const adopted = await this.adoptWorkspace({
        taskID,
        changeID,
        repository,
        directory: repository.root,
        branch: current.branch,
        baseSha: await this.resolvePrimaryBase({
          requestedBase: input.base_sha,
          branch: current.branch,
          branchExists: true,
          repository,
          preflight,
        }),
        role: "primary",
        managedWorktree: false,
        provenance: "current-worktree",
      })
      await this.canonicalizePrimary(preflight, adopted.workspace_id, "current-worktree-adopted")
      return adopted
    }

    let requiresIsolatedBranch = Boolean(currentDirtyRequiresIsolation)
    let registered = preflight.repository.worktrees.find((worktree) =>
      branchCandidates.includes(worktree.branch)
      && !(currentDirtyRequiresIsolation && resolve(worktree.directory) === repository.root))
    if (registered) {
      const registeredStatus = await this.git(registered.directory, ["status", "--porcelain=v1", "--untracked-files=all"])
      if (registeredStatus && !dirtyOwnershipProven) {
        if (input.dirty_ownership === "unrelated" || input.dirty_changes_belong_to_change === false) {
          requiresIsolatedBranch = true
          registered = null
        } else {
          throw new Error(`primary branch ${registered.branch} is dirty; declare dirty_ownership="same-change" after reconciling its ownership`)
        }
      }
    }
    if (registered) {
      if (await this.directoryHasActiveTasks(registered.directory, preflight)) {
        throw new Error(`primary workspace for change ${changeID} is currently in use; request an explicit isolated child workspace`)
      }
      const adopted = await this.adoptWorkspace({
        taskID,
        changeID,
        repository,
        directory: await canonical(registered.directory),
        branch: registered.branch,
        baseSha: await this.resolvePrimaryBase({
          requestedBase: input.base_sha,
          branch: registered.branch,
          branchExists: true,
          repository,
          preflight,
        }),
        role: "primary",
        managedWorktree: this.isManagedDirectory(registered.directory),
        provenance: "existing-worktree",
      })
      await this.canonicalizePrimary(preflight, adopted.workspace_id, "existing-worktree-adopted")
      return adopted
    }

    let branch = branchCandidates[0]
    let branchExists = false
    if (requiresIsolatedBranch) {
      if (input.branch) throw new Error(`requested branch ${input.branch} is dirty and cannot be reused for an unrelated change`)
      branch = `feat/${slug(changeID)}-isolated-${randomUUID().slice(0, 8)}`
    } else {
      for (const candidate of branchCandidates) {
        if (await this.gitSucceeds(repository.root, [
          "show-ref", "--verify", "--quiet", `refs/heads/${candidate}`,
        ])) {
          branch = candidate
          branchExists = true
          break
        }
      }
    }
    const baseSha = await this.resolvePrimaryBase({
      requestedBase: input.base_sha,
      branch,
      branchExists,
      repository,
      preflight,
    })
    const currentCanBecomePrimary = current.protected
      && current.clean
      && !requiresIsolatedBranch
      && !await this.directoryHasActiveTasks(repository.root, preflight)
    if (currentCanBecomePrimary) {
      const switched = await this.switchCurrentPrimary({
        taskID,
        changeID,
        repository,
        branch,
        branchExists,
        baseSha,
      })
      await this.canonicalizePrimary(preflight, switched.workspace_id, "protected-checkout-switched")
      return switched
    }
    const created = await this.createLinkedWorkspace({
      taskID,
      changeID,
      repository,
      branch,
      baseSha,
      role: "primary",
      integrationTargetBranch: null,
      managedWorktree: true,
      provenance: "runtime-created-primary",
    })
    await this.canonicalizePrimary(
      preflight,
      created.workspace_id,
      requiresIsolatedBranch ? "unrelated-dirty-primary-replaced" : "primary-created",
    )
    return created
  }

  async prepareChild(input, taskID, changeID, repository, preflight) {
    if (!taskID) throw new Error("child workspace preparation requires task_id")
    const parentID = input.parent_workspace_id ?? input.primary_workspace_id
    const parent = parentID ? await this.get(parentID) : null
    if (parent) await this.assertWorkspaceBelongsToRepository(parent, repository, "workspace_prepare")
    const existing = preflight.persisted.managed_workspaces.find((workspace) =>
      workspace.role === "child"
      && workspace.valid
      && workspace.change_id === changeID
      && workspace.task_id === taskID)
    if (existing) {
      const manifest = await this.get(existing.workspace_id)
      if (await this.hasActiveTasks(existing.workspace_id) && manifest.task_id !== taskID) {
        throw new Error(`child workspace for task ${taskID} is currently in use`)
      }
      return { ...this.publicRecord(manifest), reused: true }
    }
    if (!parentID) throw new Error("child workspace preparation requires parent_workspace_id")
    if ((parent.role ?? "primary") !== "primary" && parent.primary_workspace_id !== parent.workspace_id) {
      throw new Error("child workspace parent must be the primary change workspace")
    }
    const parentChangeID = parent.change_id ?? parent.task_id
    if (parentChangeID && parentChangeID !== changeID) {
      throw new Error(`child change_id ${changeID} does not match its primary workspace ${parentChangeID}`)
    }
    const reason = String(input.isolation_reason ?? input.reason ?? "").trim()
    if (!reason) throw new Error("child workspace preparation requires a concrete isolation_reason")
    const parentStatus = await this.git(parent.directory, ["status", "--porcelain=v1", "--untracked-files=all"])
    if (parentStatus && (input.depends_on_uncommitted === true || input.requires_uncommitted === true)) {
      throw new Error("required uncommitted changes are not shared between Git worktrees; coordinate or commit them first")
    }
    if (parentStatus && input.depends_on_uncommitted !== false && input.independent_from_uncommitted !== true) {
      throw new Error("parent workspace is dirty; declare independent_from_uncommitted=true or coordinate the required changes before isolating")
    }
    const parentHead = await this.git(parent.directory, ["rev-parse", "HEAD"])
    const nonce = randomUUID()
    const branch = branchName(changeID, input.branch ?? `delegation/${slug(changeID)}/${slug(taskID)}-${nonce.slice(0, 8)}`)
    if (isProtectedBranch(branch, this.protectedBranches)) {
      throw new Error(`protected base branch ${branch} cannot be used as a child workspace`)
    }
    const baseSha = await this.resolveCommit(repository.root, input.base_sha ?? parentHead)
    if (!await this.gitSucceeds(parent.directory, ["merge-base", "--is-ancestor", baseSha, parentHead])) {
      throw new Error("child workspace base must be an ancestor of the current primary HEAD")
    }
    return this.createLinkedWorkspace({
      taskID,
      changeID,
      repository,
      branch,
      baseSha,
      role: "child",
      primaryWorkspaceID: parent.primary_workspace_id ?? parent.workspace_id,
      parentWorkspaceID: parent.workspace_id,
      integrationTargetBranch: parent.branch,
      managedWorktree: true,
      isolationReason: reason,
      provenance: "runtime-created-child",
    })
  }

  async configuredProtectedBaseBranch(repository, current) {
    if (current.protected && current.branch) return current.branch
    for (const branch of this.protectedBranches) {
      if (await this.gitSucceeds(repository.root, [
        "show-ref", "--verify", "--quiet", `refs/heads/${branch}`,
      ])) return branch
    }
    return null
  }

  async resolvePrimaryBase({ requestedBase, branch, branchExists, repository, preflight }) {
    if (requestedBase) return this.resolveCommit(repository.root, requestedBase)
    if (branchExists) {
      if (preflight.repository.protected_base_head) {
        return this.git(repository.root, ["merge-base", branch, preflight.repository.protected_base_head])
          .catch(() => this.resolveCommit(repository.root, branch))
      }
      return this.resolveCommit(repository.root, branch)
    }
    if (preflight.repository.protected_base_head) return preflight.repository.protected_base_head
    throw new Error("cannot resolve a configured protected base branch for a new primary workspace")
  }

  async resolveCommit(directory, ref) {
    return this.git(directory, [
      "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`,
    ])
  }

  async gitSucceeds(directory, args) {
    try {
      await this.git(directory, args)
      return true
    } catch {
      return false
    }
  }

  async workspaceDirectory(repository, role, changeID, workspaceID) {
    const parent = join(this.stateDirectory, "workspaces", repository.projectKey, role === "primary" ? "primary" : "children")
    await mkdir(parent, { recursive: true })
    const root = await canonical(parent)
    const baseName = role === "primary" ? slug(changeID) : workspaceID
    const preferred = join(root, baseName)
    return (await pathExists(preferred)) ? join(root, `${baseName}-${randomUUID().slice(0, 8)}`) : preferred
  }

  isManagedDirectory(directory) {
    const root = resolve(this.stateDirectory, "workspaces")
    const candidate = resolve(directory)
    return candidate === root || candidate.startsWith(`${root}/`)
  }

  async switchCurrentPrimary({
    taskID,
    changeID,
    repository,
    branch,
    branchExists,
    baseSha,
  }) {
    if (branchExists) {
      await this.git(repository.root, ["switch", branch])
    } else {
      await this.git(repository.root, ["switch", "-c", branch, baseSha])
    }
    return this.adoptWorkspace({
      taskID,
      changeID,
      repository,
      directory: repository.root,
      branch,
      baseSha,
      role: "primary",
      managedWorktree: false,
      provenance: "runtime-switched-current-worktree",
    })
  }

  async createLinkedWorkspace({
    taskID,
    changeID,
    repository,
    branch,
    baseSha,
    role,
    primaryWorkspaceID = null,
    parentWorkspaceID = null,
    integrationTargetBranch = null,
    managedWorktree,
    isolationReason = null,
    provenance,
  }) {
    const workspaceID = `ws_${randomUUID()}`
    const directory = await this.workspaceDirectory(repository, role, changeID, workspaceID)
    const manifestPath = this.manifestPath(repository.projectKey, workspaceID)
    const manifest = {
      version: 2,
      status: "preparing",
      workspace_id: workspaceID,
      task_id: taskID,
      change_id: changeID,
      role,
      primary_workspace_id: primaryWorkspaceID ?? (role === "primary" ? workspaceID : null),
      parent_workspace_id: parentWorkspaceID,
      managed_worktree: managedWorktree,
      canonical: role === "primary",
      provenance,
      isolation_reason: isolationReason,
      directory,
      branch,
      base_sha: baseSha,
      integration_target_branch: integrationTargetBranch,
      repository_root: repository.root,
      repository_id: repository.projectKey,
      git_common_dir: repository.commonDir,
      created_at: this.now(),
    }
    await mkdir(join(this.stateDirectory, "manifests", repository.projectKey), { recursive: true })
    await writeJson(manifestPath, manifest)
    try {
      const branchExists = await this.gitSucceeds(repository.root, [
        "show-ref", "--verify", "--quiet", `refs/heads/${branch}`,
      ])
      if (branchExists) {
        await this.git(repository.root, ["worktree", "add", directory, branch])
      } else {
        await this.git(repository.root, ["worktree", "add", "-b", branch, directory, baseSha])
      }
      const validated = await this.validateManifest({ ...manifest, status: "active" })
      const active = { ...manifest, ...validated, status: "active", reused: false }
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

  async adoptWorkspace({
    taskID,
    changeID,
    repository,
    directory,
    branch,
    baseSha,
    role,
    managedWorktree,
    provenance,
  }) {
    const workspaceID = `ws_${randomUUID()}`
    const manifestPath = this.manifestPath(repository.projectKey, workspaceID)
    const manifest = {
      version: 2,
      status: "active",
      workspace_id: workspaceID,
      task_id: taskID,
      change_id: changeID,
      role,
      primary_workspace_id: workspaceID,
      parent_workspace_id: null,
      managed_worktree: managedWorktree,
      canonical: role === "primary",
      provenance,
      isolation_reason: null,
      directory: await canonical(directory),
      branch,
      base_sha: baseSha,
      integration_target_branch: null,
      repository_root: repository.root,
      repository_id: repository.projectKey,
      git_common_dir: repository.commonDir,
      created_at: this.now(),
      reused: false,
    }
    await mkdir(join(this.stateDirectory, "manifests", repository.projectKey), { recursive: true })
    const validated = await this.validateManifest(manifest)
    const active = { ...manifest, ...validated }
    await writeJson(manifestPath, active)
    return this.publicRecord(active)
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

  async assertWorkspaceBelongsToRepository(workspace, repository, operation) {
    const workspaceRepositoryID = String(workspace?.repository_id ?? "").trim()
    const workspaceCommonDir = workspace?.git_common_dir
      ? await canonical(workspace.git_common_dir).catch(() => null)
      : null
    const currentRepositoryID = String(repository?.projectKey ?? "").trim()
    if (workspaceRepositoryID !== currentRepositoryID || workspaceCommonDir !== repository?.commonDir) {
      throw new Error(`${operation} workspace ${workspace?.workspace_id ?? "unknown"} belongs to repository ${workspaceRepositoryID || "unknown"}; current execution context belongs to repository ${currentRepositoryID || "unknown"}`)
    }
  }

  async validateManifest(manifest) {
    if (!["active", "preparing"].includes(manifest.status)) {
      throw new Error(`workspace is not active: ${manifest.workspace_id} (${manifest.status})`)
    }
    if (isProtectedBranch(manifest.branch, this.protectedBranches)) {
      throw new Error(`workspace branch ${manifest.branch} is a protected base branch`)
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
    const legacyPrimary = manifest.role === undefined || manifest.role === null
    return {
      workspace_id: manifest.workspace_id,
      task_id: manifest.task_id ?? null,
      directory: manifest.directory,
      branch: manifest.branch,
      base_sha: manifest.base_sha,
      git_common_dir: manifest.git_common_dir,
      // Version-one manifests represented one isolated task, so treat an
      // unfinished legacy record as that task's resumable primary workspace.
      change_id: manifest.change_id ?? (legacyPrimary ? manifest.task_id ?? null : null),
      role: manifest.role ?? "primary",
      primary_workspace_id: manifest.primary_workspace_id ?? (legacyPrimary ? manifest.workspace_id : null),
      parent_workspace_id: manifest.parent_workspace_id ?? null,
      managed_worktree: manifest.managed_worktree !== false,
      canonical: manifest.canonical !== false,
      integration_target_branch: manifest.integration_target_branch ?? null,
      isolation_reason: manifest.isolation_reason ?? null,
      reused: Boolean(manifest.reused),
    }
  }

  async listPreserved(repositoryDirectory) {
    try {
      return await this.listManifests(repositoryDirectory)
    } catch (error) {
      if (isNotGitRepositoryError(error)) return []
      throw error
    }
  }

  async finalizeInPlace(workspaceID, manifest, path, repositoryDirectory, options = {}) {
    if (manifest.status !== "active") {
      throw new Error(`workspace ${workspaceID} is not active; preserving its manifest`)
    }
    if (manifest.role !== undefined && manifest.role !== null && manifest.role !== "primary") {
      throw new Error("only an in-place primary workspace can be finalized")
    }
    if (isProtectedBranch(manifest.branch, this.protectedBranches)) {
      throw new Error("a protected branch cannot be finalized as an in-place primary workspace")
    }
    const integrationBranch = String(options.integration_branch ?? "").trim().replace(/^refs\/heads\//, "")
    if (!integrationBranch || !isProtectedBranch(integrationBranch, this.protectedBranches)) {
      throw new Error("in-place primary finalization requires an explicit protected integration_branch")
    }
    const repository = await this.requireRepositoryFacts(
      repositoryDirectory ?? manifest.repository_root,
      "workspace_release",
    )
    if (!sameDirectory(repository.root, manifest.repository_root)
      || repository.projectKey !== manifest.repository_id
      || repository.commonDir !== manifest.git_common_dir
      || !sameDirectory(repository.root, manifest.directory)) {
      throw new Error("in-place primary finalization repository does not match its manifest; preserving it")
    }
    if (await this.hasActiveTasks(workspaceID) || await this.hasActiveDirectoryTasks(repository.root)) {
      throw new Error("cannot finalize an in-place primary while a task still uses it")
    }
    const dependentChildren = (await this.projectManifests(repository.projectKey)).filter((candidate) =>
      candidate.role === "child"
      && candidate.primary_workspace_id === workspaceID
      && !["released", "superseded", "finalized"].includes(candidate.status))
    if (dependentChildren.length) {
      throw new Error(`cannot finalize primary workspace ${workspaceID} while dependent child workspace(s) remain active or unreleased; complete, integrate, and release them first`)
    }
    const currentBranch = await this.git(repository.root, ["branch", "--show-current"])
    if (currentBranch !== integrationBranch) {
      throw new Error(`in-place primary finalization requires the repository checkout on ${integrationBranch}; found ${currentBranch || "detached"}`)
    }
    const status = await this.git(repository.root, ["status", "--porcelain=v1", "--untracked-files=all"])
    if (status) throw new Error("repository checkout is dirty or has an unresolved integration; preserving the primary manifest")
    const integrationHead = await this.resolveCommit(repository.root, integrationBranch)
    if (!await this.gitSucceeds(repository.root, ["merge-base", "--is-ancestor", manifest.branch, integrationBranch])) {
      throw new Error(`primary branch ${manifest.branch} is not integrated into ${integrationBranch}; preserving the primary manifest`)
    }
    const finalized = {
      ...manifest,
      status: "finalized",
      canonical: false,
      finalized_into_branch: integrationBranch,
      finalized_into_head: integrationHead,
      finalized_at: this.now(),
    }
    await writeJson(path, finalized)
    return {
      workspace_id: workspaceID,
      status: "finalized",
      branch: manifest.branch,
      directory: manifest.directory,
      integration_branch: integrationBranch,
      integration_head: integrationHead,
      canonical: false,
      managed_worktree: false,
    }
  }

  async release(workspaceID, repositoryDirectory, options = {}) {
    const repository = repositoryDirectory
      ? await this.requireRepositoryFacts(repositoryDirectory, "workspace_release")
      : null
    const { manifest, path } = await this.findManifest(workspaceID)
    if (repository) await this.assertWorkspaceBelongsToRepository(manifest, repository, "workspace_release")
    if (manifest.managed_worktree === false) {
      if (options.finalize_in_place !== true) {
        throw new Error("primary workspace is the current or externally-owned worktree; preserving it")
      }
      return this.finalizeInPlace(workspaceID, manifest, path, repositoryDirectory, options)
    }
    if (options.finalize_in_place === true) {
      throw new Error("finalize_in_place is only valid for an in-place primary workspace")
    }
    const validated = await this.get(workspaceID)
    if (await this.hasActiveTasks(workspaceID)) {
      throw new Error("workspace has a pending or running task; cancellation does not imply release")
    }
    const status = await this.git(validated.directory, ["status", "--porcelain=v1", "--untracked-files=all"])
    if (status) throw new Error("workspace is dirty; preserving it")
    const integrationTarget = manifest.integration_target_branch
      ?? (manifest.role === "child" ? manifest.primary_branch : null)
      ?? "HEAD"
    if (manifest.role === "child" && isProtectedBranch(integrationTarget, this.protectedBranches)) {
      throw new Error("child workspace cannot be released against a protected base branch; preserving it")
    }
    let integration = "ancestor"
    try {
      await this.git(manifest.repository_root, ["merge-base", "--is-ancestor", manifest.branch, integrationTarget])
    } catch {
      const cherry = await this.git(manifest.repository_root, [
        "cherry", integrationTarget, manifest.branch, manifest.base_sha,
      ])
      const commits = cherry.split("\n").map((line) => line.trim()).filter(Boolean)
      if (!commits.length || commits.some((line) => !line.startsWith("- "))) {
        throw new Error("workspace branch is not proven integrated into repository HEAD; preserving it")
      }
      integration = "patch-equivalent"
    }
    await this.git(manifest.repository_root, ["worktree", "remove", manifest.directory])
    let branchPreserved = false
    try {
      await this.git(manifest.repository_root, ["branch", "-d", manifest.branch])
    } catch (error) {
      // A child can be proven integrated into the primary branch while the
      // canonical checkout still points at the protected base. Normal branch
      // deletion evaluates the current checkout, so retain that branch rather
      // than force-deleting it or treating successful child integration as a
      // release failure.
      if (integration !== "patch-equivalent" && integrationTarget === "HEAD") {
        await writeJson(path, { ...manifest, status: "worktree_released_branch_preserved", error: error.message })
        throw new Error(`worktree was normally removed but safe branch deletion refused: ${error.message}`)
      }
      branchPreserved = true
    }
    const released = {
      ...manifest,
      status: "released",
      integration,
      branch_preserved: branchPreserved,
      released_at: this.now(),
    }
    await writeJson(path, released)
    return {
      workspace_id: workspaceID,
      status: "released",
      branch: manifest.branch,
      directory: manifest.directory,
      integration,
      branch_preserved: branchPreserved,
    }
  }
}

export { branchName, isNotGitRepositoryError, isProtectedBranch, parseWorktrees, slug }
