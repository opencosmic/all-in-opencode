import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { WorkspaceManager } from "../plugins/delegation/workspace-manager.js"

const execFileAsync = promisify(execFile)

async function git(directory, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: directory, encoding: "utf8" })
  return stdout.trim()
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "delegation-workspace-test-"))
  const repository = join(root, "repository")
  await execFileAsync("git", ["init", "-b", "main", repository])
  await git(repository, ["config", "user.name", "Delegation Test"])
  await git(repository, ["config", "user.email", "delegation@example.invalid"])
  await writeFile(join(repository, "tracked.txt"), "baseline\n")
  await git(repository, ["add", "tracked.txt"])
  await git(repository, ["commit", "-m", "baseline"])
  t.after(async () => rm(root, { recursive: true }))
  return {
    root,
    repository,
    manager: new WorkspaceManager({ stateDirectory: join(root, "state") }),
  }
}

test("prepare creates and registers an isolated linked worktree", async (t) => {
  const { repository, manager } = await fixture(t)
  const baseline = await git(repository, ["rev-parse", "HEAD"])
  const prepared = await manager.prepare({ task_id: "task-1" }, repository)
  assert.equal(prepared.base_sha, baseline)
  assert.match(prepared.workspace_id, /^ws_/)
  assert.match(prepared.branch, /^delegation\/task-1-/)
  assert.equal(await git(prepared.directory, ["branch", "--show-current"]), prepared.branch)
  assert.equal(await git(prepared.directory, ["rev-parse", "HEAD"]), baseline)
  assert.equal(await git(prepared.directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), prepared.git_common_dir)
})

test("multiple workspaces may start from the same deterministic baseline", async (t) => {
  const { repository, manager } = await fixture(t)
  const baseline = await git(repository, ["rev-parse", "HEAD"])
  const first = await manager.prepare({ task_id: "one", base_sha: baseline }, repository)
  const second = await manager.prepare({ task_id: "two", base_sha: baseline }, repository)
  assert.notEqual(first.workspace_id, second.workspace_id)
  assert.notEqual(first.directory, second.directory)
  assert.notEqual(first.branch, second.branch)
  assert.equal(first.base_sha, second.base_sha)
  assert.equal(first.git_common_dir, second.git_common_dir)
})

test("provenance validation rejects a branch mismatch", async (t) => {
  const { repository, manager } = await fixture(t)
  const prepared = await manager.prepare({ task_id: "branch-check" }, repository)
  await git(prepared.directory, ["switch", "-c", "unexpected-branch"])
  await assert.rejects(manager.get(prepared.workspace_id), /branch mismatch/)
})

test("provenance validation rejects a forged directory", async (t) => {
  const { root, repository, manager } = await fixture(t)
  const prepared = await manager.prepare({ task_id: "path-check" }, repository)
  const found = await manager.findManifest(prepared.workspace_id)
  const manifest = JSON.parse(await readFile(found.path, "utf8"))
  manifest.directory = join(root, "not-the-managed-worktree")
  await writeFile(found.path, JSON.stringify(manifest))
  await assert.rejects(manager.get(prepared.workspace_id), /ENOENT|canonical|no such file/i)
})

test("dirty release is refused and preserves the worktree", async (t) => {
  const { repository, manager } = await fixture(t)
  const prepared = await manager.prepare({ task_id: "dirty-release" }, repository)
  await writeFile(join(prepared.directory, "untracked.txt"), "preserve me\n")
  await assert.rejects(manager.release(prepared.workspace_id), /dirty; preserving/)
  assert.equal(await readFile(join(prepared.directory, "untracked.txt"), "utf8"), "preserve me\n")
})

test("clean integrated release uses only normal removal and safe branch deletion", async (t) => {
  const { repository, manager } = await fixture(t)
  const prepared = await manager.prepare({ task_id: "safe-release" }, repository)
  const released = await manager.release(prepared.workspace_id)
  assert.equal(released.status, "released")
  await assert.rejects(readFile(join(prepared.directory, "tracked.txt")), /ENOENT/)
  await assert.rejects(git(repository, ["show-ref", "--verify", `refs/heads/${prepared.branch}`]))

  const source = await readFile(new URL("../plugins/delegation/workspace-manager.js", import.meta.url), "utf8")
  assert.doesNotMatch(source, /worktree", "remove", "--force|branch", "-D|reset", "--hard|clean", "-/)
})
