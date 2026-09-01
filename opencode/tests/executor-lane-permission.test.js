import test from "node:test"
import assert from "node:assert/strict"

import {
  continuationMarkerCandidates,
  evaluateExecutorLaneCommand,
  OMO_NON_INTERACTIVE_ENV_PREAMBLE,
  PERMISSION_CLASSES,
} from "../../scripts/lib/executor-lane-permission.mjs"

const root = "/tmp/executor-lane-e2e-owned"
const context = {
  root,
  fixture: `${root}/fixture`,
  head: "a".repeat(40),
  commonDir: `${root}/fixture/.git`,
  lanes: { T1: `${root}/lanes/T1`, T2: `${root}/lanes/T2` },
  branches: { T1: "fixture-change--lane-T1-e2e", T2: "fixture-change--lane-T2-e2e" },
  knownMarkerPaths: [`${root}/lanes/T1/.omo/run-continuation/ses_known.json`],
}

const decide = (command, cwd = context.fixture) => evaluateExecutorLaneCommand({ command, cwd, context })

test("safe compound read-only inspection is allowed semantically", () => {
  const result = decide(`ls -ld ${root}; ls -ld ${root}/lanes; true`)
  assert.equal(result.allowed, true)
  assert.equal(result.classification, "COMPOUND_AUTHORIZED")
  assert.deepEqual(result.operations.map((entry) => entry.classification), [
    PERMISSION_CLASSES.READ_ONLY_INSPECTION,
    PERMISSION_CLASSES.READ_ONLY_INSPECTION,
    PERMISSION_CLASSES.READ_ONLY_INSPECTION,
  ])
})

test("disposable-root inspection is authorized but unrelated container mutation is denied", () => {
  assert.equal(decide("ls -ld lanes", root).allowed, true)
  assert.equal(decide("mkdir lanes").allowed, false)
  assert.equal(decide("mkdir unrelated").allowed, false)
})

test("the fixed read-only fixture syntax-check loop is authorized without general shell expansion", () => {
  const result = decide('for file in scripts/*.mjs; do node --check "$file"; done')
  assert.equal(result.allowed, true)
  assert.equal(result.classification, PERMISSION_CLASSES.FIXTURE_CHECK)
  assert.equal(decide('for file in ../*.mjs; do node --check "$file"; done').allowed, false)
  assert.equal(decide('for file in scripts/*.mjs; do rm "$file"; done').allowed, false)
})

test("safe chained Git inspection is allowed", () => {
  const result = decide("pwd; git status --short --branch; git log --oneline -10; git submodule status; git worktree list --porcelain")
  assert.equal(result.allowed, true)
  assert.equal(result.operations.length, 5)
})

test("read-only stderr suppression is normalized without allowing general redirection", () => {
  const result = decide("ls -ld . lanes lanes/T1 lanes/T2 2>/dev/null || true")
  assert.equal(result.allowed, true)
  assert.equal(result.operations[0].classification, PERMISSION_CLASSES.READ_ONLY_INSPECTION)
  assert.equal(result.operations[0].stderrToDevNull, true)
  assert.equal(decide("git status --short 2>/dev/null").allowed, true)
  assert.equal(decide("git status --short >/dev/null").allowed, false)
  assert.equal(decide("node scripts/t3-worker.mjs 2>/dev/null").allowed, false)
})

test("outside inspection path is denied", () => {
  assert.equal(decide("ls /unrelated/path").allowed, false)
  assert.equal(decide(`ls ${root}/runtime/data/opencode/auth.json`).allowed, false)
})

test("only the exact owned lane creation is allowed", () => {
  const expected = decide(`git worktree add -b ${context.branches.T1} ${context.lanes.T1} ${context.head}`)
  const unknown = decide(`git worktree add -b unknown ${root}/lanes/unknown ${context.head}`)
  assert.equal(expected.classification, PERMISSION_CLASSES.OWNED_LANE_CREATE)
  assert.equal(expected.allowed, true)
  assert.equal(unknown.allowed, false)
})

test("only an expected owned lane merge is allowed", () => {
  assert.equal(decide(`git merge --no-ff --no-edit ${context.branches.T1}`).allowed, true)
  assert.equal(decide("git merge --no-ff --no-edit unknown").allowed, false)
})

test("owned staging and commit are exact and lane scoped", () => {
  assert.equal(decide("git add src/a.txt", context.lanes.T1).allowed, true)
  assert.equal(decide("git add src/b.txt", context.lanes.T1).allowed, false)
  assert.equal(decide("git commit -m 'T1: add A'", context.lanes.T1).allowed, true)
  assert.equal(decide("git commit -m 'other'", context.lanes.T1).allowed, false)
})

test("normal owned worktree removal is allowed and forced removal is denied", () => {
  assert.equal(decide(`git worktree remove ${context.lanes.T1}`).allowed, true)
  assert.equal(decide(`git worktree remove --force ${context.lanes.T1}`).allowed, false)
})

test("safe branch deletion is allowed and force deletion is denied", () => {
  assert.equal(decide(`git branch -d ${context.branches.T1}`).allowed, true)
  assert.equal(decide(`git branch -D ${context.branches.T1}`).allowed, false)
})

