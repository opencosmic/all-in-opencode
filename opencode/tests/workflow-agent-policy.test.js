import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const agents = fileURLToPath(new URL("../agents/", import.meta.url))

async function agent(name) {
  return readFile(`${agents}${name}.md`, "utf8")
}

test("Explorer is read-only and selects retrieval by question shape", async () => {
  const source = await agent("explorer")
  assert.match(source, /^name: Explorer$/m)
  assert.match(source, /^  edit: deny$/m)
  assert.match(source, /^  write: deny$/m)
  assert.match(source, /^  lsp: allow$/m)
  assert.match(source, /^  codegraph_codegraph_explore: allow$/m)
  assert.match(source, /literal strings, configuration, and filenames/)
  assert.match(source, /symbols, definitions, and references/)
  assert.match(source, /architecture, structural relationships, and cross-file call\/data flow/)
  assert.match(source, /quick`, `medium`, or `thorough/)
  assert.doesNotMatch(source, /fixed (?:minimum|number) of tool calls/i)
})

test("Librarian owns external evidence and never mutates", async () => {
  const source = await agent("librarian")
  assert.match(source, /^name: Librarian$/m)
  assert.match(source, /^  webfetch: allow$/m)
  assert.match(source, /^  edit: deny$/m)
  assert.match(source, /Explorer answers what this codebase/)
  assert.match(source, /first-party documentation, specifications, release notes, and upstream source/)
  assert.match(source, /exact current version/)
})

test("Implementer may consult bounded read-only specialists but cannot delegate", async () => {
  const source = await agent("implementer")
  assert.match(source, /^  consult_agents: allow$/m)
  assert.match(source, /^  delegate_task: deny$/m)
  assert.match(source, /consult_agents.*bounded information gathering/)
  assert.match(source, /group independent questions into one synchronous batch/)
  assert.match(source, /Consult again or continue a session later only when genuinely needed/)
  assert.match(source, /remain responsible for implementation, decisions, edits, testing, validation, and final reporting/)
})

test("Technical Advisor is trigger-only, read-only, and has no approval authority", async () => {
  const source = await agent("technical-advisor")
  assert.match(source, /^name: Technical Advisor$/m)
  assert.match(source, /^  edit: deny$/m)
  assert.match(source, /^  write: deny$/m)
  assert.match(source, /not an approval gate/)
  assert.match(source, /must never emit `\[APPROVED\]` or `\[REJECTED\]`/)
  assert.match(source, /pragmatic minimalism/i)
  assert.match(source, /one primary recommendation/)
})

test("Assistant owns general routing without silently entering OpenSpec", async () => {
  const source = await agent("assistant")
  assert.match(source, /^name: Assistant$/m)
  assert.match(source, /Do not create or mutate OpenSpec state unless the user explicitly requests/)
  assert.match(source, /delegate_task\(category=\.\.\.\)/)
  assert.match(source, /category="git"/)
  assert.doesNotMatch(source, /browser-automation/)
  assert.match(source, /^  skill: deny$/m)
  assert.match(source, /^    "ego-browser \*": deny$/m)
  assert.match(source, /Browser automation is not available through Assistant in this phase\./)
  assert.match(source, /Do not delegate `ego-browser` or emulate browser work through Implementer\./)
  assert.match(source, /Use the dedicated `\/browser` route instead\./)
  assert.match(source, /Use `todowrite` for meaningful multi-step work, not one-step requests/)
  assert.match(source, /dynamically presented category and skill catalog/)
  assert.doesNotMatch(source, /load_skills=\["ego-browser"\]/)
})
