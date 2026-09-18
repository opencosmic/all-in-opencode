import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { isolatedOpenCodeEnv } from "./support/isolated-opencode.js"

const here = dirname(fileURLToPath(import.meta.url))
const repository = resolve(here, "../..")
const execFileAsync = promisify(execFile)

test("Browser is a dedicated primary route with backend-only permissions", async () => {
  const source = await readFile(`${repository}/opencode/agents/browser.md`, "utf8")
  assert.match(source, /^name: Browser$/m)
  assert.match(source, /^mode: primary$/m)
  assert.match(source, /^  "\*": deny$/m)
  assert.doesNotMatch(source, /^  delegate_task: allow$/m)
  assert.match(source, /^  edit: deny$/m)
  assert.match(source, /^  write: deny$/m)
  assert.match(source, /skill:\n    "\*": deny\n    "ego-browser": allow/)
  assert.match(source, /bash:\n    "\*": deny\n    "ego-browser \*": allow/)
  assert.match(source, /Task Space/i)
  assert.match(source, /passively observe/i)
  assert.match(source, /task\.finish\(\{ keep: \["p1"\] \}\)/)
  assert.match(source, /task\.finish\(\{ keep: \[\] \}\)/)
  assert.match(source, /wait for explicit user confirmation/i)
  assert.match(source, /Never automatically take control back/i)
  assert.match(source, /cookies, session tokens, passwords, credentials/i)
  assert.match(source, /not an OS-level security sandbox/i)
  assert.match(source, /Do not modify application source code or workflow artifacts/i)
  assert.doesNotMatch(source, /oh-my-openagent|call_omo_agent|background_output|background_cancel|Sisyphus-Junior/i)
})

test("Browser's effective primary route keeps delegate_task denied", async (t) => {
  const env = await isolatedOpenCodeEnv(t, repository)
  const { stdout } = await execFileAsync("opencode", ["debug", "agent", "Browser"], { env, encoding: "utf8" })
  const agent = JSON.parse(stdout)
  const rules = agent.permission ?? []
  let action
  for (const rule of rules) {
    if ((rule.permission === "*" || rule.permission === "delegate_task") && rule.pattern === "*") action = rule.action
  }

  assert.equal(agent.name, "Browser")
  assert.equal(agent.mode, "primary")
  assert.equal(action, "deny")
})

test("/browser is the neutral dedicated command and keeps the external skill external", async () => {
  const source = await readFile(`${repository}/opencode/commands/browser.md`, "utf8")
  assert.match(source, /^agent: Browser$/m)
  assert.match(source, /^subtask: false$/m)
  assert.match(source, /official upstream `ego-browser` skill/i)
  assert.match(source, /passive observation does not require a handoff/i)
  assert.match(source, /must never be used as a generic shell/i)
  assert.doesNotMatch(source, /oh-my-openagent|call_omo_agent|Sisyphus-Junior/i)
})
