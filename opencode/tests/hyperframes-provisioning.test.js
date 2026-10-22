import test from "node:test"
import assert from "node:assert/strict"
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repository = fileURLToPath(new URL("../..", import.meta.url))
const setup = join(repository, "scripts/setup-hyperframes.sh")
const check = join(repository, "scripts/check-hyperframes.sh")

test("setup refreshes an existing HyperFrames installation and stays idempotent", async (t) => {
  const { env, npxLog, skill } = await fixture(t, { initialState: "current" })

  const first = await execFileAsync(setup, [], { env, encoding: "utf8" })
  assert.match(first.stdout, /Refreshing the upstream HyperFrames core skill set and already-installed workflows/)
  assert.match(first.stdout, /HyperFrames status: READY/)
  const currentSkill = await readFile(join(skill, "SKILL.md"), "utf8")

  const second = await execFileAsync(setup, [], { env, encoding: "utf8" })
  assert.match(second.stdout, /HyperFrames status: READY/)
  assert.equal(await readFile(join(skill, "SKILL.md"), "utf8"), currentSkill)
  assert.equal((await readFile(npxLog, "utf8")).match(/hyperframes skills update/g)?.length, 2)
})

test("setup installs a missing or stale HyperFrames entry through the official update", async (t) => {
  const missing = await fixture(t, { initialState: "missing" })
  const missingResult = await execFileAsync(setup, [], { env: missing.env, encoding: "utf8" })
  assert.match(missingResult.stdout, /Refreshing the upstream HyperFrames core skill set and already-installed workflows/)
  assert.match(missingResult.stdout, /HyperFrames status: READY/)
  assert.match(await readFile(join(missing.skill, "SKILL.md"), "utf8"), /fixture-current/)
  assert.match(await readFile(missing.npxLog, "utf8"), /hyperframes skills update/)

  const stale = await fixture(t, { initialState: "stale" })
  assert.match(await readFile(join(stale.skill, "SKILL.md"), "utf8"), /fixture-stale/)
  const staleResult = await execFileAsync(setup, [], { env: stale.env, encoding: "utf8" })
  assert.match(staleResult.stdout, /HyperFrames status: READY/)
  assert.match(await readFile(join(stale.skill, "SKILL.md"), "utf8"), /fixture-current/)
  assert.match(await readFile(stale.npxLog, "utf8"), /hyperframes skills update/)
})

test("HyperFrames readiness requires discovery of the actual installed skill", async (t) => {
  const { env, skill } = await fixture(t, { initialState: "current", discovery: false })

  await assert.rejects(
    execFileAsync(check, [], { env, encoding: "utf8" }),
    (error) => {
      assert.equal(error.code, 1)
      assert.match(error.stdout, new RegExp(`OpenCode discovery: not discoverable \\(${escapeRegExp(skill)}\\)`))
      assert.match(error.stdout, /HyperFrames status: NOT READY/)
      return true
    },
  )
})

test("HyperFrames readiness ignores CLI metadata update notices", async (t) => {
  const { env } = await fixture(t, { initialState: "current", cliUpdateAvailable: true })
  const result = await execFileAsync(check, [], { env, encoding: "utf8" })

  assert.match(result.stdout, /HyperFrames skills check: healthy/)
  assert.match(result.stdout, /HyperFrames status: READY/)
})

test("HyperFrames readiness rejects a top-level skill update notice", async (t) => {
  const { env } = await fixture(t, { initialState: "current", skillUpdateAvailable: true })

  await assert.rejects(
    execFileAsync(check, [], { env, encoding: "utf8" }),
    (error) => {
      assert.equal(error.code, 1)
      assert.match(error.stdout, /HyperFrames skills check: failed/)
      assert.match(error.stdout, /HyperFrames status: NOT READY/)
      return true
    },
  )
})

async function fixture(
  t,
  {
    initialState = "missing",
    discovery = true,
    skillUpdateAvailable = false,
    cliUpdateAvailable = false,
    activeRoot = ".agents/skills",
    discoveredRoot = activeRoot,
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "hyperframes-provisioning-test-"))
  const home = join(root, "home with spaces")
  const skill = join(home, activeRoot, "hyperframes")
  const bin = join(root, "bin")
  const npxLog = join(root, "npx.log")
  await mkdir(skill, { recursive: true })
  await mkdir(bin, { recursive: true })

  if (initialState !== "missing") {
    const marker = initialState === "stale" ? "fixture-stale" : "fixture-current"
    await writeFile(join(skill, "SKILL.md"), `---\nname: hyperframes\ndescription: ${marker}\n---\n`)
  }

  await writeExecutable(join(bin, "opencode"), `#!/bin/sh
if [ "${discovery ? "1" : "0"}" = "1" ] && [ -f "$HOME/${discoveredRoot}/hyperframes/SKILL.md" ]; then
  printf '[{"name":"hyperframes","location":"%s"}]\\n' "$HOME/${discoveredRoot}/hyperframes/SKILL.md"
else
  printf '[]\\n'
fi
`)
  await writeExecutable(join(bin, "npx"), `#!/bin/sh
printf '%s\\n' "$*" >> "$HF_NPX_LOG"
case "$*" in
  *"hyperframes skills update"*)
    mkdir -p "$HOME/${activeRoot}/hyperframes"
    printf '%s\\n' '---' 'name: hyperframes' 'description: fixture-current' '---' > "$HOME/${activeRoot}/hyperframes/SKILL.md"
    exit 0
    ;;
  *"hyperframes skills check --json"*)
    target=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--dir" ]; then shift; target=$1; fi
      shift
    done
    [ -n "$target" ] || target="$HOME/.claude/skills"
    state=current
    if [ ! -f "$target/hyperframes/SKILL.md" ]; then state=missing
    elif grep -q fixture-stale "$target/hyperframes/SKILL.md"; then state=outdated; fi
    printf '%s\\n' 'noise before json'
    printf '%s\\n' '{"updateAvailable":${skillUpdateAvailable ? "true" : "false"},"summary":{"current":9,"outdated":0,"missing":11,"coreMissing":0},"skills":[{"name":"hyperframes","status":"'"$state"'"}],"_meta":{"updateAvailable":${cliUpdateAvailable ? "true" : "false"}}}'
    exit 0
    ;;
esac
exit 97
`)
  await writeExecutable(join(bin, "ffmpeg"), "#!/bin/sh\nexit 0\n")
  await writeExecutable(join(bin, "ffprobe"), "#!/bin/sh\nexit 0\n")
  t.after(() => rm(root, { recursive: true, force: true }))

  return {
    env: {
      ...process.env,
      HOME: home,
      HF_NPX_LOG: npxLog,
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    },
    npxLog,
    skill,
  }
}

