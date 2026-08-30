import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  PROBE_PREFIX,
  STATUS,
  VERDICTS,
  assertOwnedProbeRoot,
  chooseVerdict,
  classifyProbeEvidence,
  classifyWorkerEvidence,
  cleanupProbeFixture,
  createProbeFixture,
  inspectSentinelIsolation,
  inspectNormalTaskSource,
  inspectOpenCodeSessionApiSource,
  resolveOpenCodeSdkTypesPath,
  sentinelPayload,
} from "../../scripts/probes/worktree-isolation.mjs"

const decisiveDelegateTypes = `
export interface DelegateTaskArgs {
  description: string;
  prompt: string;
  category?: string;
}
`

const decisiveBackgroundTypes = `
export interface LaunchInput {
  description: string;
  prompt: string;
  parentSessionId: string;
}
`

const decisiveBundle = `
function createSyncSession(client, input) {
  const parentDirectory = parentSession?.data?.directory ?? input.defaultDirectory;
  return client.session.create({
    query: { directory: parentDirectory }
  });
}
// packages/omo-opencode/src/tools/delegate-task/sync-prompt-sender.ts
class BackgroundManager {
  async startTask(item) {
    const parentDirectory = parentSession?.data?.directory ?? this.directory;
    const createResult = await this.client.session.create({
      query: { directory: parentDirectory }
    });
    const sessionID = createResult.data.id;
    await input.onSessionCreated?.(sessionID);
  }
}
`

function completeWorker(label, worktree, branch) {
  return {
    expected: {
      worktree,
      branch,
      sentinelPath: join(worktree, `WORKER_${label}_SENTINEL`),
    },
    observed: {
      source: "child-tool",
      runtimeBinding: true,
      actualCwd: worktree,
      gitTopLevel: worktree,
      branch,
      sentinelPath: join(worktree, `WORKER_${label}_SENTINEL`),
      sentinelVerified: true,
      nested: {
        source: "child-tool",
        actualCwd: worktree,
        gitTopLevel: worktree,
      },
    },
  }
}

test("installed-source classifier identifies parent-directory inheritance without guessing", () => {
  assert.deepEqual(
    inspectNormalTaskSource({
      delegateTypes: decisiveDelegateTypes,
      backgroundTypes: decisiveBackgroundTypes,
      bundleSource: decisiveBundle,
    }),
    {
      delegateTaskAcceptsCwd: false,
      launchInputAcceptsCwd: false,
      syncInheritsParent: true,
      backgroundInheritsParent: true,
      status: STATUS.FAILED,
      mechanism: "normal OMO task/category children inherit the parent session directory; no caller cwd field is exposed",
    },
  )
})

test("source classifier remains UNPROVEN when a caller cwd field or required evidence appears", () => {
  const result = inspectNormalTaskSource({
    delegateTypes: decisiveDelegateTypes.replace("category?: string;", "category?: string;\n  cwd?: string;"),
    backgroundTypes: decisiveBackgroundTypes,
    bundleSource: decisiveBundle,
  })
  assert.equal(result.delegateTaskAcceptsCwd, true)
  assert.equal(result.status, STATUS.UNPROVEN)
})

test("OpenCode session-directory primitive is proven only from its installed API shape", () => {
  const present = inspectOpenCodeSessionApiSource(`
export type SessionCreateData = {
  query?: {
    directory?: string;
    workspace?: string;
  };
  url: "/session";
};
export type SessionCreateErrors = {
`)
  assert.equal(present.acceptsDirectoryQuery, true)
  assert.equal(present.status, STATUS.PROVEN)
  assert.equal(inspectOpenCodeSessionApiSource("export type SessionCreateData = {}").status, STATUS.UNPROVEN)
})

