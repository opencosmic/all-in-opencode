# Child-worker worktree isolation capability

This record describes the reproducible capability probe for caller-selected child-worker working directories. It is environment-specific evidence, not a universal OpenCode or Oh My OpenAgent (OMO) guarantee and not authorization to enable production lane worktrees.

## Current measured result

**Validated with:** OpenCode 1.18.25, OMO 4.19.4, Node.js 24.20.0, Bun 1.4.0, and Darwin 24.4.0.

**Verdict:** `CALLER_SELECTED_CWD_UNAVAILABLE`

The installed OpenCode session API accepts a `directory` query when a session is created. The installed OMO normal category-worker path does not expose that primitive to the caller:

- `DelegateTaskArgs` and background `LaunchInput` contain no `cwd` or `directory` field;
- synchronous category delegation resolves the parent session directory and creates the child with that directory;
- background category delegation does the same;
- nested normal delegation therefore selects its immediate parent session directory, not a caller-selected sibling worktree.

This source evidence is decisive for the requested normal custom Executor/category-worker route. The probe did not spend an LLM call after finding that the first required control was unavailable. Tool CWD, sentinel confinement, sibling concurrency, and nested preservation remain `UNPROVEN`; they are not converted to passing results merely because no worker ran.

| Capability | Status | Evidence |
|---|---|---|
| Caller-selected normal-task child CWD | `FAILED` | Normal task and background launch inputs expose no CWD field; both session-creation paths pass the inherited parent directory. |
| Child tool execution CWD | `UNPROVEN` | No child was invoked after the binding prerequisite failed. |
| Child Git top-level | `UNPROVEN` | No child tool evidence was collected. |
| Mutation confinement | `UNPROVEN` | No worker sentinel was created. |
| Sibling worktree isolation | `UNPROVEN` | The disposable sibling topology was valid, but no runtime-bound workers operated in it. |
| Concurrent sibling isolation | `UNPROVEN` | Concurrency was not invoked without a binding mechanism. |
| Parent/change worktree unaffected by workers | `UNPROVEN` | No worker ran; absence of mutation is not worker-isolation proof. |
| Nested child CWD preservation | `UNPROVEN` | Normal delegation inherits its parent directory, but no safely bound outer child existed to exercise nested behavior. |

## Patched lab result

Isolated OMO source checkouts were patched to add one optional `directory`
argument and propagate it through synchronous and background task/category
session creation. The precedence is explicit caller directory, then parent
session directory, then the existing plugin default. The installed 4.19.4
package and production configuration were not changed; the latest runtime
validation used patched 5.0.0-beta.30 source.

The static probe classifies that checkout as `UNPROVEN`, rather than promoting
the new API surface to runtime proof. Separately isolated OpenAI-only runtime
probes against the patched 5.0.0-beta.30 source also produced an overall
`UNPROVEN` verdict:

- a normal background category child created with `directory=worktree-a` ran a
  `bash` tool without `cd` or a workdir override, reported `pwd` and Git
  top-level as `worktree-a`, reported the expected branch and shared Git common
  directory, and wrote the exact provenance sentinel only in that worktree;
- the synchronous completion race was reproduced on clean upstream source: a
  text fallback treated an assistant turn with a pending tool part as complete,
  and normal hand-back cleanup then aborted the still-running child;
- after a focused poller fix, a synchronous child created with
  `directory=worktree-a` ran a `bash` tool without `cd` or a workdir override,
  reported `pwd` and Git top-level as `worktree-a`, reported the expected branch
  and shared Git common directory, and wrote the exact provenance sentinel only
  in that worktree;
- a concurrent A/B attempt created both child sessions at their respective
  sibling worktrees, proving directory assignment/routing only; their shell
  executions were interrupted, so concurrent tool isolation and temporal
  overlap remain `UNPROVEN`;
- the tested category worker denies its own `task` tool, so nested runtime
  delegation was not exercisable; deterministic tests cover immediate-parent
  session inheritance;
- OMO created untracked `.omo/run-continuation` bookkeeping in the fixture, so
  literal parent Git cleanliness is `FAILED` even though the worker sentinel was
  confined to its selected sibling.

