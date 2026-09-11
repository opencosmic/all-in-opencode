import test from "node:test"
import assert from "node:assert/strict"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repository = fileURLToPath(new URL("../..", import.meta.url))
const setup = join(repository, "scripts/setup-blender-mcp.sh")
const check = join(repository, "scripts/check-blender-mcp.sh")

async function executable(path, source) {
  await writeFile(path, source)
  await chmod(path, 0o755)
}

async function fixture(t, { runtime = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "blender-mcp-provisioning-test-"))
  const home = join(root, "home with spaces")
  const bin = join(root, "bin with spaces")
  const log = join(root, "uvx.log")
  await mkdir(home, { recursive: true })
  await mkdir(bin, { recursive: true })
  t.after(() => rm(root, { recursive: true, force: true }))

  if (runtime) {
    await executable(join(bin, "uv"), "#!/bin/sh\nexit 0\n")
    await executable(
      join(bin, "uvx"),
      "#!/bin/sh\n" +
        "printf '%s\\n' \"$*\" > \"$BLENDER_MCP_LOG\"\n" +
        "printf 'UV_PYTHON_PREFERENCE=%s\\n' \"${UV_PYTHON_PREFERENCE:-}\" >> \"$BLENDER_MCP_LOG\"\n" +
        "exit 0\n",
    )
  }

  return {
    home,
    log,
    env: {
      ...process.env,
      HOME: home,
      BLENDER_MCP_LOG: log,
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    },
  }
}

test("authored Blender MCP configuration preserves the security defaults", async () => {
  const config = await readFile(join(repository, "opencode/opencode.jsonc"), "utf8")
  assert.match(config, /"blender"\s*:\s*\{[\s\S]*?"type"\s*:\s*"local"/)
  assert.match(config, /"uvx"[\s\S]*?"--python"[\s\S]*?"3\.11"[\s\S]*?"blender-mcp"/)
  assert.match(config, /"UV_PYTHON_PREFERENCE"\s*:\s*"only-managed"/)
  assert.match(config, /"BLENDER_HOST"\s*:\s*"localhost"/)
  assert.match(config, /"BLENDER_PORT"\s*:\s*"9876"/)
  assert.match(config, /"BLENDER_MCP_SAFE_MODE"\s*:\s*"1"/)
  assert.match(config, /"DISABLE_TELEMETRY"\s*:\s*"true"/)
  assert.match(config, /"codegraph"[\s\S]*?"codegraph"[\s\S]*?"serve"[\s\S]*?"--mcp"/)
})

test("setup uses upstream install-addon with managed Python 3.11", async (t) => {
  const { env, log } = await fixture(t)
  const result = await execFileAsync(setup, [], { env, encoding: "utf8" })
  const invocation = await readFile(log, "utf8")

  assert.match(invocation, /^--python 3\.11 blender-mcp install-addon$/m)
  assert.match(invocation, /UV_PYTHON_PREFERENCE=only-managed/)
  assert.match(result.stdout, /enable Interface: MCP for Blender/i)
  assert.match(result.stdout, /Start the MCP server on localhost:9876/i)
  assert.doesNotMatch(invocation, /git clone|install.*package manager/i)
})

test("setup fails clearly when uv tooling is missing", async (t) => {
  const { env } = await fixture(t, { runtime: false })
  await assert.rejects(
    execFileAsync(setup, [], { env, encoding: "utf8" }),
    (error) => {
      assert.equal(error.code, 1)
      assert.match(error.stderr, /uv is required|uvx is required/)
      assert.match(error.stderr, /official uv installer/i)
      return true
    },
  )
})

test("check is read-only, reports configuration, and does not require Blender", async (t) => {
  const { env } = await fixture(t)
  const result = await execFileAsync(check, [], { env, encoding: "utf8" })
  assert.match(result.stdout, /OpenCode Blender MCP: configured/)
  assert.match(result.stdout, /Socket policy: localhost:9876 only/)
  assert.match(result.stdout, /Safe Mode: ON/)
  assert.match(result.stdout, /Telemetry: OFF/)
  assert.match(result.stdout, /connectivity: not probed/i)

  const source = await readFile(check, "utf8")
  assert.doesNotMatch(source, /install-addon/)
  assert.doesNotMatch(source, /(^|[[:space:];])(?:rm|mv|cp|mkdir|touch)[[:space:]]/)
  assert.doesNotMatch(source, /blender-mcp[[:space:]]+(?:install|update)/i)
})
