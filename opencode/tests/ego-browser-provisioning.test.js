import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const repository = resolve(here, "../..")
const setup = join(repository, "scripts/setup-ego-browser.sh")
const check = join(repository, "scripts/check-ego-browser.sh")

async function executable(path, source) {
  await writeFile(path, source)
  await chmod(path, 0o755)
}

async function fixture(t, skillLocations = [], { npxSucceeds = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "ego-browser-provisioning-"))
  const home = join(root, "home with spaces")
  const bin = join(root, "bin")
  await mkdir(home, { recursive: true })
  await mkdir(bin, { recursive: true })
  t.after(() => rm(root, { recursive: true, force: true }))

  await executable(join(bin, "uname"), "#!/bin/sh\nprintf '%s\\n' Darwin\n")
  await executable(
    join(bin, "npx"),
    `#!/bin/sh\nprintf '%s\\n' 'fixture npx invoked'\nexit ${npxSucceeds ? 0 : 97}\n`,
  )
  await executable(
    join(bin, "ego-browser"),
    "#!/bin/sh\n[ \"${1:-}\" = nodejs ] || exit 1\ncat\n",
  )

  const selectedLocation = [
    ".config/opencode/skills",
    ".agents/skills",
    ".claude/skills",
  ].find((location) => skillLocations.includes(location))
  const selectedSkill = selectedLocation ? join(home, selectedLocation, "ego-browser") : ""
  await executable(
    join(bin, "opencode"),
    "#!/bin/sh\n" +
      "if [ -n \"${FIXTURE_SKILL_DIR:-}\" ]; then\n" +
      "  printf '[{\"name\":\"ego-browser\",\"location\":\"%s/SKILL.md\"}]\\n' \"$FIXTURE_SKILL_DIR\"\n" +
      "else\n" +
      "  printf '[]\\n'\n" +
      "fi\n",
  )

  for (const relative of skillLocations) {
    const skill = join(home, relative, "ego-browser")
    await mkdir(join(skill, "scripts"), { recursive: true })
    await writeFile(join(skill, "SKILL.md"), "---\nname: ego-browser\ndescription: fixture\n---\n")
    await executable(
      join(skill, "scripts/install.sh"),
      "#!/bin/sh\nprintf 'fixture installer: %s\\n' \"$(dirname -- \"$0\")\"\n",
    )
  }

  return {
    home,
    env: {
      ...process.env,
      FIXTURE_SKILL_DIR: selectedSkill,
      HOME: home,
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    },
  }
}

async function assertSupportedLocation(t, relative) {
  const { home, env } = await fixture(t, [relative])
  const expected = join(home, relative, "ego-browser")

  const health = await execFileAsync(check, [], { env, encoding: "utf8" })
  assert.match(health.stdout, new RegExp(`ego-browser skill: discoverable \\(${escapeRegExp(expected)}\\)`))
  assert.match(health.stdout, /optional runtime status: READY/)

  const provision = await execFileAsync(setup, [], { env, encoding: "utf8" })
  assert.match(provision.stdout, new RegExp(`Using existing ego-browser skill: ${escapeRegExp(expected)}`))
  assert.match(provision.stdout, new RegExp(`fixture installer: ${escapeRegExp(join(expected, "scripts"))}`))
  assert.doesNotMatch(provision.stdout, /fixture npx invoked/)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

test("config/opencode-only skill fixture is discovered and reused", async (t) => {
  await assertSupportedLocation(t, ".config/opencode/skills")
})

test(".agents-only skill fixture is discovered and reused", async (t) => {
  await assertSupportedLocation(t, ".agents/skills")
})

test(".claude-only skill fixture is discovered and reused", async (t) => {
  await assertSupportedLocation(t, ".claude/skills")
})

test("missing skill fixture is not ready and setup fails clearly after install discovery", async (t) => {
  const { env } = await fixture(t, [], { npxSucceeds: true })

  const health = await execFileAsync(check, [], { env, encoding: "utf8" })
  assert.match(health.stdout, /ego-browser skill: missing/)
  assert.match(health.stdout, /optional runtime status: NOT READY/)

  await assert.rejects(
    execFileAsync(setup, [], { env, encoding: "utf8" }),
    (error) => {
      assert.equal(error.code, 1)
      assert.match(error.stdout, /fixture npx invoked/)
      assert.match(error.stderr, /official skill was not found in any supported global OpenCode skill directory/)
      return true
    },
  )
})

test("global skill resolution follows OpenCode precedence", async (t) => {
  const { home, env } = await fixture(t, [
    ".claude/skills",
    ".agents/skills",
    ".config/opencode/skills",
  ])
  const expected = join(home, ".config/opencode/skills/ego-browser")
  const health = await execFileAsync(check, [], { env, encoding: "utf8" })

  assert.match(health.stdout, new RegExp(`ego-browser skill: discoverable \\(${escapeRegExp(expected)}\\)`))
})
