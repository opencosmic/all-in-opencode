import test from "node:test"
import assert from "node:assert/strict"
import { access, readFile, readdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repository = resolve(here, "../..")
const root = "/Users/code/.config/opencode"

async function text(relativePath) {
  return readFile(`${root}/${relativePath}`, "utf8")
}

test("Ego Browser is a primary-only agent reached directly by /ego", async () => {
  const agent = await text("agents/ego-browser.md")
  const command = await text("commands/ego.md")

  assert.match(agent, /^name: Ego Browser$/m)
  assert.match(agent, /^mode: primary$/m)
  assert.doesNotMatch(agent, /^mode: (?:all|subagent)$/m)
  assert.match(command, /^agent: Ego Browser$/m)
  assert.match(command, /^subtask: false$/m)
})

test("only Ego Browser receives the ego-browser skill and runtime surface", async () => {
  const files = (await readdir(`${root}/agents`)).filter((name) => name.endsWith(".md"))
  const skillHolders = []
  const runtimeHolders = []

  for (const file of files) {
    const source = await text(`agents/${file}`)
    if (/^    "ego-browser": allow$/m.test(source)) skillHolders.push(file)
    if (/^    "ego-browser \*": allow$/m.test(source)) runtimeHolders.push(file)
  }

  assert.deepEqual(skillHolders, ["ego-browser.md"])
  assert.deepEqual(runtimeHolders, ["ego-browser.md"])
})

test("Ego Browser permissions deny unrelated capabilities and generic shell use", async () => {
  const agent = await text("agents/ego-browser.md")

  assert.match(agent, /permission:\n  "\*": deny/)
  assert.match(agent, /skill:\n    "\*": deny\n    "ego-browser": allow/)
  assert.match(agent, /bash:\n    "\*": deny\n    "ego-browser \*": allow/)
  assert.match(agent, /^  question: allow$/m)
  assert.match(agent, /^  edit: deny$/m)
  assert.match(agent, /^  write: deny$/m)
  assert.match(agent, /^  task: deny$/m)
  assert.match(agent, /^  call_omo_agent: deny$/m)
  assert.match(agent, /^  external_directory: deny$/m)
  assert.doesNotMatch(agent, /^  codegraph[^:]*: allow$/mi)
})

test("Ego Browser policy covers handoff, account safety, Node escape, no-edit, and verification", async () => {
  const agent = await text("agents/ego-browser.md")

  assert.match(agent, /login, CAPTCHA, MFA, payment confirmation, security confirmation/i)
  assert.match(agent, /wait for explicit user confirmation/i)
  assert.match(agent, /Never automatically take control back/i)
  assert.match(agent, /cookies, session tokens, passwords, credentials, or private browser storage/i)
  assert.match(agent, /send messages, publish content, make purchases, delete remote data/i)
  assert.match(agent, /change account or security settings/i)
  assert.match(agent, /Node\.js runtime/i)
  assert.match(agent, /not an OS-level security sandbox/i)
  assert.match(agent, /`fs` access, `child_process`, process spawning, arbitrary process execution/i)
  assert.match(agent, /Do not modify application source code or workflow artifacts/i)
  assert.match(agent, /reproduction steps, expected behavior, actual behavior, and relevant browser evidence/i)
  assert.match(agent, /Never report successful completion before verifying/i)
})

test("the /ego route preserves browser isolation and upstream ownership", async () => {
  const command = await text("commands/ego.md")

  assert.match(command, /official upstream `ego-browser` skill/i)
  assert.match(command, /one ego-lite Task Space/i)
  assert.match(command, /reuse it across every necessary observation\/action\/verification round/i)
  assert.match(command, /wait for explicit confirmation/i)
  assert.match(command, /not an OS-level sandbox/i)
  assert.match(command, /must never be used as a generic shell, filesystem, process-execution, or repository-mutation escape/i)
  assert.match(command, /clean up the Task Space unless a concrete user-facing reason requires it to stay open/i)
  assert.match(command, /Do not enter OpenSpec or the normal coding lifecycle/i)
})

test("the upstream skill stays external and links remain directory-scoped", async () => {
  await assert.rejects(access(`${repository}/opencode/skills/ego-browser/SKILL.md`))
  await assert.rejects(access(`${repository}/skills/ego-browser/SKILL.md`))

  const links = await readFile(`${repository}/scripts/links.tsv`, "utf8")
  assert.match(links, /^opencode\/agents\|\.config\/opencode\/agents\|directory$/m)
  assert.match(links, /^opencode\/commands\|\.config\/opencode\/commands\|directory$/m)
  assert.doesNotMatch(links, /ego-browser\.md|commands\/ego\.md|skills\/ego-browser/)

  const omo = await readFile(`${repository}/omo/omo.jsonc`, "utf8")
  assert.doesNotMatch(omo, /ego[- ]browser/i)
})

test("Ego Browser provisioning is explicit, external, and non-gating", async () => {
  const setup = await readFile(`${repository}/scripts/setup-ego-browser.sh`, "utf8")
  const health = await readFile(`${repository}/scripts/check-ego-browser.sh`, "utf8")
  const verify = await readFile(`${repository}/scripts/verify.sh`, "utf8")

  assert.match(setup, /skills add citrolabs\/ego-lite/)
  assert.match(setup, /--global --agent opencode --skill ego-browser -y/)
  assert.match(setup, /SKILL_DIR=.*skills\/ego-browser/)
  assert.match(setup, /sh "\$SKILL_DIR\/scripts\/install\.sh"/)
  assert.match(setup, /check-ego-browser\.sh/)
  assert.match(health, /ego-browser-health-/)
  assert.match(health, /available and provisioned/)
  assert.match(health, /authored configuration remains valid/)
  assert.doesNotMatch(verify, /setup-ego-browser|check-ego-browser/)
})