test("HyperFrames provisioning uses the upstream CLI without vendoring it", async () => {
  const source = await readFile(setup, "utf8")
  const checkSource = await readFile(check, "utf8")
  const resolver = await readFile(join(repository, "scripts/lib/resolve-hyperframes-skill.sh"), "utf8")
  assert.match(source, /npx --yes hyperframes skills update/)
  assert.match(source, /check-hyperframes[.]sh/)
  assert.doesNotMatch(source, /git clone.*hyperframes/i)
  assert.match(checkSource, /opencode debug skill/)
  assert.match(checkSource, /discovery_file=.*mktemp/)
  assert.doesNotMatch(checkSource, /isolated OpenCode probe/)
  assert.doesNotMatch(checkSource, /cp .*SKILL[.]md/)
  assert.match(checkSource, /skills check --json/)
  assert.match(checkSource, /payload\.updateAvailable === true/)
  assert.doesNotMatch(checkSource, /payload\._meta\?\.updateAvailable/)
  assert.match(checkSource, /Node[.]js 22/)
  assert.match(resolver, /[.]agents\/skills\/hyperframes/)
  assert.match(resolver, /[.]claude\/skills\/hyperframes/)
  assert.doesNotMatch(resolver, /[.]config\/opencode\/skill\/hyperframes/)
  await assert.rejects(access(join(repository, "opencode/skills/hyperframes/SKILL.md")))
  await assert.rejects(access(join(repository, "skills/hyperframes/SKILL.md")))
})

async function writeExecutable(path, content) {
  await writeFile(path, content)
  await chmod(path, 0o755)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}


test("readiness checks the discovered physical installation, not an unrelated default copy", async (t) => {
  for (const activeRoot of [".agents/skills", ".claude/skills", ".config/opencode/skills"]) {
    for (const state of ["current", "stale"]) {
      const f = await fixture(t, { initialState: state, activeRoot })
      if (state === "current") assert.match((await execFileAsync(check, [], { env: f.env })).stdout, /status: READY/)
      else await assert.rejects(execFileAsync(check, [], { env: f.env }), /Command failed/)
      assert.match(await readFile(f.npxLog, "utf8"), new RegExp(`--dir ${escapeRegExp(dirname(await realpath(f.skill)))}`))
    }
  }
  // Resolver preference differs from OpenCode discovery; the discovered copy must win.
  const f = await fixture(t, { initialState: "stale", discoveredRoot: ".claude/skills" })
  const discovered = join(f.env.HOME, ".claude/skills/hyperframes")
  await mkdir(discovered, { recursive: true })
  await writeFile(join(discovered, "SKILL.md"), "fixture-current")
  const result = await execFileAsync(check, [], { env: f.env })
  assert.match(result.stdout, /status: READY/)
  assert.match(await readFile(f.npxLog, "utf8"), new RegExp(`--dir ${escapeRegExp(dirname(await realpath(discovered)))}`))
  await writeFile(join(discovered, "SKILL.md"), "fixture-stale")
  await writeFile(join(f.skill, "SKILL.md"), "fixture-current")
  await assert.rejects(execFileAsync(check, [], { env: f.env }), (error) => {
    assert.match(error.stdout, /status: NOT READY/)
    assert.match(error.stdout, /shared\/global changes require explicit user approval/)
    assert.ok(error.stdout.includes(setup))
    return true
  })
})


test("readiness resolves a discovered skill symlink before selecting its installation parent", async (t) => {
  const f = await fixture(t, { initialState: "current", discoveredRoot: ".config/opencode/skills" })
  const links = join(f.env.HOME, ".config/opencode/skills")
  await mkdir(links, { recursive: true })
  await symlink(f.skill, join(links, "hyperframes"))
  const result = await execFileAsync(check, [], { env: f.env })
  assert.match(result.stdout, /status: READY/)
  assert.match(await readFile(f.npxLog, "utf8"), new RegExp(`--dir ${escapeRegExp(dirname(await realpath(f.skill)))}`))
})
