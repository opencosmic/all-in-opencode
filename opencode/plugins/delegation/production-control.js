import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, mkdir, readdir, realpath, stat } from "node:fs/promises"
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path"

import {
  createProductionManifest,
  normalizeProductionManifest,
  transitionProductionManifest,
  validateCanonicalProductionPath,
  validateProductionManifest,
} from "../film-production/contracts.js"
import { readJson } from "./json-store.js"
import { createProductionManifestIfMissing, updateProductionManifest } from "./production-manifest-store.js"

export const PRODUCTION_ROOT = "production"
export const PRODUCTION_MANIFEST_PATH = "production/production-manifest.json"
const MAX_ARTIFACTS = 64
const CHECKPOINT_INPUT_FIELDS = new Set([
  "current_focus", "completed", "remaining", "verification", "important_artifacts",
])
const TRANSITION_INPUT_FIELDS = new Set(["to_status", "note"])
const GENERATION_APPROVAL_INPUT_FIELDS = new Set(["job_id", "request_digest", "approved_max_usd"])
const OUTPUT_INPUT_FIELDS = new Set(["slot", "canonical_path"])
const FINAL_RENDER_APPROVAL_INPUT_FIELDS = new Set(["final_path", "project_path"])
const OUTPUT_SLOTS = new Set(["rough_cut", "final"])
const FINAL_RENDER_APPROVAL_FIELD = "final_render_approval_digest"
const FINAL_RENDER_PROJECT_PATH_FIELD = "final_render_project_path"

