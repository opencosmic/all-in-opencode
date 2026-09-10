import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

async function source(relative) {
  return readFile(resolve(repository, relative), "utf8")
}

test("Searcher is a bounded read-only primary web answer engine", async () => {
  const content = await source("opencode/agents/searcher.md")

  assert.match(content, /^name: Searcher$/m)
  assert.match(content, /^mode: primary$/m)
  assert.match(content, /^steps: 6$/m)
  assert.match(content, /^  "\*": deny$/m)
  for (const permission of [
    "read", "glob", "grep", "list", "lsp", "edit", "write", "bash", "task",
    "delegate_task", "workspace_prepare", "workspace_release", "task_status",
    "task_output", "task_cancel", "skill", "todowrite", "workspace_inspect",
    "external_directory",
  ]) assert.match(content, new RegExp(`^  ${permission}: deny$`, "m"))
  for (const permission of ["websearch", "websearch_*", "webfetch", "question"]) {
    assert.match(content, new RegExp(`^  ${permission.replace("*", "\\*")}: allow$`, "m"))
  }

  assert.match(content, /minimum sufficient retrieval/i)
  assert.match(content, /at most one targeted corrective search round/i)
  assert.match(content, /not Deep Research/i)
  assert.match(content, /important factual claims.*inline source links\/citations/i)
  assert.match(content, /first-party documentation.*release material.*pricing/i)
  assert.match(content, /current or latest questions.*dates/i)
  assert.match(content, /Researcher remains.*Librarian remains/i)
  assert.doesNotMatch(content, /oh-my-openagent|call_omo_agent|background_output|background_cancel|Sisyphus-Junior/i)
})

test("/search is a standalone Searcher route and forwards the question", async () => {
  const content = await source("opencode/commands/search.md")

  assert.match(content, /^agent: Searcher$/m)
  assert.match(content, /^subtask: false$/m)
  assert.match(content, /`\$ARGUMENTS`/)
  assert.match(content, /standalone normal web Search \/ Answer Engine/i)
  assert.match(content, /not OpenSpec, coding implementation, Deep Research, browser automation/i)
  assert.doesNotMatch(content, /oh-my-openagent|call_omo_agent|Sisyphus-Junior/i)
})
