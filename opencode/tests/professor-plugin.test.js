import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import ProfessorRuntime from "../plugins/professor-runtime.js"
import * as ProfessorRuntimeEntrypoint from "../plugins/professor-runtime.js"

test("Professor plugin entrypoint is default-only, model-free, and exposes only the intended tools", async (t) => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "professor-plugin-test-"))
  t.after(() => rm(stateDirectory, { recursive: true, force: true }))
  let clientRead = false
  const plugin = await ProfessorRuntime({
    get client() {
      clientRead = true
      throw new Error("Professor runtime must not contact a model during initialization")
    },
    directory: "/fixture",
    worktree: "/fixture",
  }, { stateDirectory })

  assert.deepEqual(Object.keys(ProfessorRuntimeEntrypoint), ["default"])
  assert.equal(clientRead, false)
  assert.deepEqual(Object.keys(plugin.tool), [
    "research_start",
    "research_next",
    "research_commit",
    "research_state",
    "research_verify",
    "research_complete",
  ])
  for (const name of Object.keys(plugin.tool)) {
    assert.equal(typeof plugin.tool[name].execute, "function")
    assert.ok(plugin.tool[name].description)
  }
})

test("Professor plugin uses the injected state directory and leaves report/state files durable", async (t) => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "professor-plugin-state-"))
  t.after(() => rm(stateDirectory, { recursive: true, force: true }))
  const plugin = await ProfessorRuntime({}, {
    stateDirectory,
    generateRunId: () => "run-plugin-001",
  })
  const start = JSON.parse(await plugin.tool.research_start.execute({
    objective: "Test plugin persistence.",
    questions: [{
      question: "Can the plugin persist state?",
      priority: "critical",
      evidenceNeeded: ["runtime evidence"],
      completionCriteria: ["state file exists"],
    }],
  }, {}))
  const next = JSON.parse(await plugin.tool.research_next.execute({ runId: start.runId }, {}))
  const commit = JSON.parse(await plugin.tool.research_commit.execute({
    runId: start.runId,
    taskId: next.task.taskId,
    summary: "state persisted",
  }, {}))
  assert.equal(commit.runId, "run-plugin-001")
  const statePath = join(stateDirectory, "runs", "run-plugin-001", "state.json")
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).runId, "run-plugin-001")
})

test("Professor plugin entrypoint does not cross private OpenCode or shell boundaries", async () => {
  const source = await readFile(new URL("../plugins/professor-runtime.js", import.meta.url), "utf8")
  const runtime = await readFile(new URL("../plugins/professor/runtime.js", import.meta.url), "utf8")
  assert.match(source, /from "@opencode-ai\/plugin"/)
  assert.doesNotMatch(`${source}\n${runtime}`, /opencode\/(?:internal|src)|child_process|opencode run|fetch\(/i)
})
