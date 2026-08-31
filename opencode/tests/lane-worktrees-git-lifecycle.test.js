import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

import {
  assessLaneCleanup,
  assessWaveCompletion,
  buildIntegrationPlan,
  inspectLaneResult,
  planLaneCreation,
  validateLaneCreation,
} from "../../scripts/lib/lane-worktrees.mjs"
import { STATUS } from "../../scripts/probes/worktree-isolation.mjs"

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
}

function commitFile(cwd, path, contents, message) {
  writeFileSync(join(cwd, path), contents)
  git(cwd, "add", path)
  git(cwd, "commit", "-m", message)
}

function task(id, order, path) {
  return {
    id,
    order,
    checked: false,
    objective: `write ${path}`,
    writeScopes: [path],
    qaRequired: false,
  }
}

test("real Git lanes share a baseline, integrate in task order, gate the dependent task, and clean normally", () => {
  const fixture = mkdtempSync(join(tmpdir(), "lane-lifecycle-"))
  const canonicalPath = join(fixture, "change")
  const laneRoot = join(fixture, "lanes")
  mkdirSync(canonicalPath)
  mkdirSync(laneRoot)

  try {
    git(canonicalPath, "init", "-b", "feature-fixture")
    git(canonicalPath, "config", "user.name", "Lane Test")
    git(canonicalPath, "config", "user.email", "lane-test@example.invalid")
    commitFile(canonicalPath, "README.md", "base\n", "fixture base")

    const baseSha = git(canonicalPath, "rev-parse", "HEAD")
    const commonDir = resolve(canonicalPath, git(canonicalPath, "rev-parse", "--git-common-dir"))
    const canonical = {
      path: canonicalPath,
      branch: git(canonicalPath, "branch", "--show-current"),
      head: baseSha,
      commonDir,
    }
    const tasks = [task("T1", 1, "a.txt"), task("T2", 2, "b.txt")]
    const lanes = tasks.map((entry) => planLaneCreation({
      canonical,
      task: entry,
      executionID: "fixture-run",
      laneRoot,
    }))

    for (const lane of lanes) {
      git(canonicalPath, ...lane.create)
      const observedCreation = {
        isLinkedWorktree: true,
        path: lane.path,
        branch: git(lane.path, "branch", "--show-current"),
        head: git(lane.path, "rev-parse", "HEAD"),
        commonDir: resolve(lane.path, git(lane.path, "rev-parse", "--git-common-dir")),
      }
      const creation = validateLaneCreation({
        lane,
        observed: observedCreation,
      })
      assert.equal(creation.status, STATUS.PROVEN, JSON.stringify({ lane, observedCreation }))
    }

    commitFile(lanes[0].path, "a.txt", "A\n", "T1: add A")
    commitFile(lanes[1].path, "b.txt", "B\n", "T2: add B")

    const laneResults = lanes.map((lane, index) => ({
      lane,
      inspection: inspectLaneResult({
        lane,
        task: tasks[index],
        observed: {
          path: lane.path,
          branch: git(lane.path, "branch", "--show-current"),
          commonDir: resolve(lane.path, git(lane.path, "rev-parse", "--git-common-dir")),
          workerConfinement: STATUS.PROVEN,
          bookkeepingPolicy: STATUS.PROVEN,
          rawPathsCaptured: true,
          changedPaths: tasks[index].writeScopes,
          unknownMutations: [],
          forbiddenWorkerMutations: [],
          focusedChecksPassed: true,
          committed: true,
          aheadBy: Number(git(lane.path, "rev-list", "--count", `${baseSha}..HEAD`)),
        },
        review: "[APPROVED]",
      }),
    }))
    assert.ok(laneResults.every((result) => result.inspection.readyForIntegration))

    const plan = buildIntegrationPlan({ canonicalHead: baseSha, laneResults: laneResults.reverse() })
    assert.deepEqual(plan.steps.map((step) => step.taskID), ["T1", "T2"])
    for (const step of plan.steps) git(canonicalPath, ...step.command)

    assert.equal(readFileSync(join(canonicalPath, "a.txt"), "utf8"), "A\n")
    assert.equal(readFileSync(join(canonicalPath, "b.txt"), "utf8"), "B\n")
    const wave = assessWaveCompletion({
      integrationResults: plan.steps.map((step) => ({ taskID: step.taskID, integrated: true })),
      combinedChecksPassed: true,
      tasks: [...tasks, { ...task("T3", 3, "combined.txt"), dependencies: ["T1", "T2"] }],
    })
    assert.deepEqual(wave.completableTasks, ["T1", "T2"])
    assert.ok(!wave.completableTasks.includes("T3"))

    for (const lane of lanes) {
      const cleanup = assessLaneCleanup({
        lane,
        observed: {
          isLinkedWorktree: true,
          path: lane.path,
          branch: lane.branch,
          commonDir: lane.commonDir,
          bookkeepingPolicy: STATUS.PROVEN,
          unknownMutations: [],
          cleanAfterKnownBookkeeping: git(lane.path, "status", "--porcelain").length === 0,
        },
        integration: {
          integrated: git(canonicalPath, "merge-base", "--is-ancestor", lane.branch, "HEAD") === "",
          uniqueUnintegratedCommits: Number(git(canonicalPath, "rev-list", "--count", `HEAD..${lane.branch}`)),
        },
      })
      assert.equal(cleanup.decision, "PERMITTED")
      git(canonicalPath, ...cleanup.removeWorktree)
      git(canonicalPath, ...cleanup.deleteBranchAfterWorktreeRemoval)
    }
    assert.equal(git(canonicalPath, "worktree", "list", "--porcelain").includes(laneRoot), false)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
