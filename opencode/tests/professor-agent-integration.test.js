import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import ProfessorRuntime from "../plugins/professor-runtime.js"

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

async function source(relative) {
  return readFile(resolve(repository, relative), "utf8")
}

test("Professor is a dedicated read-only primary with a narrow native retrieval/state boundary", async () => {
  const content = await source("opencode/agents/professor.md")
  assert.match(content, /^name: Professor$/m)
  assert.match(content, /^mode: primary$/m)
  assert.match(content, /^steps: 32$/m)
  assert.match(content, /^  "\*": deny$/m)
  for (const permission of [
    "read", "glob", "grep", "list", "lsp", "edit", "write", "bash", "task", "delegate_task", "consult_agents",
    "workspace_prepare", "workspace_release", "workspace_inspect", "task_status", "task_output", "task_cancel",
    "skill", "todowrite", "external_directory",
  ]) assert.match(content, new RegExp(`^  ${permission}: deny$`, "m"))
  for (const permission of ["websearch", "websearch_*", "webfetch", "question", "research_start", "research_next", "research_commit", "research_state", "research_verify", "research_complete", "research_report"]) {
    assert.match(content, new RegExp(`^  ${permission.replace("*", "\\*")}: allow$`, "m"))
  }
  for (const contract of [
    /ResearchState.*source of truth/i,
    /one deterministic task at a time|two research tasks concurrently/i,
    /native `websearch`.*`webfetch`/i,
    /untrusted evidence/i,
    /claim.*evidence/i,
    /closure-aware|researchRoundsRemaining/i,
    /superseded/i,
    /one bounded proposition|supporting span/i,
    /research_verify/i,
    /research_report/i,
    /adaptive/i,
    /no.*delegat/i,
  ]) assert.match(content, contract)
  assert.doesNotMatch(content, /oh-my-openagent|call_omo_agent|browser automation.*allow/i)
})

test("/research is the canonical standalone Professor route and forwards arguments", async () => {
  const content = await source("opencode/commands/research.md")
  assert.match(content, /^agent: Professor$/m)
  assert.match(content, /^subtask: false$/m)
  assert.match(content, /`\$ARGUMENTS`/)
  assert.match(content, /standalone stateful Deep Research/i)
  assert.doesNotMatch(content, /deep-research\.md|oh-my-openagent|call_omo_agent/i)
})

test("Professor citation instructions match the reportable-evidence runtime contract", async () => {
  const prompt = await source("opencode/agents/professor.md")
  const plugin = await ProfessorRuntime()
  const description = plugin.tool.research_complete.description
  const nextDescription = plugin.tool.research_next.description
  const commitDescription = plugin.tool.research_commit.description
  const reportDescription = plugin.tool.research_report.description
  for (const contract of [
    /structured reportable evidence/i,
    /verified claim/i,
    /reportable contradiction/i,
    /SUPPORTED.*PARTIAL.*UNSUPPORTED.*CONTRADICTED/i,
    /discovered, fetched, or persisted/i,
  ]) assert.match(prompt, contract)
  for (const contract of [
    /structured reportable evidence/i,
    /verified claim/i,
    /reportable contradiction/i,
    /SUPPORTED.*PARTIAL.*UNSUPPORTED.*CONTRADICTED/i,
    /unused research sources and unrelated URLs are rejected/i,
  ]) assert.match(description, contract)
  for (const contract of [/closure-aware/i, /superseded/i, /remaining capacity/i]) assert.match(nextDescription, contract)
  for (const contract of [/summary alone/i, /canonical research result/i, /superseded/i, /bounded proposition/i]) assert.match(commitDescription, contract)
  for (const contract of [
    /durationMs.*durationDisplay.*citationCount.*searchCount/i,
    /libraryPath/i,
    /concise.*handoff/i,
  ]) assert.match(description, contract)
  for (const contract of [
    /canonical final report/i,
    /safe runId only/i,
    /untrusted research material/i,
  ]) assert.match(reportDescription, contract)
  for (const contract of [
    /concise.*handoff|handoff.*concise/i,
    /duration.*citation.*search/i,
    /durationDisplay/i,
    /raw.*durationMs/i,
    /localized|conversation language/i,
    /libraryPath|report.*link|report.*path/i,
    /must not be duplicated|not.*duplicate.*full report|not.*echo.*full report/i,
    /research_report/i,
    /not.*every follow-up|mechanically/i,
  ]) assert.match(prompt, contract)
  assert.doesNotMatch(prompt, /native search count|native searches/i)
  assert.doesNotMatch(prompt, /source used by a `?SUPPORTED claim/i)
  assert.doesNotMatch(description, /source used by a SUPPORTED claim/i)
})

test("production Professor runtime has no benchmark or alternate retrieval dependency", async () => {
  const files = [
    "opencode/plugins/professor-runtime.js",
    "opencode/plugins/professor/runtime.js",
    "opencode/plugins/professor/state.js",
    "opencode/plugins/professor/store.js",
  ]
  const combined = await Promise.all(files.map(source)).then((parts) => parts.join("\n"))
  assert.doesNotMatch(combined, /benchmarks\/retrieval-foundation|search_batch|fetch_evidence|SearchProvider|browser fallback|vector|embedding/i)
  assert.doesNotMatch(combined, /opencode\/(?:internal|src)|child_process|opencode run/i)
})
