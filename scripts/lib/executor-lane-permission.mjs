import { isAbsolute, relative, resolve } from "node:path"

export const PERMISSION_CLASSES = Object.freeze({
  RUNTIME_ENV_PREAMBLE: "RUNTIME_ENV_PREAMBLE",
  READ_ONLY_INSPECTION: "READ_ONLY_INSPECTION",
  OWNED_LANE_CREATE: "OWNED_LANE_CREATE",
  OWNED_LANE_STAGE: "OWNED_LANE_STAGE",
  OWNED_LANE_COMMIT: "OWNED_LANE_COMMIT",
  OWNED_LANE_MERGE: "OWNED_LANE_MERGE",
  KNOWN_BOOKKEEPING_REMOVE: "KNOWN_BOOKKEEPING_REMOVE",
  OWNED_WORKTREE_REMOVE: "OWNED_WORKTREE_REMOVE",
  OWNED_BRANCH_DELETE: "OWNED_BRANCH_DELETE",
  FIXTURE_CHECK: "FIXTURE_CHECK",
  DENIED: "DENIED",
})

const READ_ONLY_GIT = new Set([
  "status", "diff", "log", "show", "rev-parse", "rev-list", "merge-base", "ls-files",
])
const FIXTURE_NODE_CHECKS = new Set([
  "scripts/lane-worker.mjs",
  "scripts/check-task.mjs",
  "scripts/check-wave.mjs",
  "scripts/t3-worker.mjs",
  "scripts/check-final.mjs",
])
const BOOTSTRAP_EXPRESSION = 'const p=require("./package.json"); console.log("BOOTSTRAP_OK", p.private === true, p.type)'
const FIXTURE_SYNTAX_CHECK_LOOP = 'for file in scripts/*.mjs; do node --check "$file"; done'
export const OMO_NON_INTERACTIVE_ENV_PREAMBLE = "export CI=true DEBIAN_FRONTEND=noninteractive GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never HOMEBREW_NO_AUTO_UPDATE=1 GIT_EDITOR=: EDITOR=: VISUAL='' GIT_SEQUENCE_EDITOR=: GIT_MERGE_AUTOEDIT=no GIT_PAGER=cat PAGER=cat npm_config_yes=true PIP_NO_INPUT=1 YARN_ENABLE_IMMUTABLE_INSTALLS=false"
const OMO_NON_INTERACTIVE_ENV_WORDS = shellWords(OMO_NON_INTERACTIVE_ENV_PREAMBLE)

function inside(root, path) {
  const value = relative(resolve(root), resolve(path))
  return value === "" || (!value.startsWith("..") && !isAbsolute(value))
}

function ownedRoots(context) {
  return [context.fixture, context.lanes?.T1, context.lanes?.T2]
    .filter(Boolean).map((path) => resolve(path))
}

function isOwnedPath(context, path) {
  const target = resolve(path)
  return target === resolve(context.root) || target === resolve(context.root, "lanes") ||
    ownedRoots(context).some((root) => inside(root, target))
}

function isOwnedCwd(context, cwd) {
  return typeof cwd === "string" && [context.fixture, context.lanes?.T1, context.lanes?.T2]
    .filter(Boolean).some((root) => inside(root, cwd))
}

function hasUnsafePathToken(context, cwd, token) {
  if (!token || token === "." || token.startsWith("-")) return false
  if (token.includes("..")) return true
  if (!token.includes("/") && !token.startsWith(".")) return false
  return !isOwnedPath(context, isAbsolute(token) ? token : resolve(cwd, token))
}

function splitShell(command) {
  const atoms = []
  let value = ""
  let quote = null
  let escaped = false
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (escaped) {
      value += char
      escaped = false
      continue
    }
    if (char === "\\" && quote !== "'") {
      value += char
      escaped = true
      continue
    }
    if (quote) {
      value += char
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      value += char
      continue
    }
    const pair = command.slice(index, index + 2)
    if (pair === "&&" || pair === "||") {
      if (!value.trim()) throw new Error("empty compound command component")
      atoms.push({ command: value.trim(), operator: atoms.length === 0 ? null : atoms.at(-1)?.nextOperator })
      atoms.at(-1).nextOperator = pair
      value = ""
      index += 1
      continue
    }
    if (char === ";" || char === "|") {
      if (!value.trim()) throw new Error("empty compound command component")
      atoms.push({ command: value.trim(), operator: atoms.length === 0 ? null : atoms.at(-1)?.nextOperator })
      atoms.at(-1).nextOperator = char
      value = ""
      continue
    }
    if (char === "\n" || char === "\r") {
      if (value.trim()) {
        atoms.push({ command: value.trim(), operator: atoms.length === 0 ? null : atoms.at(-1)?.nextOperator })
        atoms.at(-1).nextOperator = ";"
        value = ""
      }
      continue
    }
    value += char
  }
  if (quote || escaped) throw new Error("unterminated shell quoting")
  if (value.trim()) atoms.push({ command: value.trim(), operator: atoms.length === 0 ? null : atoms.at(-1)?.nextOperator })
  if (atoms.length === 0) throw new Error("empty command")
  for (let index = 1; index < atoms.length; index += 1) atoms[index].operator = atoms[index - 1].nextOperator
  return atoms.map(({ nextOperator: _nextOperator, ...atom }) => atom)
}

