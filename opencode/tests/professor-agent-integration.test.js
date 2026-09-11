import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

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
  for (const permission of ["websearch", "websearch_*", "webfetch", "question", "research_start", "research_next", "research_commit", "research_state", "research_verify", "research_complete"]) {
    assert.match(content, new RegExp(`^  ${permission.replace("*", "\\*")}: allow$`, "m"))
  }
  for (const contract of [
    /ResearchState.*source of truth/i,
    /one deterministic task at a time|two research tasks concurrently/i,
    /native `websearch`.*`webfetch`/i,
    /untrusted evidence/i,
    /claim.*evidence/i,
    /research_verify/i,
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
