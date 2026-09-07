import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import WorkspaceInspector from "../plugins/workspace-inspector.js"
import * as workspaceInspectorEntry from "../plugins/workspace-inspector.js"
import { workspaceDirectoryFromToolContext } from "../plugins/workspace-inspector/core.js"

const execFileAsync = promisify(execFile)

async function createRepo(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  await execFileAsync("git", ["init", "-q"], { cwd: directory })
  await execFileAsync("git", ["config", "user.email", "workspace-loader-test@example.invalid"], { cwd: directory })
  await execFileAsync("git", ["config", "user.name", "Workspace Loader Test"], { cwd: directory })
  await execFileAsync("git", ["commit", "--allow-empty", "-qm", "baseline"], { cwd: directory })
  return directory
}

test("plugin entry exposes one public default factory", () => {
  assert.deepEqual(Object.keys(workspaceInspectorEntry), ["default"])
})

test("preflight initialization accepts the exact session-independent shape without client or model activity", async () => {
  let clientRead = false
  const plugin = await WorkspaceInspector({
    directory: "/fixture",
    worktree: "/fixture",
    project: { id: "fixture", worktree: "/fixture" },
    get client() {
      clientRead = true
      throw new Error("plugin initialization must not contact a model client")
    },
  })

  assert.equal(clientRead, false)
  assert.deepEqual(Object.keys(plugin.tool), ["workspace_inspect"])
})

test("tool uses a valid explicit directory and returns the fixture Git root", async (t) => {
  const repo = await createRepo("workspace-loader-explicit-")
  t.after(() => rm(repo, { recursive: true, force: true }))
  const plugin = await WorkspaceInspector()
  const output = JSON.parse(await plugin.tool.workspace_inspect.execute({}, { directory: repo, worktree: "/wrong-worktree" }))

  assert.equal(output.isGit, true)
  assert.equal(output.directory, await realpath(repo))
  assert.equal(output.repoRoot, await realpath(repo))
})

test("tool falls back only to the supported worktree context field", async (t) => {
  const repo = await createRepo("workspace-loader-worktree-")
  t.after(() => rm(repo, { recursive: true, force: true }))
  const plugin = await WorkspaceInspector()
  const output = JSON.parse(await plugin.tool.workspace_inspect.execute({}, { worktree: repo }))

  assert.equal(output.directory, await realpath(repo))
  assert.equal(workspaceDirectoryFromToolContext({ worktree: repo }), repo)
})

test("missing or malformed context fails closed before a Node path API can receive undefined", async () => {
  const plugin = await WorkspaceInspector()
  const expected = /workspace_inspect requires a non-empty tool context directory or worktree/i

  await assert.rejects(plugin.tool.workspace_inspect.execute({}, {}), expected)
  await assert.rejects(plugin.tool.workspace_inspect.execute({}, { directory: undefined, worktree: null }), expected)
  await assert.rejects(plugin.tool.workspace_inspect.execute({}, { directory: { path: "/fixture" } }), expected)
})

test("missing context never falls back to the canonical checkout or process cwd", () => {
  assert.throws(() => workspaceDirectoryFromToolContext({}), /refusing to infer a filesystem path/i)
})