function shellWords(command) {
  const words = []
  let value = ""
  let quote = null
  let escaped = false
  let started = false
  const flush = () => {
    if (started) words.push(value)
    value = ""
    started = false
  }
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (escaped) {
      value += char
      started = true
      escaped = false
      continue
    }
    if (char === "\\" && quote !== "'") {
      escaped = true
      started = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else value += char
      started = true
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      flush()
      continue
    }
    if ("<>`&".includes(char) || char === "$" || char === "(" || char === ")") {
      throw new Error(`unsupported shell metacharacter: ${char}`)
    }
    value += char
    started = true
  }
  if (quote || escaped) throw new Error("unterminated shell quoting")
  flush()
  return words
}

function allowed(classification, words, detail = {}) {
  return { allowed: true, classification, words, ...detail }
}

function denied(words, reason) {
  return { allowed: false, classification: PERMISSION_CLASSES.DENIED, words, reason }
}

function gitInvocation(words, cwd, context) {
  let index = 1
  let gitCwd = cwd
  if (words[index] === "-C") {
    if (!words[index + 1]) return denied(words, "git -C requires a directory")
    gitCwd = isAbsolute(words[index + 1]) ? resolve(words[index + 1]) : resolve(cwd, words[index + 1])
    index += 2
  }
  if (!isOwnedCwd(context, gitCwd)) return denied(words, "git cwd is outside disposable ownership")
  const subcommand = words[index]
  const args = words.slice(index + 1)
  if (!subcommand) return denied(words, "git subcommand is required")
  if (READ_ONLY_GIT.has(subcommand)) {
    if (args.some((token) => hasUnsafePathToken(context, gitCwd, token))) {
      return denied(words, "read-only git command references an outside path")
    }
    return allowed(PERMISSION_CLASSES.READ_ONLY_INSPECTION, words, { cwd: gitCwd })
  }
  if (subcommand === "submodule" && args[0] === "status") {
    return allowed(PERMISSION_CLASSES.READ_ONLY_INSPECTION, words, { cwd: gitCwd })
  }
  if (subcommand === "worktree" && args[0] === "list") {
    return allowed(PERMISSION_CLASSES.READ_ONLY_INSPECTION, words, { cwd: gitCwd })
  }
  if (subcommand === "branch" && (
    args.length === 0 || args[0] === "--show-current" || args[0] === "--list" || args[0]?.startsWith("--format")
  )) {
    return allowed(PERMISSION_CLASSES.READ_ONLY_INSPECTION, words, { cwd: gitCwd })
  }

  for (const id of ["T1", "T2"]) {
    const lane = resolve(context.lanes[id])
    const branch = context.branches[id]
    if (
      subcommand === "worktree" && args[0] === "add" && args[1] === "-b" && args[2] === branch &&
      resolve(args[3] ?? "") === lane && args[4] === context.head && args.length === 5 && resolve(gitCwd) === resolve(context.fixture)
    ) return allowed(PERMISSION_CLASSES.OWNED_LANE_CREATE, words, { cwd: gitCwd, task: id, lane, branch })
    const source = id === "T1" ? "src/a.txt" : "src/b.txt"
    const subject = id === "T1" ? "T1: add A" : "T2: add B"
    if (subcommand === "add" && args.length === 1 && args[0] === source && resolve(gitCwd) === lane) {
      return allowed(PERMISSION_CLASSES.OWNED_LANE_STAGE, words, { cwd: gitCwd, task: id, lane })
    }
    if (subcommand === "commit" && args.length === 2 && args[0] === "-m" && args[1] === subject && resolve(gitCwd) === lane) {
      return allowed(PERMISSION_CLASSES.OWNED_LANE_COMMIT, words, { cwd: gitCwd, task: id, lane, subject })
    }
    if (subcommand === "merge" && args.join("\0") === ["--no-ff", "--no-edit", branch].join("\0") && resolve(gitCwd) === resolve(context.fixture)) {
      return allowed(PERMISSION_CLASSES.OWNED_LANE_MERGE, words, { cwd: gitCwd, task: id, branch })
    }
    if (subcommand === "worktree" && args.length === 2 && args[0] === "remove" && resolve(args[1]) === lane && resolve(gitCwd) === resolve(context.fixture)) {
      return allowed(PERMISSION_CLASSES.OWNED_WORKTREE_REMOVE, words, { cwd: gitCwd, task: id, lane })
    }
    if (subcommand === "branch" && args.length === 2 && args[0] === "-d" && args[1] === branch && resolve(gitCwd) === resolve(context.fixture)) {
      return allowed(PERMISSION_CLASSES.OWNED_BRANCH_DELETE, words, { cwd: gitCwd, task: id, branch })
    }
  }
  return denied(words, `git operation is outside the disposable lifecycle: ${subcommand}`)
}