test("resolves OpenCode SDK types for installed packages and source monorepos", async () => {
  const root = await mkdtemp(join(tmpdir(), "cwd-probe-sdk-resolution-"))
  const installedOmo = join(root, "node_modules", "oh-my-openagent")
  const installedSdk = join(root, "node_modules", "@opencode-ai", "sdk", "dist", "v2", "gen", "types.gen.d.ts")
  const sourceOmo = join(root, "source")
  const sourceSdk = join(sourceOmo, "node_modules", "@opencode-ai", "sdk", "dist", "v2", "gen", "types.gen.d.ts")
  await mkdir(installedOmo, { recursive: true })
  await mkdir(join(installedSdk, ".."), { recursive: true })
  await mkdir(join(sourceSdk, ".."), { recursive: true })
  await writeFile(installedSdk, "installed")
  await writeFile(sourceSdk, "source")

  assert.equal(await resolveOpenCodeSdkTypesPath(installedOmo), installedSdk)
  assert.equal(await resolveOpenCodeSdkTypesPath(sourceOmo), sourceSdk)

  await rm(root, { recursive: true })
})

test("missing runtime evidence never becomes PROVEN", () => {
  const capabilities = classifyProbeEvidence({})
  assert.deepEqual(new Set(Object.values(capabilities)), new Set([STATUS.UNPROVEN]))
  assert.equal(chooseVerdict(capabilities), VERDICTS.UNPROVEN)
})

test("decisive missing caller API is FAILED while unexecuted downstream checks stay UNPROVEN", () => {
  const capabilities = classifyProbeEvidence({
    runtimeInspection: { normalTask: { status: STATUS.FAILED } },
  })
  assert.equal(capabilities.caller_selected_child_cwd, STATUS.FAILED)
  assert.equal(capabilities.tool_execution_cwd, STATUS.UNPROVEN)
  assert.equal(capabilities.sibling_worktree_isolation, STATUS.UNPROVEN)
  assert.equal(capabilities.nested_child_cwd_preservation, STATUS.UNPROVEN)
  assert.equal(chooseVerdict(capabilities), VERDICTS.UNAVAILABLE)
})

test("agent prose or incomplete sentinel evidence cannot prove tool cwd or confinement", () => {
  const expected = {
    worktree: "/tmp/worktree-a",
    branch: "probe-a",
    sentinelPath: "/tmp/worktree-a/WORKER_A_SENTINEL",
  }
  const prose = classifyWorkerEvidence(expected, {
    source: "assistant-prose",
    runtimeBinding: true,
    actualCwd: expected.worktree,
    gitTopLevel: expected.worktree,
    branch: expected.branch,
    sentinelPath: expected.sentinelPath,
    sentinelVerified: true,
  })
  assert.deepEqual(new Set(Object.values(prose)), new Set([STATUS.UNPROVEN]))

  const missingSentinel = classifyWorkerEvidence(expected, {
    source: "child-tool",
    runtimeBinding: true,
    actualCwd: expected.worktree,
    gitTopLevel: expected.worktree,
    branch: expected.branch,
    sentinelPath: expected.sentinelPath,
    sentinelVerified: false,
  })
  assert.equal(missingSentinel.child_actual_pwd, STATUS.PROVEN)
  assert.equal(missingSentinel.mutation_confinement, STATUS.FAILED)
})

test("complete mechanical worker and parent evidence classifies every capability PROVEN", () => {
  const workers = [
    completeWorker("A", "/tmp/probe/worktree-a", "probe-a"),
    completeWorker("B", "/tmp/probe/worktree-b", "probe-b"),
  ]
  const capabilities = classifyProbeEvidence({
    workers,
    filesystem: { siblingIsolated: true, parentUnaffected: true },
    concurrent: { attempted: true, mechanicallyOverlapped: true },
  })
  assert.deepEqual(new Set(Object.values(capabilities)), new Set([STATUS.PROVEN]))
  assert.equal(chooseVerdict(capabilities), VERDICTS.PROVEN)
})

