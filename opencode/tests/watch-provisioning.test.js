import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repository = fileURLToPath(new URL("../..", import.meta.url))
const setup = join(repository, "scripts/setup-watch.sh")
const check = join(repository, "scripts/check-watch.sh")

test("watch provisioning reuses the supported external skill layout", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "watch-provisioning-test-"))
  const home = join(root, "home with spaces")
  const skill = join(home, ".agents", "skills", "watch")
  await mkdir(join(skill, "scripts"), { recursive: true })
  await writeFile(join(skill, "SKILL.md"), "---\nname: watch\ndescription: fixture\n---\n")
  await writeFile(join(skill, "scripts", "watch.py"), "")
  await writeFile(join(skill, "scripts", "setup.py"), "")
  t.after(() => rm(root, { recursive: true, force: true }))

  const env = {
    ...process.env,
    HOME: home,
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  }
  const health = await execFileAsync(check, [], { env, encoding: "utf8" })
  assert.match(health.stdout, new RegExp(`watch skill: present with bundled runtime \\(${escapeRegExp(skill)}\\)`))

  const provision = await execFileAsync(setup, [], { env, encoding: "utf8" })
  assert.match(provision.stdout, new RegExp(`Using existing watch skill: ${escapeRegExp(skill)}`))
  assert.match(provision.stdout, /python3 .*scripts\/setup\.py --json/)
})

test("watch provisioning uses the upstream Agent Skills source", async () => {
  const source = await readFile(setup, "utf8")
  assert.match(source, /skills add bradautomates\/claude-video/)
  assert.match(source, /--skill watch/)
  assert.doesNotMatch(source, /git clone.*claude-video/)
})

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