function inspectInvocation(words, cwd, context) {
  if (!isOwnedPath(context, cwd)) return denied(words, "inspection cwd is outside disposable ownership")
  if (words[0] === "pwd" && words.length === 1) return allowed(PERMISSION_CLASSES.READ_ONLY_INSPECTION, words, { cwd })
  if (words[0] === "true" && words.length === 1) return allowed(PERMISSION_CLASSES.READ_ONLY_INSPECTION, words, { cwd })
  if ((words[0] === "ls" || words[0] === "stat") && words.slice(1).every((token) => !hasUnsafePathToken(context, cwd, token))) {
    return allowed(PERMISSION_CLASSES.READ_ONLY_INSPECTION, words, { cwd })
  }
  if (words[0] === "openspec" && ["status", "validate"].includes(words[1]) && words.slice(2).every((token) => !hasUnsafePathToken(context, cwd, token))) {
    return allowed(PERMISSION_CLASSES.READ_ONLY_INSPECTION, words, { cwd })
  }
  return null
}

function nodeInvocation(words, cwd, context) {
  if (!isOwnedCwd(context, cwd)) return denied(words, "node cwd is outside disposable ownership")
  if (words[1] === "--check" && words.length === 3 && FIXTURE_NODE_CHECKS.has(words[2])) {
    return allowed(PERMISSION_CLASSES.FIXTURE_CHECK, words, { cwd })
  }
  if (words[1] === "-e" && words.length === 3 && words[2] === BOOTSTRAP_EXPRESSION && resolve(cwd) === resolve(context.fixture)) {
    return allowed(PERMISSION_CLASSES.FIXTURE_CHECK, words, { cwd })
  }
  if (words[1] === "scripts/check-task.mjs" && words.length === 3 && ["T1", "T2"].includes(words[2])) {
    const expected = resolve(context.lanes[words[2]])
    return resolve(cwd) === expected
      ? allowed(PERMISSION_CLASSES.FIXTURE_CHECK, words, { cwd, task: words[2] })
      : denied(words, "focused check must run in its owned lane")
  }
  if (["scripts/check-wave.mjs", "scripts/check-final.mjs"].includes(words[1]) && words.length === 2 && resolve(cwd) === resolve(context.fixture)) {
    return allowed(PERMISSION_CLASSES.FIXTURE_CHECK, words, { cwd })
  }
  if (words[1] === "scripts/lane-worker.mjs" && words.length === 3 && ["T1", "T2"].includes(words[2])) {
    const expected = resolve(context.lanes[words[2]])
    return resolve(cwd) === expected
      ? allowed(PERMISSION_CLASSES.FIXTURE_CHECK, words, { cwd, task: words[2] })
      : denied(words, "lane worker command must run in its assigned lane")
  }
  if (words[1] === "scripts/t3-worker.mjs" && words.length === 2 && resolve(cwd) === resolve(context.fixture)) {
    return allowed(PERMISSION_CLASSES.FIXTURE_CHECK, words, { cwd, task: "T3" })
  }
  return denied(words, "node command is outside the fixture contract")
}