test("nested escape produces PARTIAL_ISOLATION only after all outer critical facts are proven", () => {
  const workers = [
    completeWorker("A", "/tmp/probe/worktree-a", "probe-a"),
    completeWorker("B", "/tmp/probe/worktree-b", "probe-b"),
  ]
  workers[1].observed.nested.actualCwd = "/tmp/probe/base"
  const capabilities = classifyProbeEvidence({
    workers,
    filesystem: { siblingIsolated: true, parentUnaffected: true },
    concurrent: { attempted: true, mechanicallyOverlapped: true },
  })
  assert.equal(capabilities.nested_child_cwd_preservation, STATUS.FAILED)
  assert.equal(chooseVerdict(capabilities), VERDICTS.PARTIAL)
})

test("creates the required disposable Git topology and removes only its clean owned fixture", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "cwd-probe-test-root-"))
  const fixture = await createProbeFixture({ dataRoot })
  assert.ok(fixture.root.startsWith(join(await realpath(dataRoot), PROBE_PREFIX)))
  assert.notEqual(fixture.branchA, fixture.branchB)
  assert.equal((await assertOwnedProbeRoot(fixture.root)).marker.probeId, fixture.probeId)
  assert.equal((await cleanupProbeFixture(fixture.root)).removed, true)
  await rm(dataRoot, { recursive: true })
})

test("parent-side sentinel inspection verifies content, identity, and sibling confinement", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "cwd-probe-sentinel-test-"))
  const fixture = await createProbeFixture({ dataRoot })
  await writeFile(join(fixture.worktreeA, fixture.sentinelA), sentinelPayload(fixture, "A"))
  await writeFile(join(fixture.worktreeB, fixture.sentinelB), sentinelPayload(fixture, "B"))
  const isolated = await inspectSentinelIsolation(fixture)
  assert.equal(isolated.exercised, true)
  assert.equal(isolated.workerAValid, true)
  assert.equal(isolated.workerBValid, true)
  assert.equal(isolated.siblingIsolated, true)
  assert.equal(isolated.parentUnaffected, true)
  assert.match(isolated.sentinels.aOwn.sha256, /^[a-f0-9]{64}$/)

  await writeFile(join(fixture.worktreeA, fixture.sentinelB), sentinelPayload(fixture, "B"))
  assert.equal((await inspectSentinelIsolation(fixture)).siblingIsolated, false)

  await unlink(join(fixture.worktreeA, fixture.sentinelA))
  await unlink(join(fixture.worktreeA, fixture.sentinelB))
  await unlink(join(fixture.worktreeB, fixture.sentinelB))
  await cleanupProbeFixture(fixture.root)
  await rm(dataRoot, { recursive: true })
})

test("cleanup refuses unknown paths and mismatched provenance", async () => {
  const unknown = await mkdtemp(join(tmpdir(), "not-owned-cwd-probe-"))
  await assert.rejects(cleanupProbeFixture(unknown), /cleanup refused: path does not have the probe prefix/)
  await rm(unknown, { recursive: true })

  const dataRoot = await mkdtemp(join(tmpdir(), "cwd-probe-marker-test-"))
  const fake = await mkdtemp(join(dataRoot, PROBE_PREFIX))
  await writeFile(join(fake, ".opencode-workflow-probe-owner.json"), "{}\n")
  await assert.rejects(cleanupProbeFixture(fake), /provenance marker does not match/)
  await rm(dataRoot, { recursive: true })
})

test("cleanup preserves a dirty owned worktree instead of forcing removal", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "cwd-probe-dirty-test-"))
  const fixture = await createProbeFixture({ dataRoot })
  const dirtyPath = join(fixture.worktreeA, fixture.sentinelA)
  await writeFile(dirtyPath, "probe evidence\n")
  await assert.rejects(cleanupProbeFixture(fixture.root), /worktreeA is dirty; evidence preserved/)
  await unlink(dirtyPath)
  await cleanupProbeFixture(fixture.root)
  await rm(dataRoot, { recursive: true })
})
