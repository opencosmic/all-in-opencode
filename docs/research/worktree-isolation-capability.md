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
- the first concurrent A/B attempts exposed a separate background-completion
  race: an idle status plus a still-running tool part was accepted as completed,
  and completion cleanup aborted both barrier processes;
- after a focused research-branch fix made active `pending`/`running` tool parts
  block background completion, two normal background category children ran the
  causal barrier from caller-selected worktrees A and B. Both no-`cd`,
  no-workdir shell processes completed, each observed the peer's start marker,
  and their monotonic intervals overlapped;
- the parent harness independently verified each child's `pwd`, Git top-level,
  branch, shared Git common directory, exact sentinel content/hash, absence of
  cross-sentinels, and absence of worker sentinels in base;
- a probe-local native `plan` outer worker was allowed exactly one normal sync
  `task` delegation while the nested category denied its own `task` and
  `call_omo_agent` tools. The outer task was explicitly bound to worktree A;
  the nested task input contained no `directory`, `cwd`, or `workdir` field;
- the nested session's parent was the outer session, both stored worktree A as
  their directory, and both no-`cd`, no-workdir shell tools reported worktree A,
  the expected A branch, and the shared Git common directory. Exact outer and
  nested provenance sentinels existed only in A, with neither sentinel in base
  or worktree B;
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
| Worker A actual tool CWD | `PROVEN` | Luna/high child shell ran intrinsically from worktree A and reported the expected Git identity. |
| Worker B actual tool CWD | `PROVEN` | Luna/high child shell ran intrinsically from worktree B and reported the expected Git identity. |
| Concurrent sibling tool isolation | `PROVEN` | Both normal delegated child tools completed in distinct caller-selected sibling worktrees under a causal barrier. |
| Temporal overlap | `PROVEN` | `max(A.start,B.start) < min(A.end,B.end)` and both workers recorded `peerObserved=true`. |
| Sibling mutation confinement | `PROVEN` | Each exact provenance sentinel existed only in its own worktree; neither cross-sentinel existed. |
| Parent worker mutation confinement | `PROVEN` | Neither worker sentinel existed in base. Coordination state was deliberately outside all Git worktrees. |
| Nested runtime preservation | `PROVEN` | A normal outer `plan` task explicitly bound to A delegated a normal nested category task with no directory field. The nested session inherited A from its immediate parent, its no-`cd` tool ran in A with the expected Git identity, and its exact sentinel existed only in A. |
| Parent runtime bookkeeping cleanliness | `FAILED` | OMO wrote `.omo/run-continuation` under the base fixture. |
| Worker-isolation capability | `PROVEN_ON_MEASURED_PATH` | Worker CWD, Git identity, sentinel confinement, concurrent sibling execution, temporal overlap, and nested inheritance are mechanically proven on the measured patched OMO path. |
| Literal parent bookkeeping cleanliness | `FAILED` | OMO-owned project-local runtime state makes the fixture literally dirty. This fact is retained separately from worker isolation. |
| Runtime-bookkeeping policy | `RESOLVED` | Exact, session-proven OMO continuation markers do not invalidate worker-isolation evidence; unknown `.omo` mutations remain blocking. |

The `.omo/run-continuation` files are OMO runtime bookkeeping, not worker
sentinel escape. On every `session.idle`, the background manager's parent-wake
flush persists an idle marker through its plugin context. The parent context is
rooted at the base fixture and the child context at worktree A, so both receive
their own marker. This is intentional project-local cross-process state under
the measured OMO contract and is not configurable. It independently fails
literal parent Git cleanliness while the completed worker's mutation remains
confined.

### Runtime-bookkeeping policy

The probe and future Executor lifecycle classify raw changed paths before making
an isolation decision:

- `WORKER_MUTATION` is a source/test/config mutation attributable to a worker.
  A mutation outside that worker's assigned worktree, including a sibling or
  base worktree, is a hard isolation failure.
- `KNOWN_OMO_RUNTIME_BOOKKEEPING` is only an exact
  `.omo/run-continuation/<session-id>.json` marker whose path, known current
  session ID, session directory, plugin context, and measured marker shape all
  agree. It preserves a `FAILED` literal-cleanliness fact but does not negate
  worker mutation confinement.
- `UNKNOWN_MUTATION` includes every other `.omo` path, an unknown session ID,
  a mismatched worktree, or malformed continuation JSON. It is preserved and
  blocks an isolation/lifecycle conclusion until investigated; `.omo/**` is
  never broadly ignored.

