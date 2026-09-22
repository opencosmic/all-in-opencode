import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const sourceRepository = fileURLToPath(new URL("../..", import.meta.url))
const sourceInstall = join(sourceRepository, "scripts", "install.sh")
const sourceVerify = join(sourceRepository, "scripts", "verify.sh")
const sourceManifest = join(sourceRepository, "scripts", "links.tsv")

async function createFixtureRepository(root) {
  const repository = join(root, "repo")
  const scriptsDirectory = join(repository, "scripts")
  const install = join(scriptsDirectory, "install.sh")
  const manifest = join(scriptsDirectory, "links.tsv")
  const manifestContent = await readFile(sourceManifest, "utf8")

  await mkdir(scriptsDirectory, { recursive: true })
  await copyFile(sourceInstall, install)
  await chmod(install, 0o755)
  await writeFile(manifest, manifestContent)

  for (const line of manifestContent.split("\n")) {
    const [sourceRelative, , kind] = line.split("|")
    if (!sourceRelative || sourceRelative.startsWith("#")) continue
    const sourcePath = join(repository, sourceRelative)
    if (kind === "directory") {
      await mkdir(sourcePath, { recursive: true })
    } else if (kind === "file") {
      await mkdir(dirname(sourcePath), { recursive: true })
      await writeFile(sourcePath, `source:${sourceRelative}\n`)
    }
  }

  const canonicalRepository = await realpath(repository)
  return {
    install: join(canonicalRepository, "scripts", "install.sh"),
    manifest: join(canonicalRepository, "scripts", "links.tsv"),
    repository: canonicalRepository,
    agentSource: join(canonicalRepository, "opencode", "agents"),
  }
}

function builtinAgentNames(manifest) {
  return manifest
    .split("\n")
    .map((line) => line.split("|"))
    .filter(([sourceRelative, , kind]) => kind === "file" && sourceRelative?.startsWith("opencode/agents/"))
    .map(([sourceRelative]) => sourceRelative.slice("opencode/agents/".length))
}

async function runInstall(root, fixture, backupName = "backup") {
  const home = join(root, "home")
  const backupDirectory = join(root, backupName)
  const result = await execFileAsync(fixture.install, ["--backup-dir", backupDirectory], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      OPENCODE_WORKFLOW_DATA_ROOT: join(root, "data"),
    },
  })
  return { backupDirectory, home, result }
}

async function assertBuiltinLinks(home, fixture) {
  const manifest = await readFile(fixture.manifest, "utf8")
  for (const name of builtinAgentNames(manifest)) {
    const livePath = join(home, ".config", "opencode", "agents", name)
    assert.equal(await readlink(livePath), join(fixture.agentSource, name), name)
    assert.equal((await lstat(livePath)).isSymbolicLink(), true, name)
  }
}

test("installer creates a real user-owned agents directory with per-file links", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agents-install-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await createFixtureRepository(root)

  const { home, result } = await runInstall(root, fixture)
  const agentsPath = join(home, ".config", "opencode", "agents")
  assert.equal((await lstat(agentsPath)).isSymbolicLink(), false)
  assert.equal((await lstat(agentsPath)).isDirectory(), true)
  await assertBuiltinLinks(home, fixture)
  assert.match(result.stdout, /Migration complete/)
})

test("installer migrates the exact old agents directory symlink and preserves custom entries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agents-migration-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await createFixtureRepository(root)
  const customName = "custom-architect.md"
  const customContent = "user-owned custom agent\n"
  await writeFile(join(fixture.agentSource, customName), customContent)
  const builtinNames = builtinAgentNames(await readFile(fixture.manifest, "utf8"))
  const sourceSnapshot = Object.fromEntries(await Promise.all(
    builtinNames.map(async (name) => [name, await readFile(join(fixture.agentSource, name), "utf8")]),
  ))
  const home = join(root, "home")
  const agentsPath = join(home, ".config", "opencode", "agents")
  await mkdir(dirname(agentsPath), { recursive: true })
  await symlink(fixture.agentSource, agentsPath)

  const { backupDirectory, result } = await runInstall(root, fixture)
  assert.equal((await lstat(agentsPath)).isSymbolicLink(), false)
  assert.equal(await readFile(join(agentsPath, customName), "utf8"), customContent)
  assert.equal((await lstat(join(agentsPath, customName))).isSymbolicLink(), false)
  await assertBuiltinLinks(home, fixture)
  assert.equal(await readlink(join(backupDirectory, "files", ".config", "opencode", "agents")), fixture.agentSource)
  assert.match(result.stdout, /Migrated the old agents directory symlink/)

  for (const [name, content] of Object.entries(sourceSnapshot)) {
    assert.equal(await readFile(join(fixture.agentSource, name), "utf8"), content, name)
  }
  assert.equal(await readFile(join(fixture.agentSource, customName), "utf8"), customContent)
})

