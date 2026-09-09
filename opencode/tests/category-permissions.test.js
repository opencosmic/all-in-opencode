import test from "node:test"
import assert from "node:assert/strict"

import {
  categoryPermission,
  categorySessionPermission,
  isSafeGitCommand,
} from "../plugins/delegation/category-permissions.js"
import { systemFor, toolsFor } from "../plugins/delegation/session-runner.js"

test("git category allows bounded mechanics and denies destructive operations", () => {
  for (const command of [
    "git status --short",
    "git diff --check",
    "git log -1",
    "git show HEAD",
    "git rev-parse HEAD",
    "git branch --show-current",
    "git add -- src/a.js",
    "git commit -m task-scoped-change",
    "git cherry-pick 0123456789abcdef",
  ]) assert.equal(isSafeGitCommand(command), true, command)

  for (const command of [
    "git reset --hard HEAD",
    "git clean -fd",
    "git worktree remove --force /tmp/ws",
    "git branch -D task",
    "git push --force origin main",
    "git rebase main",
    "git merge feature",
    "git commit --amend -m rewrite",
    "git add src/a.js && git commit -m unsafe-compound",
    "git status; rm -rf .git",
    "git status\ngit push origin main",
    "rm -rf .git",
  ]) assert.equal(isSafeGitCommand(command), false, command)
})

test("sensitive category sessions receive fail-closed session permissions", () => {
  const gitRules = categorySessionPermission("git")
  assert.ok(gitRules.some((rule) =>
    rule.permission === "bash" && rule.pattern === "*" && rule.action === "deny"))
  assert.ok(gitRules.some((rule) =>
    rule.permission === "bash" && rule.pattern === "git commit *" && rule.action === "allow"))
  assert.ok(gitRules.some((rule) =>
    rule.permission === "bash" && rule.pattern === "git commit *--amend*" && rule.action === "deny"))
  assert.ok(gitRules.some((rule) =>
    rule.permission === "bash" && rule.pattern === "git cherry-pick --*" && rule.action === "deny"))
  const browserRules = categorySessionPermission("browser-automation")
  assert.ok(browserRules.some((rule) =>
    rule.permission === "skill" && rule.pattern === "ego-browser" && rule.action === "allow"))
  assert.ok(browserRules.some((rule) =>
    rule.permission === "bash" && rule.pattern === "ego-browser *" && rule.action === "allow"))
  assert.ok(browserRules.some((rule) =>
    rule.permission === "bash" && rule.pattern === "*" && rule.action === "deny"))
  assert.equal(categorySessionPermission("quick"), undefined)
})

test("permission decisions are scoped to the exact category session", () => {
  const request = { type: "bash", pattern: "git commit -m reviewed-task" }
  assert.equal(categoryPermission({ category: "git" }, request), "allow")
  assert.equal(categoryPermission({ category: "quick" }, request), "deny")
  assert.equal(categoryPermission(undefined, request), null)
  assert.equal(categoryPermission({ category: "git" }, { type: "bash", pattern: "git reset --hard HEAD" }), "deny")
  assert.equal(categoryPermission({ category: "git" }, {
    permission: "bash",
    patterns: ["git commit -m reviewed-task"],
  }), "allow")
  assert.equal(categoryPermission({ category: "git" }, {
    permission: "bash",
    patterns: ["git add src/a.js", "git commit -m reviewed-task"],
    metadata: { command: "git add src/a.js && git commit -m reviewed-task" },
  }), "deny")
})

test("git category receives a focused contract instead of the normal mutation contract", () => {
  const contract = systemFor("Implementer", "git")
  assert.match(contract, /operating under the git category/)
  assert.match(contract, /caller owns branch, commit, integration-order/)
  assert.match(contract, /Never reset, clean, stash, force-remove/)
})

test("sensitive categories preserve session permissions instead of replacing them with prompt tool flags", () => {
  assert.equal(toolsFor("Implementer", { edit: false, bash: true }, "git"), undefined)
  assert.equal(toolsFor("Implementer", { edit: false, bash: true }, "browser-automation"), undefined)
  assert.deepEqual(toolsFor("Implementer", { edit: false }, "quick"), {
    edit: false,
    workspace_prepare: false,
    delegate_task: false,
    task_status: false,
    task_output: false,
    task_cancel: false,
    workspace_release: false,
    task: false,
  })
})
