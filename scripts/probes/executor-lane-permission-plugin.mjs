import { execFile } from "node:child_process"
import { appendFile, readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"

import {
  continuationMarkerCandidates,
  evaluateExecutorLaneCommand,
  PERMISSION_CLASSES,
} from "../lib/executor-lane-permission.mjs"
import { STATUS, classifyOmoRuntimeBookkeeping } from "./worktree-isolation.mjs"

const execFileAsync = promisify(execFile)

async function git(cwd, args) {
  return execFileAsync("git", args, { cwd, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 })
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function gitSucceeds(cwd, args) {
  try {
    await git(cwd, args)
    return true
  } catch {
    return false
  }
}

async function mutableProvenanceChecks(decision, context) {
  const checks = []
  for (const operation of decision.operations) {
    if (operation.classification === PERMISSION_CLASSES.OWNED_LANE_CREATE) {
      const pathAbsent = !(await exists(operation.lane))
      const branchAbsent = !(await gitSucceeds(context.fixture, ["show-ref", "--verify", "--quiet", `refs/heads/${operation.branch}`]))
      checks.push({ classification: operation.classification, task: operation.task, pathAbsent, branchAbsent })
      if (!pathAbsent || !branchAbsent) return { allowed: false, checks, reason: "owned lane path or branch already exists" }
    }
    if (operation.classification === PERMISSION_CLASSES.OWNED_WORKTREE_REMOVE) {
      const { stdout: worktrees } = await git(context.fixture, ["worktree", "list", "--porcelain"])
      const registered = worktrees.includes(`worktree ${operation.lane}\n`) && worktrees.includes(`branch refs/heads/${context.branches[operation.task]}\n`)
      const { stdout: status } = await git(operation.lane, ["status", "--porcelain=v1", "--untracked-files=all"])
      const integrated = await gitSucceeds(context.fixture, ["merge-base", "--is-ancestor", context.branches[operation.task], "HEAD"])
      checks.push({ classification: operation.classification, task: operation.task, registered, clean: status.length === 0, integrated })
      if (!registered || status.length !== 0 || !integrated) {
        return { allowed: false, checks, reason: "lane cleanup eligibility is not mechanically proven" }
      }
    }
    if (operation.classification === PERMISSION_CLASSES.OWNED_BRANCH_DELETE) {
      const { stdout: worktrees } = await git(context.fixture, ["worktree", "list", "--porcelain"])
      const worktreeRemoved = !worktrees.includes(`branch refs/heads/${operation.branch}\n`)
      const integrated = await gitSucceeds(context.fixture, ["merge-base", "--is-ancestor", operation.branch, "HEAD"])
      checks.push({ classification: operation.classification, task: operation.task, worktreeRemoved, integrated })
      if (!worktreeRemoved || !integrated) return { allowed: false, checks, reason: "branch cleanup eligibility is not mechanically proven" }
    }
  }
  return { allowed: true, checks }
}

async function sessionDirectory(client, sessionID) {
  const response = await client.session.get({ path: { id: sessionID } })
  return response.data?.directory
}

async function recognizedMarkerPaths(client, command, cwd) {
  const recognized = []
  for (const path of continuationMarkerCandidates(command, cwd)) {
    try {
      const marker = JSON.parse(await readFile(path, "utf8"))
      const directory = await sessionDirectory(client, marker?.sessionID)
      const result = classifyOmoRuntimeBookkeeping({
        markers: [{ path, marker }],
        sessions: [{ id: marker?.sessionID, directory }],
      })
      if (result.policyStatus === STATUS.PROVEN && result.classifications.length === 1) recognized.push(resolve(path))
    } catch {
      // The evaluator will deny an unreadable, unknown, or malformed marker.
    }
  }
  return recognized
}

export default async function ExecutorLanePermissionPlugin(ctx) {
  const contextPath = process.env.EXECUTOR_LANE_E2E_PERMISSION_CONTEXT
  const decisionsPath = process.env.EXECUTOR_LANE_E2E_PERMISSION_DECISIONS
  if (!contextPath || !decisionsPath || process.env.EXECUTOR_LANE_E2E_USER_AUTHORIZED !== "1") {
    throw new Error("[executor-lane-permission] isolated authorization context is missing")
  }
  const context = JSON.parse(await readFile(contextPath, "utf8"))
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool.toLowerCase() !== "bash") return
      const command = output.args?.command
      const storedDirectory = await sessionDirectory(ctx.client, input.sessionID)
      const cwd = typeof output.args?.workdir === "string"
        ? resolve(storedDirectory, output.args.workdir)
        : storedDirectory
      const knownMarkerPaths = typeof command === "string" ? await recognizedMarkerPaths(ctx.client, command, cwd) : []
      let decision = evaluateExecutorLaneCommand({ command, cwd, context: { ...context, knownMarkerPaths } })
      const provenance = decision.allowed
        ? await mutableProvenanceChecks(decision, context)
        : { allowed: false, checks: [] }
      if (decision.allowed && !provenance.allowed) {
        decision = { ...decision, allowed: false, classification: PERMISSION_CLASSES.DENIED, reason: provenance.reason }
      }
      const record = {
        at: new Date().toISOString(),
        sessionID: input.sessionID,
        callID: input.callID,
        tool: input.tool,
        cwd,
        command,
        authorizedByUser: true,
        mechanism: "probe-local-adapter",
        provenanceChecks: provenance.checks,
        ...decision,
      }
      await appendFile(decisionsPath, JSON.stringify(record) + "\n")
      if (!decision.allowed) throw new Error(`[executor-lane-permission] denied: ${decision.reason}`)
    },
  }
}
