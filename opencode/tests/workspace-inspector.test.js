import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { access, mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { inspectWorkspace, parseWorktreeList } from "../plugins/workspace-inspector/core.js"

const execFileAsync = promisify(execFile)

async function git(cwd, ...args) {
  return execFileAsync("git", args, { cwd, encoding: "utf8" })
}

async function createRepo(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  await git(directory, "init", "-q")
  await git(directory, "config", "user.email", "workspace-test@example.invalid")
  await git(directory, "config", "user.name", "Workspace Test")
  await git(directory, "commit", "--allow-empty", "-qm", "baseline")
  return directory
}

test("parses branch and detached worktree records", () => {
  const parsed = parseWorktreeList(
    "worktree /tmp/main\nHEAD abc\nbranch refs/heads/main\n\nworktree /tmp/worker\nHEAD def\ndetached\n",
  )
  assert.deepEqual(parsed, [
    { path: "/tmp/main", head: "abc", branch: "main", detached: false, locked: false, prunable: false },
    { path: "/tmp/worker", head: "def", branch: null, detached: true, locked: false, prunable: false },
  ])
})

test("detects a linked worktree and reports dirty data without mutating it", async (t) => {
  const repo = await createRepo("workspace-inspector-")
  const linked = `${repo}-linked`
  t.after(async () => rm(repo, { recursive: true, force: true }))
  t.after(async () => rm(linked, { recursive: true, force: true }))

  await git(repo, "worktree", "add", "-qb", "test-linked", linked)
  await writeFile(join(linked, "dirty.txt"), "owned disposable data\n")

  const result = await inspectWorkspace(linked)
  assert.equal(result.isGit, true)
  assert.equal(result.isLinkedWorktree, true)
  assert.equal(result.isSubmodule, false)
  assert.equal(result.branch, "test-linked")
  assert.equal(result.clean, false)
  assert.ok(result.status.some((line) => line.includes("dirty.txt")))

  const { stdout: commandRoot } = await git(linked, "rev-parse", "--show-toplevel")
  assert.equal(await realpath(commandRoot.trim()), await realpath(linked))

  await assert.rejects(git(repo, "worktree", "remove", linked), /modified or untracked files/i)
  await rm(join(linked, "dirty.txt"))
  await git(repo, "worktree", "remove", linked)
  await assert.rejects(access(linked))
})

test("reports a detached ephemeral worktree accurately", async (t) => {
  const repo = await createRepo("workspace-detached-")
  const detached = `${repo}-detached`
  t.after(async () => rm(repo, { recursive: true, force: true }))
  t.after(async () => rm(detached, { recursive: true, force: true }))

  await git(repo, "worktree", "add", "--detach", "-q", detached, "HEAD")
  const result = await inspectWorkspace(detached)
  assert.equal(result.isLinkedWorktree, true)
  assert.equal(result.detached, true)
  assert.equal(result.branch, null)
  await git(repo, "worktree", "remove", detached)
})

test("does not misclassify a submodule as linked-worktree isolation", async (t) => {
  const child = await createRepo("workspace-child-")
  const parent = await createRepo("workspace-parent-")
  t.after(async () => rm(child, { recursive: true, force: true }))
  t.after(async () => rm(parent, { recursive: true, force: true }))

  await git(parent, "-c", "protocol.file.allow=always", "submodule", "add", "-q", child, "vendor/child")
  await git(parent, "commit", "-qm", "add submodule")
  const result = await inspectWorkspace(join(parent, "vendor/child"))
  assert.equal(result.isSubmodule, true)
  assert.equal(result.isLinkedWorktree, false)
  assert.equal(result.superproject, await realpath(parent))
})

test("reports non-git directories without side effects", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-nongit-"))
  t.after(async () => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, "nested"))
  const nested = join(directory, "nested")
  assert.deepEqual(await inspectWorkspace(nested), {
    isGit: false,
    directory: await realpath(nested),
  })
})

test("classifies strategy availability from the intended worktree base", async (t) => {
  const repo = await createRepo("workspace-strategy-")
  t.after(async () => rm(repo, { recursive: true, force: true }))
  const { stdout: originalBaseOutput } = await git(repo, "rev-parse", "HEAD")
  const originalBase = originalBaseOutput.trim()
  const strategyDirectory = join(repo, ".product", "strategy")
  const strategyPath = join(strategyDirectory, "new-feature.md")
  await mkdir(strategyDirectory, { recursive: true })
  await writeFile(strategyPath, "# Approved strategy\n")
  await git(repo, "add", ".product/strategy/new-feature.md")
  await git(repo, "commit", "-qm", "add approved strategy")

  const clean = await inspectWorkspace(repo, { strategyPath: ".product/strategy/new-feature.md" })
  assert.equal(clean.strategySource.classification, "available_from_base")
  assert.equal(clean.strategySource.availableFromBase, true)

  const absentFromOlderBase = await inspectWorkspace(repo, {
    strategyPath: ".product/strategy/new-feature.md",
    baseRef: originalBase,
  })
  assert.equal(absentFromOlderBase.strategySource.classification, "untracked_or_absent_from_base")
  assert.equal(absentFromOlderBase.strategySource.availableFromBase, false)

  await writeFile(strategyPath, "# Approved strategy\n\nUncommitted decision\n")
  const modified = await inspectWorkspace(repo, { strategyPath: ".product/strategy/new-feature.md" })
  assert.equal(modified.strategySource.classification, "modified_from_base")
  assert.equal(modified.strategySource.availableFromBase, false)

  const untrackedPath = join(strategyDirectory, "untracked.md")
  await writeFile(untrackedPath, "# Untracked strategy\n")
  const untracked = await inspectWorkspace(repo, { strategyPath: ".product/strategy/untracked.md" })
  assert.equal(untracked.strategySource.classification, "untracked_or_absent_from_base")
  assert.equal(untracked.strategySource.availableFromBase, false)
})