async function existing(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

function inside(root, path) {
  const offset = relative(root, path)
  return offset === "" || (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
}

async function workspaceRoot(directory) {
  if (typeof directory !== "string" || !directory.trim()) throw new Error("production tools require an active project directory")
  const root = await realpath(directory)
  if (!(await stat(root)).isDirectory()) throw new Error("active project directory is not a directory")
  return root
}

async function productionRoot(workspace, { create = false } = {}) {
  const path = join(workspace, PRODUCTION_ROOT)
  let info = await existing(path)
  if (!info && create) {
    try {
      await mkdir(path)
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
    }
    info = await existing(path)
  }
  if (!info) return null
  if (info.isSymbolicLink()) throw new Error("production root must not be a symlink")
  if (!info.isDirectory()) throw new Error("production root must be a directory")
  const physical = await realpath(path)
  if (!inside(workspace, physical)) throw new Error("production root escapes the active workspace")
  return physical
}

async function canonicalManifest(production, { required = false } = {}) {
  if (!production) {
    if (required) throw new Error("canonical production manifest is missing; run production_preflight first")
    return null
  }
  const path = join(production, "production-manifest.json")
  const info = await existing(path)
  if (!info) {
    if (required) throw new Error("canonical production manifest is missing; run production_preflight first")
    return null
  }
  if (info.isSymbolicLink()) throw new Error("canonical production manifest must not be a symlink")
  if (!info.isFile()) throw new Error("canonical production manifest must be a regular file")
  const manifest = await readJson(path)
  validateProductionManifest(manifest)
  return { path, manifest }
}

function newManifest(projectID) {
  if (typeof projectID !== "string" || !projectID.trim()) {
    throw new Error("production_preflight requires project_id when the canonical manifest is missing")
  }
  const timestamp = new Date().toISOString()
  return createProductionManifest({ project: projectID, created_at: timestamp, updated_at: timestamp })
}

export async function productionPreflight({ project_id: projectID } = {}, directory) {
  const workspace = await workspaceRoot(directory)
  let production = await productionRoot(workspace)
  let current = await canonicalManifest(production)
  let created = false
  if (!current) {
    const manifest = newManifest(projectID)
    production ??= await productionRoot(workspace, { create: true })
    const path = join(production, "production-manifest.json")
    const initialized = await createProductionManifestIfMissing(path, manifest)
    current = { path, manifest: initialized.manifest }
    created = initialized.created
  }
  if (projectID !== undefined && projectID !== current.manifest.project.id) {
    throw new Error(`project_id ${projectID} does not match canonical production ${current.manifest.project.id}`)
  }
  const normalized = normalizeProductionManifest(current.manifest)
  return {
    created,
    project_id: normalized.project.id,
    project_status: normalized.project.status,
    manifest_revision: normalized.revision,
    workspace_root: workspace,
    production_root: production,
    manifest: { canonical_path: PRODUCTION_MANIFEST_PATH, runtime_path: current.path },
    latest_checkpoint: normalized.latest_checkpoint,
    checkpoint_stale: Boolean(normalized.latest_checkpoint && normalized.latest_checkpoint.phase !== normalized.project.status),
  }
}

async function requiredProduction(directory) {
  const workspace = await workspaceRoot(directory)
  const production = await productionRoot(workspace)
  const current = await canonicalManifest(production, { required: true })
  return { workspace, production, ...current }
}

async function requiredProductionFile(workspace, canonicalPath, { allowMissing = false } = {}) {
  validateCanonicalProductionPath(canonicalPath, "canonical_path")
  if (canonicalPath === PRODUCTION_MANIFEST_PATH) {
    throw new Error("the canonical production manifest cannot be used as an output")
  }
  const production = await productionRoot(workspace)
  if (!production) throw new Error("canonical production root is missing")

  const parts = canonicalPath.split("/")
  let parent = production
  for (const part of parts.slice(1, -1)) {
    const candidate = join(parent, part)
    const info = await existing(candidate)
    if (!info) throw new Error(`canonical production file parent is missing: ${candidate}`)
    if (info.isSymbolicLink()) throw new Error(`canonical production file parent must not be a symlink: ${candidate}`)
    if (!info.isDirectory()) throw new Error(`canonical production file parent must be a directory: ${candidate}`)
    parent = await realpath(candidate)
    if (!inside(workspace, parent)) throw new Error(`canonical production file escapes the active workspace: ${canonicalPath}`)
  }

  const runtimePath = join(parent, parts.at(-1))
  const info = await existing(runtimePath)
  if (!info) {
    if (allowMissing) return { canonical_path: canonicalPath, runtime_path: runtimePath, exists: false }
    throw new Error(`canonical production file does not exist: ${canonicalPath}`)
  }
  if (info.isSymbolicLink()) throw new Error(`canonical production file must not be a symlink: ${canonicalPath}`)
  if (!info.isFile()) throw new Error(`canonical production output must be a regular file: ${canonicalPath}`)
  if (info.size <= 0) throw new Error(`canonical production output must not be empty: ${canonicalPath}`)

  const physicalPath = await realpath(runtimePath)
  if (!inside(workspace, physicalPath)) throw new Error(`canonical production file escapes the active workspace: ${canonicalPath}`)
  const manifestPath = join(production, "production-manifest.json")
  const manifestInfo = await stat(manifestPath)
  const fileInfo = await stat(runtimePath)
  if (manifestInfo.dev === fileInfo.dev && manifestInfo.ino === fileInfo.ino) {
    throw new Error(`canonical production file aliases the protected ProductionManifest: ${canonicalPath}`)
  }
  return { canonical_path: canonicalPath, runtime_path: runtimePath, exists: true, size_bytes: fileInfo.size }
}

async function sha256File(path) {
  const digest = createHash("sha256")
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest("hex")
}

function artifactPath(artifact, label) {
  const path = typeof artifact === "string" ? artifact : artifact?.path
  if (typeof path !== "string") throw new Error(`${label} must identify a local canonical production path`)
  validateCanonicalProductionPath(path, label)
  return path
}

function approvalDigest({ projectID, roughCutPath, roughCutDigest, projectPath, finalPath }) {
  return createHash("sha256").update(JSON.stringify({
    project_id: projectID,
    rough_cut_path: roughCutPath,
    rough_cut_sha256: roughCutDigest,
    project_path: projectPath,
    final_path: finalPath,
  })).digest("hex")
}

async function verifiedOutput(workspace, manifest, slot) {
  const record = manifest.outputs?.[slot]
  if (!record) throw new Error(`ProductionManifest has no registered ${slot} output`)
  const canonicalPath = artifactPath(record, `outputs.${slot}`)
  const file = await requiredProductionFile(workspace, canonicalPath)
  const sha256 = await sha256File(file.runtime_path)
  if (record.sha256 !== undefined && record.sha256 !== sha256) {
    throw new Error(`registered ${slot} output has changed since it was recorded`)
  }
  if (record.size_bytes !== undefined && record.size_bytes !== file.size_bytes) {
    throw new Error(`registered ${slot} output size has changed since it was recorded`)
  }
  return { canonical_path: canonicalPath, runtime_path: file.runtime_path, sha256, size_bytes: file.size_bytes }
}

async function requiredProductionDirectory(workspace, canonicalPath) {
  validateCanonicalProductionPath(canonicalPath, "project_path")
  const production = await productionRoot(workspace)
  if (!production) throw new Error("canonical production root is missing")
  const parts = canonicalPath.split("/")
  let parent = production
  for (const part of parts.slice(1, -1)) {
    const candidate = join(parent, part)
    const info = await existing(candidate)
    if (!info) throw new Error(`canonical production project parent is missing: ${candidate}`)
    if (info.isSymbolicLink()) throw new Error(`canonical production project parent must not be a symlink: ${candidate}`)
    if (!info.isDirectory()) throw new Error(`canonical production project parent must be a directory: ${candidate}`)
    parent = await realpath(candidate)
    if (!inside(workspace, parent)) throw new Error(`canonical production project escapes the active workspace: ${canonicalPath}`)
  }
  const runtimePath = join(parent, parts.at(-1))
  const info = await existing(runtimePath)
  if (!info) throw new Error(`canonical production project does not exist: ${canonicalPath}`)
  if (info.isSymbolicLink()) throw new Error(`canonical production project must not be a symlink: ${canonicalPath}`)
  if (!info.isDirectory()) throw new Error(`canonical production project must be a directory: ${canonicalPath}`)
  const physicalPath = await realpath(runtimePath)
  if (!inside(workspace, physicalPath)) throw new Error(`canonical production project escapes the active workspace: ${canonicalPath}`)
  if (!await safeCompositionTree(workspace, physicalPath)) {
    throw new Error("HyperFrames project must not contain symlinks or aliases to the canonical ProductionManifest")
  }
  return { canonical_path: canonicalPath, runtime_path: runtimePath }
}

async function safeCompositionTree(workspace, directory) {
  const manifest = await stat(join(workspace, PRODUCTION_MANIFEST_PATH))
  async function visit(folder) {
    for (const entry of await readdir(folder)) {
      if (entry === ".git" || entry.startsWith(".env")) return false
      const target = join(folder, entry)
      const info = await lstat(target)
      if (info.isSymbolicLink()) return false
      if (info.isDirectory()) {
        if (!await visit(target)) return false
      } else if (!info.isFile() || info.nlink !== 1 || (info.dev === manifest.dev && info.ino === manifest.ino)) return false
    }
    return true
  }
  return visit(directory)
}

function validateEditorVideoProjectPath(value) {
  if (typeof value !== "string" || !/^videos\/[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{10}$/.test(value)) {
    throw new Error("Editor video project must be a runtime-issued videos/<slug>-<digest> path")
  }
  return value
}

async function safeVideoProjectTree(directory) {
  async function visit(folder) {
    for (const entry of await readdir(folder)) {
      if (entry === ".git" || entry === "node_modules" || entry.startsWith(".env")) return false
      const target = join(folder, entry)
      const info = await lstat(target)
      if (info.isSymbolicLink()) return false
      if (info.isDirectory()) {
        if (!await visit(target)) return false
      } else if (!info.isFile() || info.nlink !== 1) return false
    }
    return true
  }
  return visit(directory)
}

async function editorVideoProjectRoot(directory, videoProjectPath) {
  const workspace = await workspaceRoot(directory)
  validateEditorVideoProjectPath(videoProjectPath)
  const videos = join(workspace, "videos")
  const project = join(workspace, videoProjectPath)
  const videosInfo = await existing(videos)
  if (!videosInfo || videosInfo.isSymbolicLink() || !videosInfo.isDirectory()) return null
  const videosPhysical = await realpath(videos)
  if (videosPhysical !== videos || !inside(workspace, videosPhysical)) return null
  const projectInfo = await existing(project)
  if (!projectInfo || projectInfo.isSymbolicLink() || !projectInfo.isDirectory()) return null
  const projectPhysical = await realpath(project)
  if (projectPhysical !== project || !inside(videosPhysical, projectPhysical)) return null
  if (!await safeVideoProjectTree(projectPhysical)) return null
  return { workspace, videos: videosPhysical, project: projectPhysical }
}

/** Create only the runtime-derived lightweight project directory under the active workspace. */
export async function prepareEditorVideoProject(directory, videoProjectPath) {
  const workspace = await workspaceRoot(directory)
  validateEditorVideoProjectPath(videoProjectPath)
  const videos = join(workspace, "videos")
  let videosInfo = await existing(videos)
  if (!videosInfo) {
    try {
      await mkdir(videos)
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
    }
    videosInfo = await existing(videos)
  }
  if (!videosInfo || videosInfo.isSymbolicLink() || !videosInfo.isDirectory()) {
    throw new Error("lightweight video root must be a real directory under the active workspace")
  }
  const videosPhysical = await realpath(videos)
  if (videosPhysical !== videos || !inside(workspace, videosPhysical)) {
    throw new Error("lightweight video root escapes the active workspace")
  }
  const project = join(workspace, videoProjectPath)
  let projectInfo = await existing(project)
  if (!projectInfo) {
    try {
      await mkdir(project)
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
    }
    projectInfo = await existing(project)
  }
  if (!projectInfo || projectInfo.isSymbolicLink() || !projectInfo.isDirectory()) {
    throw new Error("lightweight video project must be a real directory under videos/")
  }
  if (await realpath(project) !== project || !inside(videosPhysical, await realpath(project))) {
    throw new Error("lightweight video project escapes the active workspace")
  }
  if (!await safeVideoProjectTree(project)) {
    throw new Error("lightweight video project contains protected, linked, or unsafe files")
  }
  return { workspace_root: workspace, project_root: project, project_path: videoProjectPath }
}

function videoTargetPath(target, videoProjectPath, { allowProjectRoot = false } = {}) {
  validateEditorVideoProjectPath(videoProjectPath)
  if (typeof target !== "string" || !target.trim() || target.includes("\\") || target.includes("~")
    || /[\u0000-\u001f\u007f:]/.test(target) || target.split("/").some((part) => part === ".." || part === ".env*" || part === ".git" || part === "node_modules" || part.startsWith(".env"))) return null
  const canonical = target.replace(/^\.\//, "")
  if (canonical === videoProjectPath) return allowProjectRoot ? canonical : null
  if (!canonical.startsWith(`${videoProjectPath}/`)) return null
  const parts = canonical.split("/")
  if (parts.some((part) => !part || part === ".")) return null
  return canonical
}

async function editorVideoTargetAllows(target, directory, videoProjectPath, { allowMissing = true } = {}) {
  try {
    const roots = await editorVideoProjectRoot(directory, videoProjectPath)
    if (!roots) return false
    let scoped
    if (isAbsolute(target)) {
      if (target.split(sep).includes("..")) return false
      const physicalTarget = resolve(target)
      if (!inside(roots.project, physicalTarget) || physicalTarget === roots.project) return false
      scoped = relative(roots.workspace, physicalTarget).split(sep).join("/")
    } else {
      scoped = videoTargetPath(target, videoProjectPath)
      if (!scoped) return false
    }
    const candidate = join(roots.workspace, scoped)
    let cursor = roots.workspace
    let missingAncestor = false
    const parts = relative(roots.workspace, candidate).split(sep)
    for (const [index, part] of parts.entries()) {
      cursor = join(cursor, part)
      if (missingAncestor) continue
      const info = await existing(cursor)
      if (!info) {
        if (!allowMissing) return false
        missingAncestor = true
        continue
      }
      if (info.isSymbolicLink()) return false
      const isTarget = index === parts.length - 1
      if (!isTarget && !info.isDirectory()) return false
      if (isTarget && (!info.isFile() || info.nlink !== 1)) return false
      if (index >= 1 && !inside(roots.project, await realpath(cursor))) return false
    }
    return true
  } catch {
    return false
  }
}

/** Editor's lightweight /video write scope; separate from the M5 manifest-gated composition scope. */
export async function editorVideoProjectMutationAllows(target, directory, videoProjectPath) {
  return await editorVideoTargetAllows(target, directory, videoProjectPath)
}

export async function isLightweightVideoProjectTarget(target, directory) {
  if (typeof target !== "string" || !target.trim()) return false
  try {
    const workspace = await workspaceRoot(directory)
    const root = join(workspace, "videos")
    const candidate = isAbsolute(target) ? resolve(target) : resolve(workspace, target)
    return candidate !== root && inside(root, candidate)
  } catch {
    return false
  }
}

export async function editorVideoHyperFramesPathAllows(target, directory, videoProjectPath) {
  try {
    const roots = await editorVideoProjectRoot(directory, videoProjectPath)
    if (!roots) return false
    const scoped = videoTargetPath(target, videoProjectPath, { allowProjectRoot: true })
    if (!scoped) return false
    if (scoped === videoProjectPath) return true
    return await editorVideoTargetAllows(scoped, directory, videoProjectPath)
  } catch {
    return false
  }
}

export async function editorVideoHyperFramesRenderAllows(command, directory, videoProjectPath) {
  const options = hyperFramesRenderOptions(command, { videoProjectPath })
  if (!options || options.invalid || options.project_path !== videoProjectPath || !options.output.endsWith(".mp4")) return false
  if (options.fps !== undefined && Number(options.fps) > 60) return false
  if (options.workers !== undefined && Number(options.workers) > 2) return false
  return await editorVideoTargetAllows(options.output, directory, videoProjectPath)
}

export async function editorVideoFfprobeAllows(command, directory, videoProjectPath) {
  const words = shellWords(command?.trim())
  if (!words || words.length !== 2 || words[0] !== "ffprobe") return false
  return await editorVideoTargetAllows(words[1], directory, videoProjectPath, { allowMissing: false })
}

export async function editorVideoAssetCopyAllows(command, directory, videoProjectPath) {
  const words = shellWords(command?.trim())
  if (!words || words.length !== 4 || words[0] !== "cp" || words[1] !== "--") return false
  const [, , source, destination] = words
  try {
    const roots = await editorVideoProjectRoot(directory, videoProjectPath)
    if (!roots || source.split("/").some((part) => !part || part === "." || part === ".." || part === ".git" || part === "node_modules" || part.startsWith(".env"))) return false
    if (!/\.(?:png|jpe?g|webp|gif|svg|mp4|mov|webm|mp3|wav|m4a|ogg)$/i.test(source)) return false
    const sourcePath = join(roots.workspace, source)
    const sourceInfo = await existing(sourcePath)
    if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.nlink !== 1) return false
    const destinationPath = videoTargetPath(destination, videoProjectPath)
    if (!destinationPath || !destinationPath.startsWith(`${videoProjectPath}/assets/`)) return false
    if (!await editorVideoTargetAllows(destinationPath, directory, videoProjectPath)) return false
    const destinationInfo = await existing(join(roots.workspace, destinationPath))
    if (destinationInfo) {
      const [from, to] = await Promise.all([stat(sourcePath), stat(join(roots.workspace, destinationPath))])
      if (to.nlink !== 1 || (from.dev === to.dev && from.ino === to.ino)) return false
    }
    return true
  } catch {
    return false
  }
}

function visualAsset(asset) {
  return typeof asset?.kind === "string" && ["video", "image"].includes(asset.kind.toLowerCase())
}

async function requireCompositionAssets(workspace, manifest) {
  if (!manifest.shots.length) throw new Error("composition requires at least one canonical ShotSpec")
  const visuals = manifest.assets.filter(visualAsset).filter((asset) => ["ready", "used"].includes(asset.status))
  for (const shot of manifest.shots) {
    const selected = visuals.filter((asset) => asset.shot_ids?.includes(shot.shot_id))
    if (!selected.length) throw new Error(`composition requires a ready local visual asset for shot ${shot.shot_id}`)
    for (const asset of selected) {
      if (typeof asset.path !== "string") {
        throw new Error(`video asset ${asset.asset_id} for shot ${shot.shot_id} has no local workspace path`)
      }
      await requiredProductionFile(workspace, asset.path)
    }
  }
}

export async function isCanonicalManifestMutationTarget(target, directory) {
  if (typeof target !== "string" || !target.trim() || typeof directory !== "string" || !directory.trim()) return false
  const workspace = await workspaceRoot(directory)
  const manifestPath = join(workspace, PRODUCTION_MANIFEST_PATH)
  const candidate = isAbsolute(target) ? target : join(workspace, target)
  if (candidate === manifestPath) return true
  const production = await productionRoot(workspace)
  if (!production) return false
  const manifestInfo = await existing(manifestPath)
  if (!manifestInfo || manifestInfo.isSymbolicLink() || !manifestInfo.isFile()) return false
  const canonicalPath = await realpath(manifestPath)

  let cursor = candidate
  const suffix = []
  while (true) {
    try {
      const info = await lstat(cursor)
      if (info.isSymbolicLink()) {
        const physical = await realpath(cursor)
        const resolved = join(physical, ...suffix)
        if (resolved === canonicalPath) return true
      }
      break
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
      const parent = join(cursor, "..")
      if (parent === cursor) return false
      suffix.unshift(cursor.slice(parent.length + 1))
      cursor = parent
    }
  }

  try {
    const physical = await realpath(cursor)
    const resolved = join(physical, ...suffix)
    if (resolved === canonicalPath) return true
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
    return false
  }

  try {
    const candidateInfo = await stat(candidate)
    const canonicalInfo = await stat(manifestPath)
    return candidateInfo.dev === canonicalInfo.dev && candidateInfo.ino === canonicalInfo.ino
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false
    throw error
  }
}

/** Editor's direct filesystem mutation authority is limited to the active composition tree. */
export async function editorCompositionMutationAllows(target, directory) {
  if (typeof target !== "string" || !target.trim() || typeof directory !== "string" || !directory.trim()) return false
  try {
    const { workspace, manifest } = await requiredProduction(directory)
    if (manifest.project.status !== "composition") return false
    let canonicalPath = target
    if (isAbsolute(target)) {
      if (target.split(sep).includes("..")) return false
      const absoluteTarget = resolve(target)
      if (!inside(workspace, absoluteTarget)) return false
      canonicalPath = relative(workspace, absoluteTarget).split(sep).join("/")
    }
    validateCanonicalProductionPath(canonicalPath, "editor_mutation_path")
    if (canonicalPath.split("/").some((part) => part === ".git" || part.startsWith(".env"))) return false
    const compositionRoot = join(workspace, "production/composition")
    const targetPath = join(workspace, canonicalPath)
    if (!inside(compositionRoot, targetPath) || targetPath === compositionRoot) return false
    if (!await productionRoot(workspace)) return false

    const relativePath = relative(workspace, targetPath)
    let cursor = workspace
    let missingAncestor = false
    const parts = relativePath.split(sep)
    for (const [index, part] of parts.entries()) {
      cursor = join(cursor, part)
      if (missingAncestor) continue
      const info = await existing(cursor)
      if (!info) {
        missingAncestor = true
        continue
      }
      if (info.isSymbolicLink()) return false
      const isTarget = index === parts.length - 1
      if (!isTarget && !info.isDirectory()) return false
      if (isTarget && (!info.isFile() || info.nlink !== 1)) return false
      const physicalPath = await realpath(cursor)
      if (index >= 1 && !inside(compositionRoot, physicalPath)) return false
    }
    return true
  } catch {
    return false
  }
}

export async function finalRenderApprovalAllows(finalPath, projectPath, directory) {
  if (typeof finalPath !== "string" || !finalPath.trim() || isAbsolute(finalPath)
    || typeof projectPath !== "string" || !projectPath.trim() || isAbsolute(projectPath)) return false
  let canonicalPath
  let canonicalProjectPath
  try {
    canonicalPath = validateCanonicalProductionPath(finalPath, "final_path")
    canonicalProjectPath = validateCanonicalProductionPath(projectPath, "project_path")
    const { workspace, manifest } = await requiredProduction(directory)
    if (manifest.project.status !== "composition" || manifest.latest_checkpoint?.phase !== "composition") return false
    const roughCut = await verifiedOutput(workspace, manifest, "rough_cut")
    const destination = await requiredProductionFile(workspace, canonicalPath, { allowMissing: true })
    const composition = await requiredProductionDirectory(workspace, canonicalProjectPath)
    if (canonicalPath === roughCut.canonical_path) return false
    if (inside(composition.runtime_path, destination.runtime_path)) return false
    if (destination.exists) {
      const [destinationInfo, roughCutInfo] = await Promise.all([stat(destination.runtime_path), stat(roughCut.runtime_path)])
      if (destinationInfo.nlink !== 1) return false
      if (destinationInfo.dev === roughCutInfo.dev && destinationInfo.ino === roughCutInfo.ino) return false
    }
    const expected = approvalDigest({
      projectID: manifest.project.id,
      roughCutPath: roughCut.canonical_path,
      roughCutDigest: roughCut.sha256,
      projectPath: canonicalProjectPath,
      finalPath: canonicalPath,
    })
    return manifest.latest_checkpoint.verification?.[FINAL_RENDER_APPROVAL_FIELD] === expected
      && manifest.latest_checkpoint.verification?.[FINAL_RENDER_PROJECT_PATH_FIELD] === canonicalProjectPath
  } catch {
    return false
  }
}

function shellWords(command) {
  if (typeof command !== "string" || /[;&|<>`$*?\[\]{}()!\r\n]/.test(command)) return null
  const words = []
  let word = ""
  let quote = ""
  let escaped = false
  let active = false
  for (const character of command) {
    if (escaped) {
      word += character
      escaped = false
      active = true
    } else if (character === "\\" && quote !== "'") {
      escaped = true
      active = true
    } else if (quote) {
      if (character === quote) quote = ""
      else word += character
      active = true
    } else if (character === "'" || character === '"') {
      quote = character
      active = true
    } else if (/\s/.test(character)) {
      if (active) words.push(word)
      word = ""
      active = false
    } else {
      word += character
      active = true
    }
  }
  if (escaped || quote) return null
  if (active) words.push(word)
  return words
}

function parsedHyperFramesCommand(command) {
  const prefix = /^(?:HYPERFRAMES_SKIP_SKILLS=1\s+)?(?:npx\s+hyperframes|hyperframes)(?:\s|$)/
  if (typeof command !== "string" || !prefix.test(command.trim())) return null
  const words = shellWords(command.trim())
  if (!words) return { matched: true, invalid: true, words: [] }
  let index = 0
  if (words[index] === "HYPERFRAMES_SKIP_SKILLS=1") index += 1
  if (words[index] === "npx") index += 1
  if (words[index] !== "hyperframes") return { matched: true, invalid: true, words }
  index += 1
  if (!words[index]) return { matched: true, invalid: true, words }
  return { matched: true, invalid: false, subcommand: words[index], words, commandIndex: index }
}

export function hyperFramesCommandPathTargets(command, { videoProjectPath } = {}) {
  const parsed = parsedHyperFramesCommand(command)
  if (!parsed) return null
  if (parsed.invalid) return { invalid: true, subcommand: null, paths: [] }
  const paths = []
  const args = parsed.words.slice(parsed.commandIndex + 1)
  const pathOptions = new Set(["-o", "--output", "--dir", "--project", "--against", "--composition"])
  for (const [index, word] of args.entries()) {
    const candidate = word.includes("=") && word.startsWith("-") ? word.slice(word.indexOf("=") + 1) : word
    const option = word.includes("=") ? word.slice(0, word.indexOf("=")) : null
    if (candidate && (pathOptions.has(args[index - 1]) || pathOptions.has(option)
      || candidate === "." || candidate === ".." || /\.[a-z][a-z0-9]*$/i.test(candidate)
      || candidate.includes("/") || candidate.includes("\\") || isAbsolute(candidate))) paths.push(candidate)
  }
  const projectCommands = new Set(["check", "lint", "snapshot", "preview", "info", "compositions", "init"])
  if (projectCommands.has(parsed.subcommand)) {
    if (videoProjectPath) {
      if (!videoTargetPath(args[0], videoProjectPath, { allowProjectRoot: true })
        || args[0] !== videoProjectPath) return { ...parsed, invalid: true, paths }
    } else {
      try {
        validateCanonicalProductionPath(args[0], "project_path")
      } catch {
        return { ...parsed, invalid: true, paths }
      }
    }
  }
  if (parsed.subcommand === "add") {
    const directories = args.flatMap((word, index) => word === "--dir" ? [args[index + 1]] : word.startsWith("--dir=") ? [word.slice(6)] : [])
    const allowedDirectory = (target) => videoProjectPath
      ? target === videoProjectPath
      : typeof target === "string" && target.startsWith("production/")
    if (directories.length !== 1 || typeof directories[0] !== "string" || !allowedDirectory(directories[0])) {
      return { ...parsed, invalid: true, paths }
    }
  }
  return { ...parsed, paths }
}

function hyperFramesRenderOptions(command, { videoProjectPath } = {}) {
  const parsed = parsedHyperFramesCommand(command)
  if (!parsed || parsed.subcommand !== "render") return null
  const invalid = { invalid: true }
  if (parsed.invalid) return invalid
  const args = parsed.words.slice(parsed.commandIndex + 1)
  let projectPath
  const rawProjectPath = args.shift()
  if (videoProjectPath) {
    if (rawProjectPath !== videoProjectPath) return invalid
    projectPath = rawProjectPath
  } else {
    try {
      projectPath = validateCanonicalProductionPath(rawProjectPath, "project_path")
    } catch {
      return invalid
    }
  }
  const aliases = { "-o": "output", "-f": "fps", "-q": "quality", "-w": "workers" }
  const values = {}
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    const separator = token.indexOf("=")
    const name = separator < 0 ? token : token.slice(0, separator)
    const key = aliases[name] ?? (name.startsWith("--") ? name.slice(2) : null)
    if (!["output", "fps", "quality", "workers", "format"].includes(key) || Object.hasOwn(values, key)) return invalid
    const value = separator < 0 ? args[++index] : token.slice(separator + 1)
    if (!value || value.startsWith("-")) return invalid
    values[key] = value
  }
  if (!values.output) return invalid
  if (values.fps !== undefined && (!/^\d+$/.test(values.fps) || Number(values.fps) < 1 || Number(values.fps) > 240)) return invalid
  if (values.workers !== undefined && !/^[1-4]$/.test(values.workers)) return invalid
  if (values.quality !== undefined && !["draft", "looks", "delivery", "standard", "high"].includes(values.quality)) return invalid
  if (values.format !== undefined && values.format !== "mp4") return invalid
  if (videoProjectPath && !videoTargetPath(values.output, videoProjectPath)) return invalid
  if (!videoProjectPath) {
    try {
      validateCanonicalProductionPath(values.output, "output")
    } catch {
      return invalid
    }
  }
  return { invalid: false, project_path: projectPath, ...values }
}

export async function editorHyperFramesRenderAllows(command, directory) {
  const options = hyperFramesRenderOptions(command)
  if (!options || options.invalid) return false
  if (await finalRenderApprovalAllows(options.output, options.project_path, directory)) return true
  try {
    const { workspace, manifest } = await requiredProduction(directory)
    if (manifest.project.status !== "composition") return false
    if (manifest.latest_checkpoint?.verification?.[FINAL_RENDER_APPROVAL_FIELD]) return false
    await requiredProductionDirectory(workspace, options.project_path)
    const output = await requiredProductionFile(workspace, options.output, { allowMissing: true })
    if (output.exists && (await stat(output.runtime_path)).nlink !== 1) return false
    return options.output === "production/outputs/rough-cut.mp4"
      && options.quality === "draft" && options.workers === "1"
      && Number(options.fps) >= 1 && Number(options.fps) <= 12
  } catch {
    return false
  }
}

export async function editorHyperFramesPathAllows(target, directory) {
  try {
    const { workspace, manifest } = await requiredProduction(directory)
    if (manifest.project.status !== "composition") return false
    validateCanonicalProductionPath(target, "HyperFrames path")
    if (target.split("/").some((part) => part === ".git" || part.startsWith(".env"))) return false
    const compositionRoot = join(workspace, "production/composition")
    const candidate = join(workspace, target)
    if (!inside(compositionRoot, candidate)) return false
    let cursor = workspace
    for (const part of target.split("/")) {
      cursor = join(cursor, part)
      const info = await existing(cursor)
      if (info?.isSymbolicLink()) return false
      if (info?.isFile() && info.nlink !== 1) return false
    }
    const info = await existing(cursor)
    if (info?.isDirectory() && !await safeCompositionTree(workspace, cursor)) return false
    return true
  } catch {
    return false
  }
}

export async function editorFfprobeAllows(command, directory) {
  const words = shellWords(command?.trim())
  if (!words || words.length !== 2 || words[0] !== "ffprobe") return false
  try {
    const canonicalPath = validateCanonicalProductionPath(words[1], "media_path")
    const { workspace } = await requiredProduction(directory)
    await requiredProductionFile(workspace, canonicalPath)
    return true
  } catch {
    return false
  }
}

export async function editorAssetCopyAllows(command, directory) {
  const words = shellWords(command?.trim())
  if (!words || words.length !== 4 || words[0] !== "cp" || words[1] !== "--") return false
  const [, , source, destination] = words
  try {
    const { workspace, manifest } = await requiredProduction(directory)
    if (manifest.project.status !== "composition") return false
    if (source.split("/").some((part) => part.startsWith(".env"))) return false
    if (!manifest.assets.some((asset) => asset.path === source
      && ["video", "image", "audio"].includes(asset.kind) && ["ready", "used"].includes(asset.status))) return false
    if (!destination.startsWith("production/composition/assets/") || source === destination) return false
    if (manifest.assets.some((asset) => asset.path === destination)) return false
    const input = await requiredProductionFile(workspace, source)
    const output = await requiredProductionFile(workspace, destination, { allowMissing: true })
    if (output.exists && (await stat(output.runtime_path)).nlink !== 1) return false
    if (await isApprovedRenderProjectMutationTarget(destination, directory)) return false
    if (output.exists) {
      const [inputInfo, outputInfo] = await Promise.all([stat(input.runtime_path), stat(output.runtime_path)])
      if (inputInfo.dev === outputInfo.dev && inputInfo.ino === outputInfo.ino) return false
    }
    return true
  } catch {
    return false
  }
}

export async function isApprovedRenderProjectMutationTarget(target, directory) {
  if (typeof target !== "string" || !target.trim() || typeof directory !== "string" || !directory.trim()) return false
  try {
    const { workspace, manifest } = await requiredProduction(directory)
    const approvedPath = manifest.latest_checkpoint?.verification?.[FINAL_RENDER_PROJECT_PATH_FIELD]
    if (typeof approvedPath !== "string") return false
    const project = await requiredProductionDirectory(workspace, approvedPath)
    const candidate = isAbsolute(target) ? target : join(workspace, target)
    const root = await realpath(project.runtime_path)
    let resolved
    try {
      resolved = await realpath(candidate)
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
      let cursor = candidate
      const suffix = []
      while (true) {
        try {
          resolved = join(await realpath(cursor), ...suffix)
          break
        } catch (parentError) {
          if (parentError?.code !== "ENOENT") throw parentError
          const parent = join(cursor, "..")
          if (parent === cursor) return false
          suffix.unshift(cursor.slice(parent.length + 1))
          cursor = parent
        }
      }
    }
    return inside(root, resolved)
  } catch {
    return false
  }
}

export async function productionRecordOutput(args = {}, directory) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("production_record_output input must be an object")
  }
  for (const field of Object.keys(args)) {
    if (!OUTPUT_INPUT_FIELDS.has(field)) throw new Error(`production_record_output does not accept ${field}`)
  }
  if (!OUTPUT_SLOTS.has(args.slot)) throw new Error("production_record_output slot must be rough_cut or final")
  const canonicalPath = validateCanonicalProductionPath(args.canonical_path, "canonical_path")
  const { path, workspace, manifest: current } = await requiredProduction(directory)
  if (current.project.status !== "composition") {
    throw new Error(`production_record_output requires composition state, got ${current.project.status}`)
  }
  const output = await requiredProductionFile(workspace, canonicalPath)
  if (args.slot === "final" && !await finalRenderApprovalAllows(
    canonicalPath, current.latest_checkpoint?.verification?.[FINAL_RENDER_PROJECT_PATH_FIELD], directory,
  )) throw new Error("final output registration requires current Producer render approval for this rough cut and path")
  const digest = await sha256File(output.runtime_path)
  const record = {
    path: canonicalPath,
    kind: args.slot === "rough_cut" ? "rough-cut-video" : "final-video",
    sha256: digest,
    size_bytes: output.size_bytes,
  }

  const { manifest: next, result } = await updateProductionManifest(path, (manifest) => {
    if (manifest.project.status !== "composition") {
      throw new Error(`production_record_output requires composition state, got ${manifest.project.status}`)
    }
    if (args.slot === "final") {
      const roughCutPath = artifactPath(manifest.outputs.rough_cut, "outputs.rough_cut")
      const roughCutDigest = manifest.outputs.rough_cut?.sha256
      if (typeof roughCutDigest !== "string" || !/^[a-f0-9]{64}$/.test(roughCutDigest)) {
        throw new Error("final output registration requires a hashed registered rough cut")
      }
      const expectedApproval = approvalDigest({
        projectID: manifest.project.id,
        roughCutPath,
        roughCutDigest,
        projectPath: manifest.latest_checkpoint?.verification?.[FINAL_RENDER_PROJECT_PATH_FIELD],
        finalPath: canonicalPath,
      })
      if (manifest.latest_checkpoint?.phase !== "composition"
        || typeof manifest.latest_checkpoint.verification?.[FINAL_RENDER_PROJECT_PATH_FIELD] !== "string"
        || manifest.latest_checkpoint.verification?.[FINAL_RENDER_APPROVAL_FIELD] !== expectedApproval) {
        throw new Error("final output registration requires current Producer render approval for this rough cut and path")
      }
      delete manifest.latest_checkpoint.verification[FINAL_RENDER_APPROVAL_FIELD]
      delete manifest.latest_checkpoint.verification[FINAL_RENDER_PROJECT_PATH_FIELD]
    } else if (manifest.latest_checkpoint?.verification) {
      delete manifest.latest_checkpoint.verification[FINAL_RENDER_APPROVAL_FIELD]
      delete manifest.latest_checkpoint.verification[FINAL_RENDER_PROJECT_PATH_FIELD]
    }
    manifest.outputs[args.slot] = record
    manifest.updated_at = new Date().toISOString()
    return { slot: args.slot, output: record }
  })
  validateProductionManifest(next)
  return {
    ...result,
    project_id: next.project.id,
    project_status: next.project.status,
    manifest_revision: next.revision,
    manifest: { canonical_path: PRODUCTION_MANIFEST_PATH, runtime_path: path },
  }
}

function artifactPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_ARTIFACTS) {
    throw new Error(`production_prepare_artifacts requires 1 to ${MAX_ARTIFACTS} canonical file paths`)
  }
  return paths.map((path, index) => {
    validateCanonicalProductionPath(path, `paths[${index}]`)
    if (path === PRODUCTION_MANIFEST_PATH) throw new Error("the canonical production manifest is reserved")
    return path
  })
}

async function preparedParent(workspace, production, parts) {
  let parent = production
  for (const part of parts) {
    const candidate = join(parent, part)
    let info = await existing(candidate)
    if (!info) {
      try {
        await mkdir(candidate)
      } catch (error) {
        if (error?.code !== "EEXIST") throw error
      }
      info = await existing(candidate)
    }
    if (info.isSymbolicLink()) throw new Error(`artifact parent must not be a symlink: ${candidate}`)
    if (!info.isDirectory()) throw new Error(`artifact parent must be a directory: ${candidate}`)
    parent = await realpath(candidate)
    if (!inside(workspace, parent)) throw new Error(`artifact parent escapes the active workspace: ${candidate}`)
  }
  return parent
}

export async function productionPrepareArtifacts({ paths } = {}, directory) {
  const { workspace, production } = await requiredProduction(directory)
  const canonical = artifactPaths(paths)
  const artifacts = []
  for (const path of canonical) {
    const parts = path.split("/")
    const parent = await preparedParent(workspace, production, parts.slice(1, -1))
    const runtimePath = join(parent, parts.at(-1))
    if (!inside(workspace, runtimePath)) throw new Error(`artifact destination escapes the active workspace: ${path}`)
    const info = await existing(runtimePath)
    if (info?.isSymbolicLink()) throw new Error(`artifact destination must not be a symlink: ${path}`)
    if (info && !info.isFile()) throw new Error(`artifact destination must be a regular file: ${path}`)
    artifacts.push({
      canonical_path: path,
      runtime_path: runtimePath,
      parent_runtime_path: parent,
      existed: Boolean(info),
    })
  }
  return { artifacts }
}

export async function productionSetShots(args = {}, directory) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("production_set_shots input must be an object")
  }
  for (const field of Object.keys(args)) {
    if (field !== "shots") throw new Error(`production_set_shots does not accept ${field}`)
  }
  if (!Array.isArray(args.shots)) throw new Error("production_set_shots requires a complete ShotSpec array in shots")

  const { path } = await requiredProduction(directory)
  const { manifest: next } = await updateProductionManifest(path, (manifest) => {
    manifest.shots = structuredClone(args.shots)
  })
  return {
    project_id: next.project.id,
    project_status: next.project.status,
    manifest_revision: next.revision,
    shot_count: next.shots.length,
    shot_ids: next.shots.map((shot) => shot.shot_id),
    manifest: { canonical_path: PRODUCTION_MANIFEST_PATH, runtime_path: path },
  }
}

export async function productionTransition(args = {}, directory) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("production_transition input must be an object")
  }
  for (const field of Object.keys(args)) {
    if (!TRANSITION_INPUT_FIELDS.has(field)) throw new Error(`production_transition does not accept ${field}`)
  }
  const { path, workspace, manifest: current } = await requiredProduction(directory)
  transitionProductionManifest(current, args.to_status)
  if (args.to_status === "composition" && current.project.status === "assets-ready") {
    await requireCompositionAssets(workspace, current)
  }
  if (args.to_status === "qa") await verifiedOutput(workspace, current, "final")
  if (args.to_status === "completed") {
    await verifiedOutput(workspace, current, "final")
    if (current.project.status !== "qa"
      || current.latest_checkpoint?.phase !== "qa"
      || current.latest_checkpoint.verification?.watch_verdict !== "PASS") {
      throw new Error("production_transition to completed requires a QA checkpoint with watch_verdict PASS")
    }
  }
  const { manifest: next, result: previousStatus } = await updateProductionManifest(path, (manifest) => {
    const previous = manifest.project.status
    if (previous !== current.project.status) {
      throw new Error("ProductionManifest lifecycle changed before the transition could be persisted")
    }
    if (args.to_status === "composition" && previous === "assets-ready"
      && (JSON.stringify(manifest.assets) !== JSON.stringify(current.assets)
        || JSON.stringify(manifest.shots) !== JSON.stringify(current.shots))) {
      throw new Error("composition inputs changed before the transition could be persisted")
    }
    if (["qa", "completed"].includes(args.to_status)
      && JSON.stringify(manifest.outputs.final) !== JSON.stringify(current.outputs.final)) {
      throw new Error("final output changed before the transition could be persisted")
    }
    if (args.to_status === "completed"
      && (manifest.latest_checkpoint?.phase !== "qa"
        || manifest.latest_checkpoint.verification?.watch_verdict !== "PASS")) {
      throw new Error("production_transition to completed requires a QA checkpoint with watch_verdict PASS")
    }
    const transitioned = transitionProductionManifest(manifest, args.to_status, {
      at: new Date().toISOString(),
      ...(args.note === undefined ? {} : { note: args.note }),
    })
    Object.assign(manifest, transitioned)
    if (["composition", "qa"].includes(args.to_status) && manifest.latest_checkpoint?.verification) {
      delete manifest.latest_checkpoint.verification[FINAL_RENDER_APPROVAL_FIELD]
      delete manifest.latest_checkpoint.verification[FINAL_RENDER_PROJECT_PATH_FIELD]
    }
    return previous
  })
  return {
    project_id: next.project.id,
    previous_status: previousStatus,
    status: next.project.status,
    revision: next.revision,
    history_entry: next.history.at(-1),
    manifest: { canonical_path: PRODUCTION_MANIFEST_PATH, runtime_path: path },
  }
}

export async function productionCheckpoint(args = {}, directory) {
  const { path } = await requiredProduction(directory)
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("production_checkpoint input must be an object")
  for (const field of Object.keys(args)) {
    if (!CHECKPOINT_INPUT_FIELDS.has(field)) throw new Error(`production_checkpoint does not accept ${field}`)
  }
  if (args.verification && typeof args.verification === "object"
    && (Object.hasOwn(args.verification, FINAL_RENDER_APPROVAL_FIELD)
      || Object.hasOwn(args.verification, FINAL_RENDER_PROJECT_PATH_FIELD))) {
    throw new Error("production_checkpoint cannot create final-render approval state")
  }
  const { manifest: next, result: checkpoint } = await updateProductionManifest(path, (manifest) => {
    const currentCheckpoint = {
      phase: manifest.project.status,
      current_focus: Object.hasOwn(args, "current_focus") ? args.current_focus : null,
      completed: Object.hasOwn(args, "completed") ? args.completed : [],
      remaining: Object.hasOwn(args, "remaining") ? args.remaining : [],
      verification: Object.hasOwn(args, "verification") ? args.verification : {},
      important_artifacts: Object.hasOwn(args, "important_artifacts") ? args.important_artifacts : [],
      updated_at: new Date().toISOString(),
    }
    manifest.latest_checkpoint = currentCheckpoint
    return currentCheckpoint
  })
  return {
    project_id: next.project.id,
    project_status: next.project.status,
    manifest_revision: next.revision,
    manifest: { canonical_path: PRODUCTION_MANIFEST_PATH, runtime_path: path },
    latest_checkpoint: checkpoint,
  }
}

export async function productionApproveGeneration(args = {}, directory) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("production_approve_generation input must be an object")
  }
  for (const field of Object.keys(args)) {
    if (!GENERATION_APPROVAL_INPUT_FIELDS.has(field)) {
      throw new Error(`production_approve_generation does not accept ${field}`)
    }
  }
  if (typeof args.job_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(args.job_id)) {
    throw new Error("production_approve_generation requires a valid job_id")
  }
  if (typeof args.request_digest !== "string" || !/^[a-f0-9]{64}$/.test(args.request_digest)) {
    throw new Error("production_approve_generation requires a lowercase SHA-256 request_digest")
  }
  if (typeof args.approved_max_usd !== "number" || !Number.isFinite(args.approved_max_usd) || args.approved_max_usd < 0) {
    throw new Error("approved_max_usd must be a non-negative number")
  }

  const { path } = await requiredProduction(directory)
  const { result: approved } = await updateProductionManifest(path, (manifest) => {
    const job = manifest.generation_jobs.find((candidate) => candidate.job_id === args.job_id)
    if (!job) throw new Error(`ProductionManifest has no generation job ${args.job_id}`)
    if (job.status !== "calculated") {
      throw new Error(`generation job ${args.job_id} must be calculated before Producer approval`)
    }
    if (job.request_digest !== args.request_digest) {
      throw new Error("generation approval rejected: request_digest does not match the calculated job")
    }
    if (typeof job.estimated_usd !== "number" || !Number.isFinite(job.estimated_usd) || job.estimated_usd < 0) {
      throw new Error(`generation job ${args.job_id} has no valid calculated price to approve`)
    }
    if (args.approved_max_usd < job.estimated_usd) {
      throw new Error(`approved_max_usd ${args.approved_max_usd} is below the calculated price ${job.estimated_usd}`)
    }

    const timestamp = new Date().toISOString()
    Object.assign(job, {
      // Existing status used for a quoted job cleared by Producer and waiting for Creator submission.
      status: "awaiting_approval",
      approved_usd: args.approved_max_usd,
      approved_max_usd: args.approved_max_usd,
      approved_price_usd: job.estimated_usd,
      updated_at: timestamp,
    })
    manifest.costs.approved_usd = manifest.generation_jobs
      .map((candidate) => candidate.approved_usd)
      .filter((value) => typeof value === "number" && Number.isFinite(value))
      .reduce((total, value) => total + value, 0)
    manifest.updated_at = timestamp
    return {
      job_id: job.job_id,
      status: job.status,
      request_digest: job.request_digest,
      approved_price_usd: job.approved_price_usd,
      approved_max_usd: job.approved_max_usd,
    }
  })
  return {
    ...approved,
    manifest: { canonical_path: PRODUCTION_MANIFEST_PATH, runtime_path: path },
  }
}

export async function productionApproveFinalRender(args = {}, directory) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("production_approve_final_render input must be an object")
  }
  for (const field of Object.keys(args)) {
    if (!FINAL_RENDER_APPROVAL_INPUT_FIELDS.has(field)) {
      throw new Error(`production_approve_final_render does not accept ${field}`)
    }
  }
  const finalPath = validateCanonicalProductionPath(args.final_path, "final_path")
  const projectPath = validateCanonicalProductionPath(args.project_path, "project_path")
  const { path, workspace, manifest: current } = await requiredProduction(directory)
  if (current.project.status !== "composition") {
    throw new Error(`production_approve_final_render requires composition state, got ${current.project.status}`)
  }
  if (current.latest_checkpoint?.phase !== "composition") {
    throw new Error("production_approve_final_render requires a current composition checkpoint")
  }

  const roughCut = await verifiedOutput(workspace, current, "rough_cut")
  const project = await requiredProductionDirectory(workspace, projectPath)
  if (finalPath === roughCut.canonical_path) {
    throw new Error("final render destination must differ from the registered rough cut")
  }
  const destination = await requiredProductionFile(workspace, finalPath, { allowMissing: true })
  if (inside(project.runtime_path, destination.runtime_path)) {
    throw new Error("final render destination must be outside the HyperFrames project directory")
  }
  if (destination.exists) {
    const [outputInfo, roughInfo] = await Promise.all([stat(destination.runtime_path), stat(roughCut.runtime_path)])
    if (outputInfo.dev === roughInfo.dev && outputInfo.ino === roughInfo.ino) {
      throw new Error("final render destination must not alias the registered rough cut")
    }
  }

  const digest = approvalDigest({
    projectID: current.project.id,
    roughCutPath: roughCut.canonical_path,
    roughCutDigest: roughCut.sha256,
    projectPath,
    finalPath,
  })
  const timestamp = new Date().toISOString()
  const { manifest: next } = await updateProductionManifest(path, (manifest) => {
    if (manifest.project.status !== "composition" || manifest.latest_checkpoint?.phase !== "composition") {
      throw new Error("production changed before final-render approval could be persisted")
    }
    const persistedRoughPath = artifactPath(manifest.outputs.rough_cut, "outputs.rough_cut")
    if (persistedRoughPath !== roughCut.canonical_path || manifest.outputs.rough_cut?.sha256 !== roughCut.sha256) {
      throw new Error("registered rough cut changed before final-render approval could be persisted")
    }
    if (manifest.latest_checkpoint.verification[FINAL_RENDER_PROJECT_PATH_FIELD] !== undefined) {
      throw new Error("clear the previous final-render approval before approving another render")
    }
    manifest.latest_checkpoint.verification[FINAL_RENDER_PROJECT_PATH_FIELD] = projectPath
    manifest.latest_checkpoint.verification[FINAL_RENDER_APPROVAL_FIELD] = digest
    manifest.latest_checkpoint.updated_at = timestamp
    manifest.updated_at = timestamp
  })
  return {
    project_id: next.project.id,
    project_status: next.project.status,
    final_path: finalPath,
    project_path: projectPath,
    rough_cut_path: roughCut.canonical_path,
    rough_cut_sha256: roughCut.sha256,
    approval_digest: digest,
    manifest: { canonical_path: PRODUCTION_MANIFEST_PATH, runtime_path: path },
  }
}
