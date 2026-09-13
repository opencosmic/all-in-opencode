import test from "node:test"
import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"

const root = "/Users/code/.config/opencode"

async function text(path) {
  return readFile(`${root}/${path}`, "utf8")
}

test("execute policy always requires a new current-artifact review", async () => {
  const command = await text("commands/execute.md")
  const agent = await text("agents/executor.md")
  assert.match(command, /Re-read the current proposal, specs, design, and tasks/)
  assert.match(command, /obtain a new `Plan Reviewer` approval/)
  assert.match(agent, /Dispatch a fresh `Plan Reviewer`/)
  assert.match(agent, /Continue only on `\[APPROVED\]`/)
  assert.doesNotMatch(agent, /If no trustworthy current Plan Reviewer result is available/)
})

test("ship policy always obtains a new verifier verdict from the current tree", async () => {
  const command = await text("commands/ship.md")
  assert.match(command, /ALWAYS dispatch a new `Verifier`/)
  assert.match(command, /previous .*`VERIFIED` message is advisory only/is)
  assert.match(command, /code, artifact, base, or worktree change.*stale/is)
  assert.match(command, /`VERIFIED`: the fresh verdict is shipping authorization/)
  assert.match(command, /`VERIFIED_WITH_CONCERNS`: stop before archive or integration/)
  assert.match(command, /explicitly accepts the exact named concerns/)
  assert.match(command, /That acceptance is shipping authorization for this unchanged state/)
  assert.match(command, /does not change the verdict to `VERIFIED`/)
  assert.match(command, /this change, HEAD, branch\/worktree, comparison basis, current artifacts, current diff, and named concern set/)
  assert.match(command, /A decline stops shipping/)
  assert.match(command, /Do not infer acceptance from ambiguous language/)
  assert.match(command, /`BLOCKED`: stop.*Do not archive, integrate, offer a bypass, or ask for risk acceptance/is)
})

test("verifier preserves concern-bearing verdicts and leaves risk acceptance to ship", async () => {
  const command = await text("commands/verify.md")
  const agent = await text("agents/verifier.md")
  assert.match(command, /`VERIFIED` may proceed directly to shipping authorization/)
  assert.match(command, /`VERIFIED_WITH_CONCERNS` requires `\/ship` to obtain explicit acceptance of the exact current named concerns/)
  assert.match(command, /`BLOCKED` cannot proceed/)
  assert.match(agent, /Acceptance does not alter this verdict or erase its concerns/)
  assert.match(agent, /not to reclassify it as `VERIFIED`/)
  assert.match(agent, /never permits a shipping bypass/)
})

