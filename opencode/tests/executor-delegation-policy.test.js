import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { isolatedOpenCodeEnv } from "./support/isolated-opencode.js"

const execFileAsync = promisify(execFile)
const testDirectory = dirname(fileURLToPath(import.meta.url))
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

test("effective Executor policy uses only project-owned delegation and Git integration", async (t) => {
  const env = await isolatedOpenCodeEnv(t, repository)
  const { stdout } = await execFileAsync("opencode", ["debug", "agent", "Executor"], {
    cwd: repository,
    env,
    encoding: "utf8",
  })
  const executor = JSON.parse(stdout)

  for (const toolName of [
    "execution_preflight",
    "workspace_prepare",
    "workspace_checkpoint_update",
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
  assert.equal(effectiveAction(executor.permission, "bash", "git switch main"), "ask")
  assert.equal(effectiveAction(executor.permission, "bash", "git merge --ff-only feature"), "ask")
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
  assert.match(executor.prompt, /execution_preflight/)
  assert.match(executor.prompt, /workspace_checkpoint_update/)
  assert.match(executor.prompt, /must provide the execution task's `TaskRegistry` `task_id`/)
  assert.match(executor.prompt, /must resolve to an existing TaskRegistry task/)
  assert.match(executor.prompt, /Planner task boundaries do not imply branch, worktree, or agent boundaries/)
  assert.match(executor.prompt, /Worktree is an isolation\/concurrency mechanism, not the default unit of work/)
  assert.match(executor.prompt, /protected base branches such as `main` or `master`/)
  assert.match(executor.prompt, /A clean and unowned protected checkout may become the in-place Primary feature branch/)
  assert.match(executor.prompt, /dirty protected checkout may become the in-place Primary only after Executor has reconciled and explicitly declared that the dirty state belongs to this logical change \(`dirty_ownership="same-change"`\)/)
  assert.match(executor.prompt, /dirty ownership is unrelated, unknown, mixed, or the checkout is actively owned/)
  assert.match(executor.prompt, /preserve\/isolate according to existing safety behavior/)
  assert.match(executor.prompt, /Prefer reuse and serialization by default/)
  assert.match(executor.prompt, /delegate_task\(category="git"\)/)
  assert.match(executor.prompt, /During normal execution, task-local commits and source-derived child-to-Primary integration require/)
  assert.match(executor.prompt, /final protected-base local integration is the narrow `\/ship` exception/)
  assert.match(executor.prompt, /fresh shipping verification and the user's explicit `merge locally` choice/)
  assert.match(executor.prompt, /directly performs the confirmed-base switch and `--ff-only` merge under its existing ask-level Bash permission/)
  assert.match(executor.prompt, /Do not delegate the final protected-base switch\/merge to `category="git"`/)
  assert.match(executor.prompt, /Never make this exception available during `\/execute`/)
  assert.match(executor.prompt, /For Executor, use `Plan Reviewer`, `Reviewer`, `QA`, `Verifier`, and `Blender`/)
  assert.match(executor.prompt, /Never launch a normal implementation category merely to re-apply/)
  assert.match(executor.prompt, /dynamically presented category and skill catalog/)
  assert.match(executor.prompt, /delegate_task\(category="browser-testing"\)/)
  assert.match(executor.prompt, /delegate_task\(agent="Blender"\)/)
  assert.match(executor.prompt, /GLB\/glTF\/FBX export/s)
  assert.match(executor.prompt, /React, Three\.js\s+application code/s)
  assert.match(executor.prompt, /normal boundary is not\s+`Executor -> Blender -> Implementer`/s)
  assert.match(executor.prompt, /browser-visible runtime verification/)
  assert.match(executor.prompt, /external `agent-browser` CLI/)
  assert.match(executor.prompt, /existing project-native framework/)
  assert.match(executor.prompt, /make Playwright the default/)
  assert.doesNotMatch(executor.prompt, /browser-automation/)
  assert.doesNotMatch(executor.prompt, /load_skills=\["ego-browser"\]/)
  assert.match(executor.prompt, /explicitly selected skill is unavailable/)
  assert.match(executor.prompt, /do not retry the same assignment with `load_skills` omitted/)
  assert.match(executor.prompt, /unrelated transient delegation failures/)
})
