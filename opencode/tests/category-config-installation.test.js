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
      await writeFile(sourcePath, "")
    }
  }

  const canonicalRepository = await realpath(repository)

  return {
    install,
    manifest,
    legacySource: join(canonicalRepository, "opencode", "categories.json"),
  }
}

async function runInstall(root, fixture) {
  const home = join(root, "home")
  const result = await execFileAsync(fixture.install, ["--backup-dir", join(root, "backup")], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      OPENCODE_WORKFLOW_DATA_ROOT: join(root, "data"),
    },
  })
  return { home, result }
}

function categoryPath(home) {
  return join(home, ".config", "opencode", "categories.json")
}

test("installer leaves missing user-local category config absent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "missing-category-install-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await createFixtureRepository(root)

  const { home, result } = await runInstall(root, fixture)
  await assert.rejects(lstat(categoryPath(home)), { code: "ENOENT" })
  assert.match(result.stdout, /Migration complete/)
  assert.doesNotMatch(await readFile(fixture.manifest, "utf8"), /^opencode\/categories\.json\|/m)
})

test("installer preserves a regular user-local category config", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "regular-category-install-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await createFixtureRepository(root)
  const home = join(root, "home")
  const configPath = categoryPath(home)
  const content = '{"categories":{"local":{"model":"provider/model"}}}\n'
  const legacyContent = '{"categories":{"legacy":{"model":"provider/legacy"}}}\n'
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, content)
  await writeFile(fixture.legacySource, legacyContent)

  await runInstall(root, fixture)
  assert.equal(await readFile(configPath, "utf8"), content)
  assert.equal((await lstat(configPath)).isSymbolicLink(), false)
  assert.equal(await readFile(fixture.legacySource, "utf8"), legacyContent)
})

test("installer preserves an unrelated user-managed category symlink", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "linked-category-install-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await createFixtureRepository(root)
  const home = join(root, "home")
  const configPath = categoryPath(home)
  const externalPath = join(root, "external-categories.json")
  const externalContent = '{"categories":{}}\n'
  const legacyContent = '{"categories":{"legacy":{"model":"provider/legacy"}}}\n'
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(externalPath, externalContent)
  await writeFile(fixture.legacySource, legacyContent)
  await symlink(externalPath, configPath)

  await runInstall(root, fixture)
  assert.equal(await readlink(configPath), externalPath)
  assert.equal(await readFile(externalPath, "utf8"), externalContent)
  assert.equal(await readFile(fixture.legacySource, "utf8"), legacyContent)
})

test("installer converts the exact legacy category symlink into a local file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "legacy-category-install-test-"))
  const fixture = await createFixtureRepository(root)
  const content = '{"categories":{"legacy":{"model":"provider/model"}}}\n'
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(fixture.legacySource, content)
  const home = join(root, "home")
  const configPath = categoryPath(home)
  await mkdir(dirname(configPath), { recursive: true })
  await symlink(fixture.legacySource, configPath)

  const { result } = await runInstall(root, fixture)
  assert.equal(await readFile(configPath, "utf8"), content)
  assert.equal((await lstat(configPath)).isSymbolicLink(), false)
  await assert.rejects(lstat(fixture.legacySource), { code: "ENOENT" })
  assert.match(result.stdout, /Migrated legacy repository-managed category config/)
})

test("installer removes only a broken exact legacy category symlink", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "broken-category-install-test-"))
  const fixture = await createFixtureRepository(root)
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, "home")
  const configPath = categoryPath(home)
  await mkdir(dirname(configPath), { recursive: true })
  await symlink(fixture.legacySource, configPath)

  const { result } = await runInstall(root, fixture)
  await assert.rejects(lstat(configPath), { code: "ENOENT" })
  assert.match(result.stdout, /Removed broken legacy repository-managed category config symlink/)
})