test("only a mechanically pre-recognized continuation marker can be removed", () => {
  assert.equal(decide(`rm ${context.knownMarkerPaths[0]}`, context.lanes.T1).allowed, true)
  assert.equal(decide(`rm ${root}/lanes/T1/.omo/run-continuation/ses_unknown.json`, context.lanes.T1).allowed, false)
  assert.equal(decide(`rm ${root}/lanes/T1/.omo/run-continuation/ses_*.json`, context.lanes.T1).allowed, false)
})

test("relative continuation markers resolve against the effective tool CWD", () => {
  const command = "rm .omo/run-continuation/ses_known.json"
  assert.deepEqual(continuationMarkerCandidates(command, context.lanes.T1), [context.knownMarkerPaths[0]])
  assert.equal(decide(command, context.lanes.T1).allowed, true)
  assert.equal(decide(command, context.fixture).allowed, false)
})

test("destructive reset, clean, force deletion, and recursive removal are denied", () => {
  for (const command of [
    "git reset --hard",
    "git clean -ffdx",
    `git branch -D ${context.branches.T1}`,
    `git worktree remove --force ${context.lanes.T1}`,
    `rm -rf ${context.lanes.T1}`,
  ]) assert.equal(decide(command).allowed, false, command)
})

test("fixture checks and worker commands are bound to their expected workspace", () => {
  assert.equal(decide("node scripts/check-task.mjs T1", context.lanes.T1).allowed, true)
  assert.equal(decide("node scripts/check-task.mjs T1", context.fixture).allowed, false)
  assert.equal(decide("node scripts/lane-worker.mjs T2", context.lanes.T2).allowed, true)
  assert.equal(decide("node scripts/t3-worker.mjs", context.fixture).allowed, true)
})

test("the finite baseline inspection contract is authorized without general shell permission", () => {
  assert.equal(decide("node --version").classification, PERMISSION_CLASSES.READ_ONLY_INSPECTION)
  assert.equal(decide("test ! -e src/a.txt").allowed, true)
  assert.equal(decide("test ! -e src/b.txt").allowed, true)
  assert.equal(decide("test ! -e src/combined.txt").allowed, true)
  assert.equal(decide("test ! -e ../outside").allowed, false)
  assert.equal(decide("test -e src/a.txt").allowed, false)
  assert.equal(decide("printf 'BASELINE_PASS\\n'").allowed, true)
  assert.equal(decide("printf arbitrary").allowed, false)
  assert.equal(decide("printf 'PORT=%s TOKEN_SET=%s\\n' \"${EXECUTOR_LANE_E2E_PORT:-}\" \"${EXECUTOR_LANE_E2E_TOKEN:+yes}\"").allowed, true)
  assert.equal(decide("printf '%s\\n' \"${EXECUTOR_LANE_E2E_TOKEN}\"").allowed, false)
  assert.equal(decide("printf '%s\\n' \"${HOME}\"").allowed, false)
  assert.equal(decide("mkdir lanes", context.root).classification, PERMISSION_CLASSES.OWNED_PROBE_LAYOUT_PREPARE)
  assert.equal(decide("mkdir unrelated", context.root).allowed, false)
  assert.equal(decide("mkdir lanes", context.fixture).allowed, false)
})

test("complete baseline compound is authorized only because every atom is safe", () => {
  const command = "node --version && node --check scripts/lane-worker.mjs && node --check scripts/check-task.mjs && node --check scripts/check-wave.mjs && node --check scripts/t3-worker.mjs && node --check scripts/check-final.mjs && test ! -e src/a.txt && test ! -e src/b.txt && test ! -e src/combined.txt && printf 'BASELINE_PASS\\n'"
  assert.equal(decide(command).allowed, true)
  assert.equal(decide(`${command} && mkdir unrelated`).allowed, false)
})

test("shell expansion, substitution, redirection, and unknown network commands are denied", () => {
  for (const command of [
    "ls $HOME",
    "ls $(pwd)",
    "git status > /tmp/status",
    "curl https://example.com",
  ]) assert.equal(decide(command).allowed, false, command)
})

test("environment inspection is limited to the E2E prefix pipeline", () => {
  assert.equal(decide("env | grep '^EXECUTOR_LANE_E2E_' || true").allowed, true)
  assert.equal(decide("env").allowed, false)
  assert.equal(decide("env | grep TOKEN").allowed, false)
})

test("only the exact OMO-owned non-interactive environment preamble is normalized", () => {
  const allowed = decide(`${OMO_NON_INTERACTIVE_ENV_PREAMBLE}; git status --short`)
  assert.equal(allowed.allowed, true)
  assert.equal(allowed.operations[0].classification, PERMISSION_CLASSES.RUNTIME_ENV_PREAMBLE)
  assert.equal(decide(`${OMO_NON_INTERACTIVE_ENV_PREAMBLE} EXTRA=value; git status --short`).allowed, false)
  assert.equal(decide("export CI=true; git status --short").allowed, false)
})
