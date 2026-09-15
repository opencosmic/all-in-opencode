import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildRunPlan,
  countClaimStatuses,
  countTaskStatuses,
  isZeroValueCompletedTask,
  loadCases,
  objectiveMetrics,
  parseJsonOutput,
  PROFESSOR_BENCHMARK_MODEL,
  PROFESSOR_BENCHMARK_VARIANT,
  summarizeProfessorState,
} from "./lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))

test("Professor quality cases preserve the frozen seven originals, four blind prompts, and supplemental cases", async () => {
  const cases = await loadCases(join(here, "cases.json"))
  assert.equal(cases.length, 18)
  assert.deepEqual(cases.filter((item) => item.suite === "original").map((item) => item.id), ["B1", "B2", "B3", "B4", "B5", "B6", "B7"])
  assert.deepEqual(cases.filter((item) => item.suite === "supplemental").map((item) => item.id), ["C1", "C2", "C3", "C4", "C5", "C6", "C7"])
  assert.deepEqual(cases.filter((item) => item.blind).map((item) => item.id), ["B1b", "B2b", "B3b", "B4b"])
  assert.equal(cases.find((item) => item.id === "B1").query, "Determine current architecture and recommended development approach for modern Next.js applications, distinguishing Pages Router vs App Router, Server Components, Server Actions, current caching/data-fetching, and legacy vs current features, ending with recommendation for new production app.")
  assert.equal(cases.find((item) => item.id === "B2").query, "Determine the current official automation capabilities of OpenCut (open-source video editor): Editor API, MCP server, headless editing/rendering, scripting interface, portable project interchange format, distinguishing released/official vs experimental/PR/roadmap/community/proposed/not-found.")
  assert.equal(cases.find((item) => item.id === "B3").query, "Determine whether OpenCut currently has a usable official macOS desktop application, distinguishing official releases vs source-buildable code vs third-party packaging/forks vs community claims.")
  assert.equal(cases.find((item) => item.id === "B4").query, "Research the current state of OpenCut's architecture and determine whether apparently conflicting descriptions of its editor architecture are actually contradictions. Produce a reconciled model showing what belongs to classic, what belongs to rewrite, and what remains uncertain.")
  assert.equal(cases.find((item) => item.id === "B5").query, "Research whether OpenCut is currently a good foundation for building an agent-driven video editing workflow inside OpenCode. Start broad, investigate production viability factors, adapt plan as constraints emerge, identify real blockers (architectural vs unfinished), changed assumptions, and what evidence would change recommendation.")
  assert.equal(cases.find((item) => item.id === "B6").query, "Research the technical feasibility of building a stable OpenCode integration around OpenCut today. Evaluate editor state, timeline manipulation, persistence, media storage, rendering/export, automation surface, process boundary, desktop availability, MCP/API status, backward compat/schema stability, licensing. Distinguish verified fact vs inference vs roadmap vs workaround vs uncertainty. End with feasible-today architecture, preferred future architecture, and blocking evidence.")
  assert.equal(cases.find((item) => item.id === "B7").query, "Research the best practical stack for an individual developer using OpenCode to create AI-assisted videos combining generated video, programmatic motion graphics, Blender 3D, timeline editing, audio/music, captions, final rendering. Evaluate roles and maturity of HyperFrames, Blender, OpenCut, FFmpeg/code-driven processing, and AI video generation services. Identify what should be agent-automated vs human-in-loop vs file-artifact exchange vs not coupled. End with simplest capable architecture today without immature interfaces.")
  assert.equal(cases.find((item) => item.id === "B1b").query, "Research the current recommended Next.js architecture for a new production application.")
  assert.equal(cases.find((item) => item.id === "B2b").query, "Research what official automation interfaces OpenCut currently provides.")
  assert.equal(cases.find((item) => item.id === "B3b").query, "Research whether I can install a usable official OpenCut desktop application on macOS today.")
  assert.equal(cases.find((item) => item.id === "B4b").query, "Research OpenCut's current architecture and technology stack.")
  assert.equal(buildRunPlan(cases).length, 18)
  assert.equal(buildRunPlan(cases, { suite: "regression" }).length, 11)
  assert.equal(buildRunPlan(cases, { suite: "original" }).length, 7)
})