Worker mutation cleanliness, runtime bookkeeping cleanliness, and literal Git
cleanliness are therefore separate facts. The existing machine-readable
confinement fields continue to represent worker mutation evidence; literal
bookkeeping cleanliness remains `FAILED` for the historical probes.

This historical runtime evidence used `openai/gpt-5.4` under the earlier model
constraint. It is retained as measured capability evidence, not presented as a
new runtime call or as compliance evidence for later model restrictions.

The later synchronous probe used only `openai/gpt-5.6-luna`. Parent and child
task turns were recorded with the `high` variant, all runtime fallback was
disabled or constrained to Luna, and session exports independently confirmed
the child directory and completed tool result. The pre-existing poller fix is
kept on a separate research branch and does not alter the caller-selected
directory PR.

The concurrent probe also used only `openai/gpt-5.6-luna`. Its isolated
OpenCode parent and OMO category configuration pinned Luna with `high`
reasoning, disabled model/runtime fallback, and set an exact test-only model
concurrency of two. Runtime logs recorded only OpenAI Luna streams. Child
assistant records did not expose a per-request variant field, so `high` for
those turns is supported by the mechanically retained effective category
configuration rather than inferred from prose. The live OpenCode database
session count was unchanged (111 before and after), because all probe state was
rooted under isolated XDG directories.

The nested probe's accepted run also used only `openai/gpt-5.6-luna` at
`high`. A no-inference preflight recorded the parent and native `plan` outer
agent as Luna/high, constrained the nested category to Luna/high, disabled
model/runtime fallback, and disabled OMO plan replacement only inside the
disposable fixture. Runtime logs and assistant records then recorded every
parent, outer, and nested request as OpenAI Luna/high. The live database session
count remained 111 before and after because the probe used isolated XDG state.
Machine evidence for probe `40d7f56b-80a2-45e9-aa2d-82de390d19d8` recorded
outer session `ses_fa74777cbffenQCPao2FrfP5n7`, nested session
`ses_fa7474550ffeJAuXPVFdzplLHI`, and the required immediate-parent directory
inheritance. The disposable fixture was removed by provenance-aware cleanup;
the raw isolated session dump remains local and is not committed.

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

The LLM-consuming companion probe is opt-in only:

```sh
node scripts/probes/worktree-concurrent-runtime.mjs --run \
  --omo-package-root /path/to/built/omo \
  --evidence-dir /path/to/evidence \
  --model openai/gpt-5.6-luna
```

It preflights the isolated routing before any LLM request, creates the same
provenance-owned topology plus an external `coordination/` directory, launches
two normal background `task` calls in one batch, requires both child shell
processes to cross a bounded causal barrier, classifies machine evidence, and
removes only recognized sentinels/bookkeeping before invoking conservative
fixture cleanup. Without `--run`, it makes no runtime LLM call.

The two-level nested companion is likewise opt-in:

```sh
node scripts/probes/worktree-nested-runtime.mjs --run \
  --omo-package-root /path/to/built/omo \
  --evidence-dir /path/to/evidence \
  --model openai/gpt-5.6-luna
```

It explicitly binds one normal sync outer task to worktree A, requires that
outer to make exactly one normal nested category call with no directory field,
and independently classifies the session hierarchy, task inputs, tool records,
Git identity, sentinels, routing, and OMO bookkeeping. `--preflight-only`
validates routing and cleans the disposable fixture without invoking an LLM;
without `--run`, the script only prints usage.

## Interpretation

`PROVEN` requires complete mechanical evidence for the specific capability. `FAILED` means decisive evidence contradicts the capability. `UNPROVEN` means required evidence was absent, incomplete, unsafe to collect, or blocked by an earlier prerequisite.

A prompt such as `WORKSPACE: /path` is not proof. Prompt compliance allows one forgotten `cd` to operate in the parent tree; runtime-enforced isolation must make the selected directory intrinsic to the child session/tool context.

`LANE_WORKTREES` and worker-driven `EPHEMERAL_SANDBOX` remain disabled for the custom Executor route. The isolated OMO patch exposes the missing primitive, and concurrent sibling execution plus immediate-parent nested preservation are mechanically proven on the measured path. The bookkeeping policy is resolved, but this is not production OMO compatibility and the Executor lane lifecycle is not yet implemented. A future production implementation must classify raw changed paths with this policy, complete its own end-to-end gate, and re-establish the complete child/tool/Git/sentinel/sibling/parent/concurrent/nested evidence against the adopted runtime.