test("installer preserves custom files in an existing user-owned agents directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agents-preservation-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await createFixtureRepository(root)
  const home = join(root, "home")
  const agentsPath = join(home, ".config", "opencode", "agents")
  const customPath = join(agentsPath, "local-reviewer.md")
  const customContent = "local agent survives installation\n"
  await mkdir(agentsPath, { recursive: true })
  await writeFile(customPath, customContent)

  await runInstall(root, fixture)
  assert.equal((await lstat(agentsPath)).isSymbolicLink(), false)
  assert.equal(await readFile(customPath, "utf8"), customContent)
  assert.equal((await lstat(customPath)).isSymbolicLink(), false)
  await assertBuiltinLinks(home, fixture)
})

test("installer is idempotent after the per-file migration", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agents-idempotency-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await createFixtureRepository(root)

  await runInstall(root, fixture, "backup-one")
  const second = await runInstall(root, fixture, "backup-two")
  await assertBuiltinLinks(second.home, fixture)
  assert.equal((await lstat(join(second.home, ".config", "opencode", "agents"))).isSymbolicLink(), false)
})

test("installer rejects an unexpected agents directory symlink without touching its target", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agents-unexpected-link-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await createFixtureRepository(root)
  const externalDirectory = join(root, "external-agents")
  const externalFile = join(externalDirectory, "keep.md")
  const content = "external custom directory\n"
  await mkdir(externalDirectory, { recursive: true })
  await writeFile(externalFile, content)
  const agentsPath = join(root, "home", ".config", "opencode", "agents")
  await mkdir(dirname(agentsPath), { recursive: true })
  await symlink(externalDirectory, agentsPath)

  await assert.rejects(
    runInstall(root, fixture),
    /refusing unexpected agents directory symlink/,
  )
  assert.equal(await readFile(externalFile, "utf8"), content)
  assert.equal(await readlink(agentsPath), externalDirectory)
})

test("installer rejects legacy categories.json before any installation mutation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "legacy-category-install-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await createFixtureRepository(root)
  const legacyPath = join(root, "home", ".config", "opencode", "categories.json")
  const agentsPath = join(root, "home", ".config", "opencode", "agents")
  const backupDirectory = join(root, "backup")
  const content = '{"categories":{"legacy":{"model":"provider/model"}}}\n'
  await mkdir(dirname(legacyPath), { recursive: true })
  await writeFile(legacyPath, content)

  await assert.rejects(
    runInstall(root, fixture),
    (error) => {
      assert.match(`${error.stdout}\n${error.stderr}`, /categories\.json is no longer supported/)
      assert.match(`${error.stdout}\n${error.stderr}`, /aio\.json.*["']categories["']/)
      return true
    },
  )
  assert.equal(await readFile(legacyPath, "utf8"), content)
  await assert.rejects(lstat(agentsPath), { code: "ENOENT" })
  await assert.rejects(lstat(backupDirectory), { code: "ENOENT" })
})

test("verify rejects legacy categories.json before checking live links", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "legacy-category-verify-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, "home")
  const legacyPath = join(home, ".config", "opencode", "categories.json")
  await mkdir(dirname(legacyPath), { recursive: true })
  await writeFile(legacyPath, '{"categories":{"legacy":{"model":"provider/model"}}}\n')

  await assert.rejects(
    execFileAsync(sourceVerify, [], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    }),
    (error) => {
      assert.match(`${error.stdout}\n${error.stderr}`, /categories\.json is no longer supported/)
      assert.match(`${error.stdout}\n${error.stderr}`, /aio\.json.*["']categories["']/)
      return true
    },
  )
})