test("executor owns checkbox changes and rejects forbidden worker state diffs", async () => {
  const agent = await text("agents/executor.md")
  const implementer = await text("agents/implementer.md")
  assert.match(agent, /only direct persistent edit is the active change's task checkboxes/)
  assert.match(agent, /inspect the diff and changed paths/)
  assert.match(agent, /Reject wrong-workspace or forbidden workflow-state mutation/)
  assert.match(agent, /only then update `tasks.md`/)
  assert.match(implementer, /Do not .*edit `openspec\/\*\*`/)
})

test("verification can recover without historical conversation state", async () => {
  const command = await text("commands/verify.md")
  const agent = await text("agents/verifier.md")
  assert.match(command, /Missing historical review messages are not a blocker by themselves/)
  assert.match(agent, /Historical messages and repair receipts are supplementary evidence, not canonical state/)
  assert.match(agent, /Independently inspect and re-prove the current tree with fresh evidence/)
  assert.doesNotMatch(agent, /absence of a repair receipt is not evidence/)
})

test("planner derives topology and concurrency only from observable structure", async () => {
  const command = await text("commands/plan.md")
  const agent = await text("agents/planner.md")
  assert.match(agent, /dependency graph and execution waves/)
  assert.match(agent, /write-scope overlap/)
  assert.match(agent, /shared APIs, contracts, schemas, migrations, and mutable state/)
  assert.match(agent, /`SAFE_TO_PARALLELIZE` or `MUST_SERIALIZE`/)
  assert.match(agent, /Executor decides runtime concurrency among ready tasks/)
  assert.match(agent, /Do not estimate task duration to justify parallelism/)
  assert.match(agent, /all implementation task checkboxes remain unchecked/)
  assert.match(command, /Never estimate duration or guessed time savings/)
  assert.match(command, /Keep every implementation checkbox unchecked/)
})

test("spec places the workspace before creating canonical OpenSpec state", async () => {
  const command = await text("commands/spec.md")
  assert.match(command, /before persistent artifacts/)
  assert.match(command, /Before `openspec init`, `openspec new change`, or any proposal\/spec write/)
  assert.match(command, /submodule does not count/)
  assert.match(command, /stop before writing/)
  assert.match(command, /do not use OpenCode session `moveChanges`/i)
  assert.match(command, /create no topology ledger or workspace-state file/)
})

test("spec refuses a change-worktree handoff when strategy content is not in the intended base", async () => {
  const command = await text("commands/spec.md")
  assert.match(command, /selected strategy path and intended worktree base/)
  assert.match(command, /require `strategySource\.availableFromBase: true`/)
  assert.match(command, /tracked-and-clean strategy available from that base may proceed/)
  assert.match(command, /strategy is untracked, modified from the intended base, missing\/absent from that base/)
  assert.match(command, /STOP before writing any OpenSpec artifact/i)
  assert.match(command, /require an explicit user decision/)
  assert.match(command, /preserve\/commit the strategy source first[\s\S]*or continue `IN_PLACE`/)
  assert.match(command, /never silently commit, stash, copy, move, delete/)
  assert.match(command, /do not use OpenCode session `moveChanges`/i)
})

test("executor owns adaptive topology, baseline, worker workspace, and lifecycle", async () => {
  const command = await text("commands/execute.md")
  const agent = await text("agents/executor.md")
  assert.match(agent, /Use the simplest safe topology/)
  assert.match(agent, /Use `workspace_prepare` when a task needs a new isolated workspace/)
  assert.match(agent, /Never substitute a caller-selected directory for a `workspace_id`/)
  assert.match(agent, /Serialize tasks with dependency edges, overlapping writes/)
  assert.match(agent, /preserve isolated workspaces/)
  assert.match(command, /capture its baseline/)
  assert.match(command, /preserve failed, cancelled, interrupted, dirty, or ambiguous workspaces/)
})

test("delegation runtime owns isolation while Executor owns integration", async () => {
  const command = await text("commands/execute.md")
  const agent = await text("agents/executor.md")
  assert.match(agent, /All-in OpenCode Delegation Runtime owns isolated workspace and child-session lifecycle/)
  assert.match(agent, /categories to `Implementer`/)
  assert.match(agent, /route read-only inspection to `Reviewer` or `QA`/)
  assert.match(agent, /The runtime never decides what to stage, commit, integrate, or check/)
  assert.match(agent, /`workspace_release` uses normal Git removal and safe branch deletion/)
  assert.match(agent, /Never force-remove, force-delete, reset, or clean/)
  assert.match(command, /Executor alone decides integration order and scope/)
  assert.match(agent, /git category only executes the operation you explicitly select/)
})

test("ship keeps its exact menu and applies provenance-aware conservative cleanup", async () => {
  const command = await text("commands/ship.md")
  const menu = command.match(/^\d\. .+$/gm)
  assert.deepEqual(menu, ["1. merge locally", "2. push + PR", "3. keep branch"])
  assert.match(command, /ALWAYS dispatch a new `Verifier`/)
  assert.match(command, /KEEP the worktree for CI\/review fixes/)
  assert.match(command, /Unknown\/external worktrees are never auto-deleted/)
  assert.match(command, /do not force it/)
  assert.match(command, /verify the merged result/)
  assert.match(command, /Do not infer merge, push, PR, deploy, cleanup, sync, or archive intent/)
})

test("ship invalidates pre-archive verification and re-verifies before integration", async () => {
  const command = await text("commands/ship.md")
  assert.match(command, /archive or sync mutation of an OpenSpec artifact invalidates the pre-archive Verifier verdict and any pre-archive concern acceptance/)
  assert.match(command, /ALWAYS dispatch a NEW fresh `Verifier`/)
  assert.match(command, /post-archive current artifacts\/tree\/diff before any merge or push/)
  assert.match(command, /`VERIFIED` permits the selected integration to continue/)
  assert.match(command, /`VERIFIED_WITH_CONCERNS` stops, presents the NEW\/current named concerns, and requires NEW explicit acceptance before the integration menu/)
  assert.match(command, /Never reuse a pre-mutation acceptance/)
  assert.match(command, /`BLOCKED` stops with no integration, acceptance, or bypass/)
  assert.deepEqual(command.match(/^\d\. .+$/gm), ["1. merge locally", "2. push + PR", "3. keep branch"])
})

test("active custom workflow creates no second durable state system", async () => {
  const forbiddenFiles = /parallel-progress\.json|workspace-state\.json|worktree-state|worktree-ledger/i
  for (const directory of ["agents", "commands", "plugins"]) {
    const files = (await readdir(`${root}/${directory}`)).filter(
      (name) => !name.includes(".bak.") && /\.(?:md|js)$/.test(name),
    )
    for (const file of files) {
      assert.doesNotMatch(await readFile(`${root}/${directory}/${file}`, "utf8"), forbiddenFiles)
    }
  }

  const executor = await text("agents/executor.md")
  const execute = await text("commands/execute.md")
  assert.match(executor, /OpenSpec `tasks\.md` is the only durable execution-progress source of truth/)
  assert.match(executor, /Never create or rely on another workflow-progress ledger/)
  assert.match(execute, /Use `tasks\.md` as the only durable task-progress source of truth/)
  assert.match(executor, /Naming alone never proves ownership/)
})
