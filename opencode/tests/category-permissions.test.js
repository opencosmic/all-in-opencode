import test from "node:test"
import assert from "node:assert/strict"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  categoryPermission,
  categorySessionPermission,
  isWatchExternalPath,
  isWatchRuntimeCommand,
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

test("git tool overrides narrow bash without broadening the hard ceiling", () => {
  const defaultRules = categorySessionPermission("git")
  const narrowedRules = categorySessionPermission("git", { bash: false })
  assert.ok(defaultRules.some((rule) => rule.permission === "bash" && rule.action === "allow"))
  assert.equal(narrowedRules.some((rule) => rule.permission === "bash" && rule.action === "allow"), false)
  assert.ok(narrowedRules.some((rule) =>
    rule.permission === "bash" && rule.pattern === "*" && rule.action === "deny"))

  const broadenedRules = categorySessionPermission("git", { edit: true, write: true })
  assert.ok(broadenedRules.some((rule) => rule.permission === "edit" && rule.pattern === "*" && rule.action === "deny"))
  assert.ok(broadenedRules.some((rule) => rule.permission === "write" && rule.pattern === "*" && rule.action === "deny"))
  assert.equal(categoryPermission({ category: "git", tools: { bash: false } }, {
    type: "bash",
    pattern: "git status",
  }), "deny")
})