test("Professor benchmark metrics retain superseded tasks and every claim verdict", () => {
  assert.deepEqual(countTaskStatuses([
    { status: "pending" },
    { status: "running" },
    { status: "completed" },
    { status: "failed" },
    { status: "superseded" },
  ]), { pending: 1, running: 1, completed: 1, failed: 1, superseded: 1 })
  assert.deepEqual(countClaimStatuses([
    { verification: "SUPPORTED" },
    { verification: "PARTIAL" },
    { verification: "UNSUPPORTED" },
    { verification: "CONTRADICTED" },
  ]), { supported: 1, partial: 1, unsupported: 1, contradicted: 1 })
  const summary = summarizeProfessorState({
    runId: "run-fixture",
    status: "writing",
    counters: { controllerRounds: 4 },
    tasks: [{ taskId: "task-1", questionId: "question-1", type: "initial", status: "superseded" }],
    sources: [{}],
    evidence: [{}, {}],
    findings: [{}],
    claims: [{ verification: "PARTIAL" }, { verification: "SUPPORTED" }],
    contradictions: [{ contradictionId: "contradiction-1", proposition: "A", critical: false, status: "open" }],
    metrics: {
      searchCount: 3,
      claimStatusCounts: { supported: 0, partial: 0, unsupported: 0, contradicted: 0 },
      remainingUncertainties: ["partial claim"],
    },
  }, { fetchCount: 2, retrievalCount: 5 })
  assert.equal(summary.controllerRounds, 4)
  assert.equal(summary.taskStatusCounts.superseded, 1)
  assert.deepEqual(summary.claimStatusCounts, { supported: 1, partial: 1, unsupported: 0, contradicted: 0 })
  assert.equal(summary.fetchCount, 2)
  assert.deepEqual(summary.uncertainties, ["partial claim"])
})

test("Professor benchmark parser keeps malformed output auditable without treating it as a valid tool result", () => {
  assert.deepEqual(parseJsonOutput('{"runId":"run-1"}'), { runId: "run-1" })
  assert.equal(parseJsonOutput("not json"), null)
  const metrics = objectiveMetrics([{
    caseId: "B7",
    completed: false,
    controllerRounds: 8,
    taskStatusCounts: { pending: 1, running: 0, completed: 1, failed: 0, superseded: 2 },
    sourceCount: 2,
    evidenceCount: 3,
    findingCount: 1,
    claimCount: 2,
    claimStatusCounts: { supported: 1, partial: 1, unsupported: 0, contradicted: 0 },
    searchCount: 4,
    fetchCount: 5,
    retrievalCount: 9,
    stepCapAtBoundary: true,
    failureReason: "max_controller_rounds",
    durationMs: 100,
    zeroValueCompletedTasks: [],
  }])
  assert.equal(metrics.incompleteRuns, 1)
  assert.equal(metrics.taskStatusCounts.superseded, 2)
  assert.deepEqual(metrics.claimStatusCounts, { supported: 1, partial: 1, unsupported: 0, contradicted: 0 })
  assert.equal(metrics.stepCapBoundaryRuns, 1)
  assert.equal(metrics.failureReasons[0].reason, "max_controller_rounds")
  assert.equal(metrics.zeroValueCompletedTasks, 0)
  assert.equal(isZeroValueCompletedTask({
    type: "task.completed",
    sources: 1,
    evidence: 0,
    findings: 0,
    contradictions: 0,
    followUps: 0,
    canonicalResult: false,
  }), true)
  assert.equal(isZeroValueCompletedTask({
    type: "task.completed",
    sources: 1,
    evidence: 0,
    findings: 0,
    contradictions: 0,
    criteria: 0,
    followUps: 0,
    canonicalResult: true,
  }), false)
  assert.equal(isZeroValueCompletedTask({
    type: "task.completed",
    sources: 0,
    evidence: 0,
    findings: 0,
    contradictions: 0,
    criteria: 1,
    followUps: 0,
    canonicalResult: true,
  }), false)
})

test("benchmark aggregates do not present stale claim metrics as verified counts", () => {
  const metrics = objectiveMetrics([{
    caseId: "B6",
    completed: false,
    claimCount: 13,
    claimStatusCounts: { supported: 0, partial: 0, unsupported: 0, contradicted: 0 },
  }])
  assert.equal(metrics.claimStatusCounts, null)
  assert.equal(metrics.claimStatusCountsUnavailable, 13)
  assert.equal(metrics.byCase.B6.claimStatusCounts, null)
  assert.equal(metrics.byCase.B6.claimStatusCountsUnavailable, 13)
})

test("post-change Professor benchmark runs pin the controlled model explicitly", async () => {
  const source = await readFile(join(here, "run.mjs"), "utf8")
  assert.equal(PROFESSOR_BENCHMARK_MODEL, "opencode/muse-spark-1.3-contributor-free")
  assert.equal(PROFESSOR_BENCHMARK_VARIANT, "xhigh")
  assert.match(source, /"--model", PROFESSOR_BENCHMARK_MODEL/)
  assert.match(source, /"--variant", PROFESSOR_BENCHMARK_VARIANT/)
  assert.match(source, /executeProfessor\(caseItem, item, isolated, timeoutMs\)/)
})

test("Professor quality README and baseline artifacts are intended to be generated by the runner, not raw transcripts", async () => {
  const readme = await readFile(join(here, "README.md"), "utf8")
  assert.match(readme, /B1b.*B4b/s)
  assert.match(readme, /state\.json|events\.jsonl|report\.md/)
  assert.doesNotMatch(readme, /raw OpenCode transcripts are committed/i)
})
