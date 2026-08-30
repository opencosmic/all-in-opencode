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

## Team Mode is a separate path

OMO 4.19.4 Team Mode accepts member `worktreePath` metadata. In the installed implementation it creates that directory, records it in team runtime state, and includes it in the member prompt. Member sessions are still launched through the same background manager, whose child session directory is inherited from the parent.

That is prompt/runtime metadata, not mechanically demonstrated tool-CWD binding. Team Mode also owns native team runtime/task state, which the custom Executor deliberately does not adopt. Team Mode support therefore does not prove normal custom category-worker isolation.

## Probe

Run from the canonical repository:

```sh
node scripts/probes/worktree-isolation.mjs
```

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

`LANE_WORKTREES` and worker-driven `EPHEMERAL_SANDBOX` remain disabled for the custom Executor route. A follow-up implementation task is not justified until OMO exposes the OpenCode child-session directory primitive (or an equivalent host-enforced mechanism) to normal category delegation. If that changes, rerun the probe and require complete child/tool/Git/sentinel/sibling/parent/concurrent/nested evidence before considering production enablement.
