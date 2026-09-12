import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

export const PROJECT_DATA_ROOT_ENV = "AIO_DATA_ROOT"
export const LEGACY_PROJECT_DATA_ROOT_ENV = "OPENCODE_WORKFLOW_DATA_ROOT"
export const PROJECT_DATA_DIRECTORY = "all-in-opencode"
export const LEGACY_PROJECT_DATA_DIRECTORY = "opencode-workflow"

export function resolveProjectDataRoot({ env = process.env, home = homedir() } = {}) {
  const configuredRoot = env[PROJECT_DATA_ROOT_ENV] || env[LEGACY_PROJECT_DATA_ROOT_ENV]
  if (configuredRoot) return resolve(configuredRoot)

  const dataHome = env.XDG_DATA_HOME || join(home, ".local", "share")
  const currentRoot = resolve(dataHome, PROJECT_DATA_DIRECTORY)
  const legacyRoot = resolve(dataHome, LEGACY_PROJECT_DATA_DIRECTORY)

  // Keep existing installations discoverable without making new installations
  // depend on the legacy product name.
  if (existsSync(legacyRoot) && !existsSync(currentRoot)) return legacyRoot
  return currentRoot
}
