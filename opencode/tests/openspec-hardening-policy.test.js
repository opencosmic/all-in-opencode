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
  assert.match(command, /Every invocation must independently reread and validate/)
  assert.match(command, /prior `\[APPROVED\]`.*advisory only/is)
  assert.match(agent, /ALWAYS dispatch a new `Plan Reviewer` for this invocation/)
  assert.match(agent, /fresh `\[REJECTED\]` stops execution/)
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
  assert.match(agent, /WORKFLOW STATE IS READ-ONLY/)
  assert.match(agent, /Do not modify anything under `openspec\/\*\*`, `\.omo\/\*\*`, or `\.product\/\*\*`/)
  assert.match(agent, /inspect the actual changed-path set and diff attributable to that dispatch/)
  assert.match(agent, /reject the worker result, do not complete or reopen any task/)
  assert.match(agent, /Only after implementation, verification, review, and applicable QA pass may you edit/)
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
  assert.match(agent, /Executor decides runtime concurrency among ready lanes/)
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
  assert.match(agent, /Reuse an already suitable linked worktree before creating anything/)
  assert.match(agent, /Prefer an OpenCode-native worktree\/workspace/)
  assert.match(agent, /Manual `git worktree` is fallback only/)
  assert.match(agent, /`PRE_EXISTING_BASELINE_FAILURE` from `WORKER_REGRESSION`/)
  assert.match(agent, /WORKSPACE: `<absolute path>`/)
  assert.match(agent, /Do not create, delete, reset, merge, or clean worktrees/)
  assert.match(agent, /tasks\.md` remains the only durable custom execution-progress state/)
  assert.match(agent, /`LANE_ISOLATION_ELIGIBLE` label merely permits consideration/)
  assert.match(agent, /`EPHEMERAL_SANDBOX` is a disposable detached worktree technique/)
  assert.match(command, /one canonical OpenSpec change directory/)
  assert.match(command, /Never silently commit, copy, delete, stash, or migrate/)
})

test("lane worktrees require exact runtime and topology gates while sandboxes stay disabled", async () => {
  const command = await text("commands/execute.md")
  const agent = await text("agents/executor.md")
  assert.match(agent, /`LANE_WORKTREES` is implemented but has two mandatory gates/)
  assert.match(agent, /Exact runtime capability/)
  assert.match(agent, /Current task independence/)
  assert.match(agent, /currently installed production OMO 4\.19\.4 has no adopted evidence/)
  assert.match(agent, /task API's `directory` field/)
  assert.match(agent, /`git merge --no-ff --no-edit <lane-branch>`/)
  assert.match(agent, /Do not persist a lane ledger/)
  assert.match(agent, /If normal removal refuses, stop/)
  assert.match(agent, /Worker-driven use is capability-gated by the same proof/)
  assert.match(agent, /never send a normal category worker to a sibling sandbox based only on a prompt path/)
  assert.match(command, /prompt path alone is not actual cwd binding/)
  assert.match(command, /`LANE_WORKTREES` is implemented but remains behind both gates/)
  assert.match(command, /directory=<absolute lane worktree>/)
  assert.match(command, /`EPHEMERAL_SANDBOX` remains disabled and unimplemented/)
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
  assert.match(executor, /Never create, read as workflow state, or rely on:[\s\S]*`\.superpowers\/sdd\/\*\*`/)
  assert.match(executor, /must not copy or enter Atlas's Boulder\/notepad state machine/)
  assert.match(execute, /Never create or use[\s\S]*OMO Team task state/)
  assert.match(executor, /OpenSpec `tasks\.md` is your only durable progress state/)
})