test("browser tool overrides narrow selected capabilities without broadening the hard ceiling", () => {
  const defaultRules = categorySessionPermission("browser-automation")
  assert.ok(defaultRules.some((rule) => rule.permission === "skill" && rule.pattern === "ego-browser" && rule.action === "allow"))
  assert.ok(defaultRules.some((rule) => rule.permission === "bash" && rule.pattern === "ego-browser *" && rule.action === "allow"))

  const skillNarrowed = categorySessionPermission("browser-automation", { skill: false })
  assert.equal(skillNarrowed.some((rule) => rule.permission === "skill" && rule.action === "allow"), false)
  assert.equal(categoryPermission({ category: "browser-automation", tools: { skill: false } }, {
    type: "skill",
    pattern: "ego-browser",
  }), "deny")

  const bashNarrowed = categorySessionPermission("browser-automation", { bash: false })
  assert.equal(bashNarrowed.some((rule) => rule.permission === "bash" && rule.action === "allow"), false)
  assert.equal(categoryPermission({ category: "browser-automation", tools: { bash: false } }, {
    type: "bash",
    pattern: "ego-browser --version",
  }), "deny")

  const broadenedRules = categorySessionPermission("browser-automation", { edit: true, write: true, bash: true, skill: true })
  assert.ok(broadenedRules.some((rule) => rule.permission === "edit" && rule.pattern === "*" && rule.action === "deny"))
  assert.ok(broadenedRules.some((rule) => rule.permission === "write" && rule.pattern === "*" && rule.action === "deny"))
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

test("Git and browser categories use the shared contract plus category context", () => {
  const contract = systemFor("Implementer", "git")
  assert.match(contract, /project-owned Implementer/)
  assert.doesNotMatch(contract, /operating under the git category/)
  assert.match(systemFor("Implementer", "git", {
    prompt_append: "<Category_Context name=\"git\">caller owns integration-order</Category_Context>",
  }), /caller owns integration-order/)
  const gitPrompt = systemFor("Implementer", "git", {
    prompt_append: "<Category_Context name=\"git\">perform the authorized task-local commit</Category_Context>",
  })
  assert.doesNotMatch(gitPrompt, /Do not commit/)
  assert.match(gitPrompt, /authorized task-local commit/)
  const browser = systemFor("Implementer", "browser-automation", {
    prompt_append: "<Category_Context name=\"browser-automation\">fresh browser state</Category_Context>",
  })
  assert.match(browser, /project-owned Implementer/)
  assert.match(browser, /fresh browser state/)
  assert.doesNotMatch(browser, /operating under the browser-automation category/)
})

test("video analysis admits only the selected watch runtime and safe output paths", () => {
  const skillPath = "/Users/example/.agents/skills/watch/SKILL.md"
  const profile = {
    category: "video-analysis",
    tools: { skill: true, bash: true },
    skill_names: ["watch"],
    skill_paths: [skillPath],
  }
  assert.equal(categoryPermission(profile, { type: "skill", pattern: "watch" }), "allow")
  assert.equal(categoryPermission(profile, { type: "skill", pattern: "ego-browser" }), "deny")
  assert.equal(isWatchRuntimeCommand(`python3 "/Users/example/.agents/skills/watch/scripts/watch.py" video.mp4`, [skillPath]), true)
  assert.equal(isWatchRuntimeCommand(`python3 /Users/example/.agents/skills/watch/scripts/setup.py --json`, [skillPath]), true)
  assert.equal(isWatchRuntimeCommand("python3 /tmp/unrelated.py", [skillPath]), false)
  assert.equal(categoryPermission(profile, {
    type: "bash",
    pattern: `python3 "/Users/example/.agents/skills/watch/scripts/watch.py" video.mp4`,
  }), "allow")
  for (const command of [
    `python3 "/Users/example/.agents/skills/watch/scripts/watch.py" video.mp4 --start 10 --end 20`,
    `python3 "/Users/example/.agents/skills/watch/scripts/watch.py" video.mp4 --detail efficient --max-frames 5`,
  ]) assert.equal(categoryPermission(profile, { type: "bash", pattern: command }), "allow", command)
  for (const command of [
    `python3 "/Users/example/.agents/skills/watch/scripts/watch.py" video.mp4 --out-dir /tmp/custom`,
    `python3 "/Users/example/.agents/skills/watch/scripts/watch.py" video.mp4 --out-dir=/some/path`,
    `python3 "/Users/example/.agents/skills/watch/scripts/watch.py" video.mp4 --out-dir ${process.cwd()}`,
  ]) assert.equal(categoryPermission(profile, { type: "bash", pattern: command }), "deny", command)
  assert.equal(categoryPermission(profile, { type: "bash", pattern: "rm -rf /tmp/watch-output" }), "deny")
  assert.equal(categoryPermission(profile, { type: "bash", pattern: "git commit -m escape" }), "deny")
  assert.equal(categoryPermission({
    ...profile,
    skill_names: ["watch", "unrelated"],
    selected_skills: [
      { name: "watch", path: skillPath },
      { name: "unrelated", path: "/Users/example/.agents/skills/unrelated/SKILL.md" },
    ],
  }, {
    type: "bash",
    pattern: "python3 /Users/example/.agents/skills/unrelated/scripts/watch.py input",
  }), "deny")
  assert.equal(isWatchExternalPath("/Users/example/.agents/skills/watch/scripts/watch.py", [skillPath]), true)
  assert.equal(isWatchExternalPath(join(tmpdir(), "watch-fixture", "frames", "0001.jpg"), [skillPath]), true)
  assert.equal(isWatchExternalPath(join("/Users/example", "watch-private", "frames", "0001.jpg"), [skillPath]), false)
  assert.equal(isWatchExternalPath(`${tmpdir()}/watch-fixture/.env`, [skillPath]), false)
  assert.equal(isWatchExternalPath("/tmp/secret.txt", [skillPath]), false)
  const rules = categorySessionPermission("video-analysis", profile.tools, [{ name: "watch", path: skillPath }])
  assert.ok(rules.some((rule) => rule.permission === "skill" && rule.pattern === "watch" && rule.action === "allow"))
  assert.ok(rules.some((rule) => rule.permission === "bash" && rule.pattern.includes("scripts/watch.py") && rule.action === "allow"))
  assert.ok(rules.some((rule) => rule.permission === "bash" && rule.pattern.includes("--out-dir") && rule.action === "deny"))
  assert.ok(rules.some((rule) => rule.permission === "external_directory" && rule.pattern === `${tmpdir()}/watch-*` && rule.action === "allow"))
  assert.equal(rules.some((rule) => rule.permission === "external_directory" && rule.pattern === "*/watch-*"), false)
  assert.ok(rules.some((rule) => rule.permission === "external_directory" && rule.pattern === "/Users/example/.agents/skills/watch/*" && rule.action === "allow"))
  assert.ok(rules.some((rule) => rule.permission === "bash" && rule.pattern === "*" && rule.action === "deny"))
})

test("sensitive categories preserve session permissions instead of replacing them with prompt tool flags", () => {
  assert.equal(toolsFor("Implementer", { edit: false, bash: true }, "git"), undefined)
  assert.equal(toolsFor("Implementer", { edit: false, bash: true }, "browser-automation"), undefined)
  assert.deepEqual(toolsFor("Implementer", { edit: false }, "quick"), {
    edit: false,
    workspace_prepare: false,
    execution_preflight: false,
    delegate_task: false,
    task_status: false,
    task_output: false,
    task_cancel: false,
    workspace_release: false,
    task: false,
  })
})
