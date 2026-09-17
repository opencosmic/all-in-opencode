import { acquireDelegationControlPlane } from "./delegation/control-plane.js"
import { delegationPluginHooks } from "./delegation/plugin-hooks.js"

export default async function DelegationRuntimePlugin({ client, directory, serverUrl }, options = {}) {
  const controlPlane = await acquireDelegationControlPlane({
    client,
    directory,
    serverUrl,
    stateDirectory: options.stateDirectory,
    aioConfig: options.aioConfig,
    aioConfigPath: options.aioConfigPath,
    categories: options.categories,
    agents: options.agents,
    delegation: options.delegation,
    skillRoots: options.skillRoots,
  })
  return delegationPluginHooks(controlPlane.runtime)
}