| Patched-lab capability | Status | Measured evidence |
|---|---|---|
| Optional `directory` API | `PROVEN` | Built patched schema/types expose the field. |
| Background session directory assignment | `PROVEN` | Child session record stored caller-selected worktree A. |
| Background actual default tool CWD | `PROVEN` | No-`cd` child shell reported worktree A. |
| Background Git identity | `PROVEN` | Top-level, branch, and common-dir matched fixture A. |
| Single-child mutation confinement | `PROVEN` | A's exact sentinel existed only in worktree A; this does not claim a completed worker B. |
| Sync session directory assignment | `PROVEN` | Sync child session record stored worktree A. |
| Sync actual tool CWD | `PROVEN` | A Luna/high no-`cd`, no-workdir child shell reported worktree A; Git identity and sentinel confinement independently matched. |
| Concurrent directory assignment/routing | `PROVEN` | A and B session records stored their respective requested worktrees. |
| Concurrent sibling tool isolation | `UNPROVEN` | Both tool executions did not complete. |
| Temporal overlap | `UNPROVEN` | No two completed execution intervals were available. |
| Nested runtime preservation | `UNPROVEN` | Tested child type could not invoke `task`. |
| Parent runtime bookkeeping cleanliness | `FAILED` | OMO wrote `.omo/run-continuation` under the base fixture. |
| Overall worktree isolation | `UNPROVEN` | Required sync, concurrency, cleanliness, and nested evidence is incomplete or failed. |

The `.omo/run-continuation` files are OMO runtime bookkeeping, not worker
sentinel escape. On every `session.idle`, the background manager's parent-wake
flush persists an idle marker through its plugin context. The parent context is
rooted at the base fixture and the child context at worktree A, so both receive
their own marker. This is intentional project-local cross-process state under
the current OMO contract and is not configurable. It independently fails
literal parent Git cleanliness while the completed worker's mutation remains
confined. The machine-readable `mutation_confinement` capability represents
this single-worker mutation fact; `sibling_worktree_isolation` remains reserved
for completed A and B evidence.

This historical runtime evidence used `openai/gpt-5.4` under the earlier model
constraint. It is retained as measured capability evidence, not presented as a
new runtime call or as compliance evidence for later model restrictions.

The later synchronous probe used only `openai/gpt-5.6-luna`. Parent and child
task turns were recorded with the `high` variant, all runtime fallback was
disabled or constrained to Luna, and session exports independently confirmed
the child directory and completed tool result. The pre-existing poller fix is
kept on a separate research branch and does not alter the caller-selected
directory PR.

## Team Mode is a separate path

OMO 4.19.4 Team Mode accepts member `worktreePath` metadata. In the installed implementation it creates that directory, records it in team runtime state, and includes it in the member prompt. Member sessions are still launched through the same background manager, whose child session directory is inherited from the parent.

That is prompt/runtime metadata, not mechanically demonstrated tool-CWD binding. Team Mode also owns native team runtime/task state, which the custom Executor deliberately does not adopt. Team Mode support therefore does not prove normal custom category-worker isolation.

## Probe

Run from the canonical repository:

```sh
node scripts/probes/worktree-isolation.mjs
```

Pass `--omo-package-root PATH` to inspect an isolated OMO build. `PATH` may be
a published-package root, where `@opencode-ai/sdk` is a sibling dependency, or
an upstream source checkout with dependencies under its own `node_modules`.
This does not change OpenCode's live configuration or installed OMO package.

The probe:

1. inspects the installed OMO public type surface and bundled session-creation paths;
2. creates a unique provenance-marked disposable Git fixture with `base/`, `worktree-a/`, and `worktree-b/` on distinct branches;
3. mechanically checks each fixture path, Git top-level, branch, and shared Git common directory;
4. emits a machine-readable JSON result with separate `PROVEN`, `FAILED`, and `UNPROVEN` capability statuses;
5. removes only a clean fixture whose prefix, marker, registered worktrees, and contained paths all match.

Use `--keep` only when the clean fixture is needed for adapter development. Cleanup refuses an unknown path, a missing/mismatched provenance marker, an unexpected registered worktree, or a dirty worktree. Refusal preserves the evidence and never escalates to force removal.

The deterministic tests cover source classification, path/provenance validation, sentinel evidence requirements, conservative cleanup, missing-capability handling, nested failure classification, and the rule that incomplete evidence cannot become `PROVEN`.

## Interpretation

`PROVEN` requires complete mechanical evidence for the specific capability. `FAILED` means decisive evidence contradicts the capability. `UNPROVEN` means required evidence was absent, incomplete, unsafe to collect, or blocked by an earlier prerequisite.

A prompt such as `WORKSPACE: /path` is not proof. Prompt compliance allows one forgotten `cd` to operate in the parent tree; runtime-enforced isolation must make the selected directory intrinsic to the child session/tool context.

`LANE_WORKTREES` and worker-driven `EPHEMERAL_SANDBOX` remain disabled for the custom Executor route. The isolated OMO patch exposes the missing primitive, but production integration is not justified while concurrency, parent cleanliness, and nested runtime evidence remain incomplete. After upstreaming or otherwise adopting the primitive in a supported OMO release, rerun the full probe and require complete child/tool/Git/sentinel/sibling/parent/concurrent/nested evidence before considering production enablement.
