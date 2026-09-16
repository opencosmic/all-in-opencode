import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { isolatedOpenCodeEnv } from "./support/isolated-opencode.js"

const execFileAsync = promisify(execFile)
const repository = fileURLToPath(new URL("../..", import.meta.url))

function wildcard(value, pattern) {
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = `${escaped.slice(0, -3)}( .*)?`
  return new RegExp(`^${escaped}$`, "s").test(value)
}

function decision(rules, command) {
  return rules.findLast((rule) => rule.permission === "bash" && wildcard(command, rule.pattern))?.action ?? "ask"
}

test("resolved Implementer permissions reserve commit mechanics for category mediation", async (t) => {
  const env = await isolatedOpenCodeEnv(t, repository)
  const { stdout } = await execFileAsync("opencode", ["debug", "agent", "Implementer"], {
    cwd: repository,
    env,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  })
  const rules = JSON.parse(stdout).permission
  const denied = [
    "git merge feature",
    "git rebase main",
    "git reset --hard HEAD",
    "git clean -fd",
    "git switch feature",
    "git checkout feature",
    "git worktree add ../other",
    "git stash push",
    "git branch -D feature",
    "git branch feature",
    "git tag v1.0.0",
    "git push origin main",
  ]
  for (const command of denied) assert.equal(decision(rules, command), "deny", command)
  assert.equal(decision(rules, "ego-browser --help"), "deny")

  for (const command of [
    "git commit -m change",
    "git cherry-pick 0123456789abcdef",
  ]) assert.equal(decision(rules, command), "ask", command)

  const allowed = [
    "git status --short",
    "git diff --check",
    "git log -1",
    "git show HEAD",
    "git rev-parse HEAD",
    "git branch",
    "git branch --show-current",
    "git tag --list",
    "npm test",
  ]
  for (const command of allowed) assert.equal(decision(rules, command), "allow", command)

  const { stdout: browserStdout } = await execFileAsync("opencode", ["debug", "agent", "Browser"], {
    cwd: repository,
    env,
    encoding: "utf8",
  })
  const browserRules = JSON.parse(browserStdout).permission
  assert.equal(decision(browserRules, "ego-browser --help"), "allow")
})