function classifyAtom(atom, cwd, context) {
  const stderrToDevNull = atom.command.match(/^(.*\S)\s+2>\/dev\/null$/)
  if (stderrToDevNull) {
    let inspectionWords
    try {
      inspectionWords = shellWords(stderrToDevNull[1])
    } catch (error) {
      return denied([], error.message)
    }
    const inspection = inspectionWords[0] === "git"
      ? gitInvocation(inspectionWords, cwd, context)
      : inspectInvocation(inspectionWords, cwd, context)
    return inspection?.allowed === true && inspection.classification === PERMISSION_CLASSES.READ_ONLY_INSPECTION
      ? { ...inspection, stderrToDevNull: true }
      : denied(inspectionWords, "stderr suppression is allowed only for an otherwise authorized read-only inspection")
  }
  let words
  try {
    words = shellWords(atom.command)
  } catch (error) {
    return denied([], error.message)
  }
  if (words.length === 0) return denied(words, "empty command component")
  if (words[0] === "export") {
    return words.join("\0") === OMO_NON_INTERACTIVE_ENV_WORDS.join("\0")
      ? allowed(PERMISSION_CLASSES.RUNTIME_ENV_PREAMBLE, words, { cwd })
      : denied(words, "only the exact measured OMO non-interactive environment preamble is allowed")
  }
  if (words[0] === "git") return gitInvocation(words, cwd, context)
  if (words[0] === "node") return nodeInvocation(words, cwd, context)
  if (words[0] === "rm") {
    const target = words.length === 2
      ? (isAbsolute(words[1]) ? resolve(words[1]) : resolve(cwd, words[1]))
      : null
    if (!target || !context.knownMarkerPaths?.includes(target)) {
      return denied(words, "rm is allowed only for one mechanically recognized continuation marker")
    }
    return allowed(PERMISSION_CLASSES.KNOWN_BOOKKEEPING_REMOVE, words, { cwd, path: target })
  }
  return inspectInvocation(words, cwd, context) ?? denied(words, `command is outside the disposable policy: ${words[0]}`)
}

export function continuationMarkerCandidates(command, cwd) {
  try {
    return splitShell(command).flatMap((atom) => {
      const words = shellWords(atom.command)
      return words[0] === "rm" && words.length === 2
        ? [isAbsolute(words[1]) ? resolve(words[1]) : resolve(cwd, words[1])]
        : []
    })
  } catch {
    return []
  }
}

export function evaluateExecutorLaneCommand({ command, cwd, context }) {
  if (typeof command !== "string" || typeof cwd !== "string" || !context) {
    return { allowed: false, classification: PERMISSION_CLASSES.DENIED, reason: "command, cwd, and context are required", operations: [] }
  }
  if (command.trim() === FIXTURE_SYNTAX_CHECK_LOOP && resolve(cwd) === resolve(context.fixture)) {
    return {
      allowed: true,
      classification: PERMISSION_CLASSES.FIXTURE_CHECK,
      reason: "the fixed fixture syntax-check loop is authorized",
      operations: [{
        allowed: true,
        classification: PERMISSION_CLASSES.FIXTURE_CHECK,
        words: ["for", "file", "in", "scripts/*.mjs", "node", "--check"],
        cwd: resolve(cwd),
        fixturePattern: "scripts/*.mjs",
        raw: command.trim(),
        operator: null,
      }],
    }
  }
  let atoms
  try {
    atoms = splitShell(command)
  } catch (error) {
    return { allowed: false, classification: PERMISSION_CLASSES.DENIED, reason: error.message, operations: [] }
  }
  const operations = atoms.map((atom, index) => {
    let special
    try {
      const words = shellWords(atom.command)
      const previousWords = index > 0 ? shellWords(atoms[index - 1].command) : []
      const nextWords = index + 1 < atoms.length ? shellWords(atoms[index + 1].command) : []
      if (words[0] === "env") {
        special = words.length === 1 && nextWords[0] === "grep" && nextWords[1] === "^EXECUTOR_LANE_E2E_" && atoms[index + 1].operator === "|"
          ? allowed(PERMISSION_CLASSES.READ_ONLY_INSPECTION, words, { cwd: resolve(cwd) })
          : denied(words, "env inspection must be piped only to the E2E variable-name filter")
      } else if (words[0] === "grep") {
        special = words.length === 2 && words[1] === "^EXECUTOR_LANE_E2E_" && atom.operator === "|" && previousWords[0] === "env"
          ? allowed(PERMISSION_CLASSES.READ_ONLY_INSPECTION, words, { cwd: resolve(cwd) })
          : denied(words, "grep is allowed only for the E2E environment filter")
      }
    } catch {
      // Normal classification below returns the specific syntax denial.
    }
    return { ...(special ?? classifyAtom(atom, resolve(cwd), context)), raw: atom.command, operator: atom.operator }
  })
  const rejected = operations.find((operation) => !operation.allowed)
  return {
    allowed: !rejected,
    classification: rejected?.classification ?? (operations.length === 1 ? operations[0].classification : "COMPOUND_AUTHORIZED"),
    reason: rejected?.reason ?? "every compound component is authorized",
    operations,
  }
}
