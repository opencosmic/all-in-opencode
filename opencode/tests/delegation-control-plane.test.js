import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { delegationPluginHooks } from "../plugins/delegation-runtime.js"
import {
  acquireDelegationControlPlane,
  clearDelegationControlPlanesForTest,
} from "../plugins/delegation/control-plane.js"

const execFileAsync = promisify(execFile)

function fakeClient() {
  return {
    session: {
      create: async () => ({ data: { id: "unused" } }),
      promptAsync: async () => ({ data: undefined }),
      abort: async () => ({ data: true }),
      status: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
    },
  }
}

async function git(directory, args) {
  return (await execFileAsync("git", args, { cwd: directory, encoding: "utf8" })).stdout.trim()
}

async function fixture(t) {
  clearDelegationControlPlanesForTest()
  const root = await mkdtemp(join(tmpdir(), "delegation-control-plane-test-"))
  const repository = join(root, "repository")
  const sibling = join(root, "sibling")
  const stateDirectory = join(root, "state")
  await execFileAsync("git", ["init", "-b", "main", repository])
  await git(repository, ["config", "user.name", "Delegation Test"])
  await git(repository, ["config", "user.email", "delegation@example.invalid"])
  await writeFile(join(repository, "tracked.txt"), "baseline\n")
  await git(repository, ["add", "tracked.txt"])
  await git(repository, ["commit", "-m", "baseline"])
  await git(repository, ["worktree", "add", "-b", "sibling", sibling, "HEAD"])
  t.after(async () => {
    clearDelegationControlPlanesForTest()
    await rm(root, { recursive: true })
  })
  return { repository, sibling, stateDirectory }
}

test("linked-worktree plugin instances acquire one repository control plane and one registry writer", async (t) => {
  const { repository, sibling, stateDirectory } = await fixture(t)
  const input = {
    client: fakeClient(),
    serverUrl: new URL("http://127.0.0.1:40123"),
    stateDirectory,
  }
  const [canonical, child] = await Promise.all([
    acquireDelegationControlPlane({ ...input, directory: repository }),
    acquireDelegationControlPlane({ ...input, client: fakeClient(), directory: sibling }),
  ])

  assert.strictEqual(canonical, child)
  assert.strictEqual(canonical.runtime.registry, child.runtime.registry)
  assert.equal(canonical.repositoryCommonDir, await git(repository, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))

  await Promise.all(["one", "two"].map((description) => child.runtime.registry.register({
    parent_session_id: "parent",
    parent_message_id: "turn",
    parent_agent: "Executor",
    parent_directory: repository,
    execution_directory: sibling,
    agent: "Implementer",
    description,
  })))
  assert.equal(canonical.runtime.registry.list().length, 2)
  const persisted = JSON.parse(await readFile(canonical.registryStorePath, "utf8"))
  assert.equal(Object.keys(persisted.tasks).length, 2)
})

test("control planes do not cross repository-server identities", async (t) => {
  const { repository, sibling, stateDirectory } = await fixture(t)
  const first = await acquireDelegationControlPlane({
    client: fakeClient(), directory: repository, serverUrl: new URL("http://127.0.0.1:40124"), stateDirectory,
  })
  const otherServer = await acquireDelegationControlPlane({
    client: fakeClient(), directory: sibling, serverUrl: new URL("http://127.0.0.1:40125"), stateDirectory,
  })
  assert.notStrictEqual(first, otherServer)
  assert.notEqual(first.key, otherServer.key)
})

test("one control plane rejects divergent category configuration", async (t) => {
  const { repository, sibling, stateDirectory } = await fixture(t)
  const input = {
    client: fakeClient(),
    serverUrl: new URL("http://127.0.0.1:40127"),
    stateDirectory,
  }
  await acquireDelegationControlPlane({ ...input, directory: repository, categories: { one: { models: [] } } })
  await assert.rejects(
    acquireDelegationControlPlane({ ...input, directory: sibling, categories: { two: { models: [] } } }),
    /category configuration differs/,
  )
})

test("a child-directory chat.params adapter reads the shared execution profile", async (t) => {
  const { repository, sibling, stateDirectory } = await fixture(t)
  const input = { client: fakeClient(), serverUrl: new URL("http://127.0.0.1:40126"), stateDirectory }
  const canonical = await acquireDelegationControlPlane({ ...input, directory: repository })
  const child = await acquireDelegationControlPlane({ ...input, directory: sibling })
  canonical.runtime.profiles.set("child-session", { temperature: 0.1, top_p: 0.7, max_tokens: 900 })

  const output = {}
  await delegationPluginHooks(child.runtime)["chat.params"]({ sessionID: "child-session" }, output)
  assert.deepEqual(output, { temperature: 0.1, topP: 0.7, maxOutputTokens: 900 })
})
