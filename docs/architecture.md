# Architecture

## Ownership boundaries

This repository owns authored OpenCode agents, commands, plugins, tests, and public-safe OpenCode and OMO configuration. Live entrypoints are symlinks to that source at the smallest audited granularity.

OpenCode owns its installed packages and local UI/runtime material. OMO owns its runtime, daemon data, downloaded tools, native state, and CodeGraph provisioning. OpenSpec owns project contracts and changes inside each target project. The global OpenSpec telemetry file remains local. Git repositories used as benchmark targets remain independent.

Project-owned local evidence and backups live under `${OPENCODE_WORKFLOW_DATA_ROOT:-$HOME/Workspace/data/opencode-workflow}`. The default layout separates `benchmarks/<experiment-id>` from `backups/` for OpenCode, OpenSpec, OMO, and migration snapshots. These data trees are neither Git source nor application runtime and must not be recreated inside application configuration roots.

## Custom lifecycle

```text
approved product direction
          |
          v
        /spec
          |
          v
 proposal.md + specs/**
          |
          v
        /plan
          |
          v
 design.md + tasks.md -> Plan Reviewer
          |
          v
       /execute -> Reviewer / QA
          |
          v
       /verify
          |
          v
        /ship
```

Every execution and shipping gate re-evaluates current artifacts and evidence. Prior conversational approval is advisory, not durable authority. `tasks.md` is the only durable custom execution checklist and progress state.

Executor supports `IN_PLACE`, `CHANGE_WORKTREE`, and a capability-gated `LANE_WORKTREES` lifecycle; `EPHEMERAL_SANDBOX` remains disabled and unimplemented. Lane mode requires exact adopted runtime evidence plus at least two independently safe dependency-ready tasks. Executor creates current-wave linked worktrees from one canonical HEAD, dispatches workers through the runtime `directory` field, inspects and reviews lane diffs, integrates accepted commits in task order with non-fast-forward merges, runs combined checks, then updates `tasks.md`. Interruption and ambiguous state preserve lanes. Recovery derives from `tasks.md` and Git/worktree provenance rather than a second ledger. Production is now pinned to the exact measured OMO artifact recorded in the runtime baseline; the capability and topology gates still decide each execution.

## Independent browser route

```text
/ego <task>
    |
    v
Ego Browser
    |
    v
upstream ego-browser skill
    |
    v
ego-browser runtime
    |
    v
ego lite Task Space
```

This is an independent browser-automation capability, not another stage in the custom lifecycle. It does not enter OpenSpec, create or mutate implementation execution state, use an OMO category, use CodeGraph, or modify project source code. Ego Browser is primary-only in Phase 1, so the existing coding roles do not automatically delegate to it or gain its skill/runtime access.

The external [`citrolabs/ego-lite`](https://github.com/citrolabs/ego-lite) project owns the official `skills/ego-browser/SKILL.md`, runtime, browser application, Task Spaces, and browser state. This repository owns only the agent policy, `/ego` route, tests, and documentation; it does not vendor or link the upstream skill lifecycle.

The outer OpenCode shell policy permits only `ego-browser *`, but `ego-browser` executes agent-authored JavaScript in Node.js. That command restriction is not an OS-level security sandbox. The agent policy therefore also prohibits using the runtime for unrelated filesystem access, child-process execution, arbitrary processes, or repository mutation. This is a behavioral boundary layered on least-privilege OpenCode routing, not hard process isolation.

## Agent responsibilities

- Strategist: product strategy and OpenSpec product-contract authoring.
- Researcher and Validator: read-only evidence and adversarial product validation.
- Planner: engineering design and executable task planning.
- Plan Reviewer: independent, read-only planning review.
- Executor: implementation orchestration and task-state ownership.
- Reviewer: independent diff-first code review.
- QA: read-only runtime and user-facing evidence.
- Verifier: independent final proof against the approved change.
- Ego Browser: primary-only real-browser automation through the externally owned ego-browser runtime; no repository, delegation, OMO, or CodeGraph role.

## CodeGraph

CodeGraph 1.5.0 was the validated OMO-owned runtime version. It supplies derived structural/index evidence only. The custom workflow exposes only `codegraph_codegraph_explore` to Planner, Plan Reviewer, Executor, Reviewer, and Verifier. No custom lifecycle, durable graph state, or additional impact/caller/callee/node/search/file/status surface is introduced.

## Live source model

`scripts/links.tsv` is the auditable source-to-live manifest. The installer validates all sources and live content before changing anything, backs up every replaced path before creating a link, rejects unexpected symlinks, and retains a checksum inventory. `scripts/verify.sh` proves link targets and frozen production hashes.

Installer backups default to `$OPENCODE_WORKFLOW_DATA_ROOT/backups/migrations`, falling back to `~/Workspace/data/opencode-workflow/backups/migrations`. Benchmarks and backups are never live link targets.

OpenSpec's global telemetry configuration remains local and independently owned. This is intentional partial canonicalization: public safety takes precedence over forcing every live file into Git.
