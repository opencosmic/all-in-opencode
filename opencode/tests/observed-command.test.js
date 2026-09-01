import test from "node:test"
import assert from "node:assert/strict"
import { runObservedCommand } from "../../scripts/lib/observed-command.mjs"

const node = process.execPath
const observed = (source, options = {}) => runObservedCommand(node, ["-e", source], { timeout: 2_000, grace: 40, ...options })

test("observed command distinguishes normal JSON exit, complete-output hang, partial output, no output, and failure", async () => {
  const normal = await observed('console.log(JSON.stringify({agent:"ok"}))')
  assert.equal(normal.jsonComplete, true); assert.equal(normal.processExited, true); assert.equal(normal.timedOut, false)
  const complete = await observed('console.log(JSON.stringify({agent:"ok"})); setInterval(() => {}, 1000)', { timeout: 500 })
  assert.equal(complete.jsonComplete, true); assert.equal(complete.timedOut, true)
  const partial = await observed('process.stdout.write("{\\\"agent\\\":"); setInterval(() => {}, 1000)', { timeout: 500 })
  assert.equal(partial.jsonComplete, false); assert.equal(partial.timedOut, true)
  const silent = await observed('setInterval(() => {}, 1000)', { timeout: 500 })
  assert.equal(silent.outputStarted, false); assert.equal(silent.jsonComplete, false); assert.equal(silent.timedOut, true)
  const failure = await observed('console.error("failure"); process.exit(2)')
  assert.equal(failure.exitCode, 2); assert.match(failure.stderr, /failure/)
})

test("observed command terminates only its detached diagnostic process group", async () => {
  const source = `
    const { spawn } = require("node:child_process")
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
    console.log(JSON.stringify({ agent: "ok" }))
    setInterval(() => {}, 1000)
  `
  const result = await observed(source, { timeout: 500 })
  assert.equal(result.timedOut, true)
  assert.deepEqual(result.cleanupSnapshot?.directChildren, [])
})
