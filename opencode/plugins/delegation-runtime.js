import { acquireDelegationControlPlane } from "./delegation/control-plane.js"
import { delegationPluginHooks } from "./delegation/plugin-hooks.js"

export default async function DelegationRuntimePlugin({ client, directory, serverUrl }, options = {}) {
  const controlPlane = await acquireDelegationControlPlane({
    client,
    directory,
    serverUrl,
    stateDirectory: options.stateDirectory,
    categories: options.categories,
  })
  return delegationPluginHooks(controlPlane.runtime)
}
