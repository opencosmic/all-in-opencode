import { createHash, randomUUID } from "node:crypto"
import { realpath } from "node:fs/promises"
import { resolve } from "node:path"

import { loadAioConfig, normalizeAioConfig } from "./aio-config.js"
import { DelegationRuntime, defaultStateDirectory } from "./runtime.js"
import { isNotGitRepositoryError, WorkspaceManager } from "./workspace-manager.js"

const CONTROL_PLANES = Symbol.for("aio.delegation.control-planes.v1")

function sharedControlPlanes() {
  if (!globalThis[CONTROL_PLANES]) {
    Object.defineProperty(globalThis, CONTROL_PLANES, {
      value: new Map(),
      configurable: false,
      enumerable: false,
      writable: false,
    })
  }
  return globalThis[CONTROL_PLANES]
}

function serverIdentity(serverUrl) {
  if (!serverUrl) return "in-process"
  return new URL(serverUrl).toString().replace(/\/$/, "")
}

function controlPlaneKey({ commonDir, serverUrl, stateDirectory }) {
  return JSON.stringify({
    server: serverIdentity(serverUrl),
    repository: commonDir,
    state: resolve(stateDirectory),
  })
}

function registryStorePath(stateDirectory, projectKey) {
  return resolve(stateDirectory, "tasks", projectKey, "tasks.json")
}

function configurationFingerprint({ aioConfig, skillRoots }) {
  return createHash("sha256").update(JSON.stringify({ aioConfig, skillRoots })).digest("hex")
}

async function controlPlaneFacts(directory, stateDirectory) {
  const workspaces = new WorkspaceManager({ stateDirectory })
  try {
    const facts = await workspaces.repositoryFacts(directory)
    return { ...facts, identity: facts.commonDir, isGitRepository: true }
  } catch (error) {
    if (!isNotGitRepositoryError(error)) throw error
    const canonicalDirectory = await realpath(directory)
    return {
      root: null,
      commonDir: null,
      projectKey: createHash("sha256").update(`directory:${canonicalDirectory}`).digest("hex").slice(0, 20),
      identity: `directory:${canonicalDirectory}`,
      isGitRepository: false,
    }
  }
}

export async function describeControlPlane({ directory, serverUrl, stateDirectory = defaultStateDirectory() }) {
  const resolvedState = resolve(stateDirectory)
  const facts = await controlPlaneFacts(directory, resolvedState)
  return {
    key: controlPlaneKey({ commonDir: facts.identity, serverUrl, stateDirectory: resolvedState }),
    server: serverIdentity(serverUrl),
    stateDirectory: resolvedState,
    registryStorePath: registryStorePath(resolvedState, facts.projectKey),
    repositoryRoot: facts.root,
    repositoryCommonDir: facts.commonDir,
    repositoryID: facts.projectKey,
    isGitRepository: facts.isGitRepository,
  }
}

export async function acquireDelegationControlPlane({
  client,
  directory,
  serverUrl,
  stateDirectory = defaultStateDirectory(),
  aioConfig,
  aioConfigPath,
  categories,
  agents,
  delegation,
  skillRoots,
  now,
} = {}) {
  if (!directory) throw new Error("delegation control plane requires a plugin directory")
  const descriptor = await describeControlPlane({ directory, serverUrl, stateDirectory })
  const config = aioConfig !== undefined
    ? normalizeAioConfig(aioConfig, { configPath: aioConfigPath })
    : categories !== undefined || agents !== undefined || delegation !== undefined
      ? normalizeAioConfig({ version: 1, categories: categories ?? {}, agents: agents ?? {}, delegation: delegation ?? {} }, { configPath: "<injected>" })
      : loadAioConfig({ configPath: aioConfigPath })
  const fingerprint = configurationFingerprint({ aioConfig: config, skillRoots })
  const planes = sharedControlPlanes()
  let pending = planes.get(descriptor.key)
  if (!pending) {
    pending = (async () => ({
      ...descriptor,
      id: `control_${randomUUID()}`,
      configurationFingerprint: fingerprint,
      runtime: await DelegationRuntime.create({
        client,
        stateDirectory: descriptor.stateDirectory,
        registryStorePath: descriptor.registryStorePath,
        aioConfig: config,
        availableAgents: undefined,
        directory,
        skillRoots,
        now,
      }),
    }))()
    planes.set(descriptor.key, pending)
    pending.catch(() => {
      if (planes.get(descriptor.key) === pending) planes.delete(descriptor.key)
    })
  }
  const controlPlane = await pending
  if (controlPlane.configurationFingerprint !== fingerprint) {
    throw new Error("delegation AIO configuration differs across plugin instances for one control plane")
  }
  return controlPlane
}

export function clearDelegationControlPlanesForTest() {
  sharedControlPlanes().clear()
}

export { CONTROL_PLANES }
