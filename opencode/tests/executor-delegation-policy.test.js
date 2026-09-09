import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const testDirectory = dirname(fileURLToPath(import.meta.url))
const configDirectory = join(testDirectory, "..")
const repository = join(testDirectory, "../..")

function matches(pattern, value) {
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")
  return new RegExp(`^${expression}$`).test(value)
}

function effectiveAction(rules, permission, value) {
  return rules
    .filter((rule) => rule.permission === permission && matches(rule.pattern, value))
    .at(-1)?.action
}

test("effective Executor policy uses only workflow-owned delegation and Git integration", async () => {
  const { stdout } = await execFileAsync("opencode", ["debug", "agent", "Executor"], {
    cwd: repository,
    env: { ...process.env, OPENCODE_CONFIG_DIR: configDirectory },
    encoding: "utf8",
  })
  const executor = JSON.parse(stdout)

  for (const toolName of [
    "workspace_prepare",
    "delegate_task",
    "task_status",
    "task_output",
    "task_cancel",
    "workspace_release",
  ]) {
    assert.equal(executor.tools[toolName], true, `${toolName} must remain available`)
  }

  assert.equal(executor.tools.task, false)
  assert.equal(effectiveAction(executor.permission, "task", "Plan Reviewer"), "deny")
  assert.equal(effectiveAction(executor.permission, "task", "Implementer"), "deny")
  assert.equal(effectiveAction(executor.permission, "bash", "git worktree add /tmp/fallback"), "deny")
  assert.equal(effectiveAction(executor.permission, "bash", "git worktree remove /tmp/fallback"), "deny")
  assert.equal(effectiveAction(executor.permission, "bash", "git status --short"), "ask")
  assert.equal(
    effectiveAction(executor.permission, "external_directory", "/tmp/delegation/workspaces/task/src/index.js"),
    "allow",
    "Executor must be able to inspect runtime-managed worktrees outside its canonical directory",
  )

  assert.match(executor.prompt, /either `workspace_prepare` or `delegate_task` is unavailable, stop immediately/)
  assert.match(executor.prompt, /Do not substitute manual `git worktree add`\/`git worktree remove`/)
  assert.match(executor.prompt, /manually constructed child sessions/)
  assert.match(executor.prompt, /another implementation framework/)
  assert.match(executor.prompt, /delegate_task\(agent="Plan Reviewer"\)/)
  assert.match(executor.prompt, /delegate_task\(category="git"\)/)
  assert.match(executor.prompt, /Never launch a normal implementation category merely to re-apply/)
  assert.match(executor.prompt, /dynamically presented category and skill catalog/)
  assert.match(executor.prompt, /load_skills=\["ego-browser"\]/)
})
