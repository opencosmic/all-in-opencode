import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repository = fileURLToPath(new URL("../..", import.meta.url))
const install = join(repository, "scripts", "install.sh")
const manifest = join(repository, "scripts", "links.tsv")
const legacySource = join(repository, "opencode", "categories.json")

async function runInstall(root) {
  const home = join(root, "home")
  const result = await execFileAsync(install, ["--backup-dir", join(root, "backup")], {
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

  const { home, result } = await runInstall(root)
  await assert.rejects(lstat(categoryPath(home)), { code: "ENOENT" })
  assert.match(result.stdout, /Migration complete/)
  assert.doesNotMatch(await readFile(manifest, "utf8"), /^opencode\/categories\.json\|/m)
})

test("installer preserves a regular user-local category config", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "regular-category-install-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, "home")
  const configPath = categoryPath(home)
  const content = '{"categories":{"local":{"model":"provider/model"}}}\n'
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, content)

  await runInstall(root)
  assert.equal(await readFile(configPath, "utf8"), content)
  assert.equal((await lstat(configPath)).isSymbolicLink(), false)
})

test("installer preserves an unrelated user-managed category symlink", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "linked-category-install-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, "home")
  const configPath = categoryPath(home)
  const externalPath = join(root, "external-categories.json")
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(externalPath, '{"categories":{}}\n')
  await symlink(externalPath, configPath)

  await runInstall(root)
  assert.equal(await readlink(configPath), externalPath)
})

test("installer converts the exact legacy category symlink into a local file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "legacy-category-install-test-"))
  const content = '{"categories":{"legacy":{"model":"provider/model"}}}\n'
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(legacySource, { force: true })
  })
  await writeFile(legacySource, content)
  const home = join(root, "home")
  const configPath = categoryPath(home)
  await mkdir(dirname(configPath), { recursive: true })
  await symlink(legacySource, configPath)

  const { result } = await runInstall(root)
  assert.equal(await readFile(configPath, "utf8"), content)
  assert.equal((await lstat(configPath)).isSymbolicLink(), false)
  assert.match(result.stdout, /Migrated legacy repository-managed category config/)
})

test("installer removes only a broken exact legacy category symlink", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "broken-category-install-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await rm(legacySource, { force: true })
  const home = join(root, "home")
  const configPath = categoryPath(home)
  await mkdir(dirname(configPath), { recursive: true })
  await symlink(legacySource, configPath)

  const { result } = await runInstall(root)
  await assert.rejects(lstat(configPath), { code: "ENOENT" })
  assert.match(result.stdout, /Removed broken legacy repository-managed category config symlink/)
})
