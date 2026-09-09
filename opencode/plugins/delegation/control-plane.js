import { createHash, randomUUID } from "node:crypto"
import { resolve } from "node:path"

import { DelegationRuntime, defaultStateDirectory } from "./runtime.js"
import { WorkspaceManager } from "./workspace-manager.js"

const CONTROL_PLANES = Symbol.for("opencode-workflow.delegation.control-planes.v1")

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

function configurationFingerprint({ categories, categoryConfigPath, skillRoots }) {
  return createHash("sha256").update(JSON.stringify({ categories, categoryConfigPath, skillRoots })).digest("hex")
}

export async function describeControlPlane({ directory, serverUrl, stateDirectory = defaultStateDirectory() }) {
  const resolvedState = resolve(stateDirectory)
  const facts = await new WorkspaceManager({ stateDirectory: resolvedState }).repositoryFacts(directory)
  return {
    key: controlPlaneKey({ commonDir: facts.commonDir, serverUrl, stateDirectory: resolvedState }),
    server: serverIdentity(serverUrl),
    stateDirectory: resolvedState,
    registryStorePath: registryStorePath(resolvedState, facts.projectKey),
    repositoryRoot: facts.root,
    repositoryCommonDir: facts.commonDir,
    repositoryID: facts.projectKey,
  }
}

export async function acquireDelegationControlPlane({
  client,
  directory,
  serverUrl,
  stateDirectory = defaultStateDirectory(),
  categories,
  categoryConfigPath,
  skillRoots,
  now,
} = {}) {
  if (!directory) throw new Error("delegation control plane requires a plugin directory")
  const descriptor = await describeControlPlane({ directory, serverUrl, stateDirectory })
  const fingerprint = configurationFingerprint({ categories, categoryConfigPath, skillRoots })
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
        categories,
        categoryConfigPath,
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
    throw new Error("delegation category configuration differs across plugin instances for one control plane")
  }
  return controlPlane
}

export function clearDelegationControlPlanesForTest() {
  sharedControlPlanes().clear()
}

export { CONTROL_PLANES }
