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

## Agent responsibilities

- Strategist: product strategy and OpenSpec product-contract authoring.
- Researcher and Validator: read-only evidence and adversarial product validation.
- Planner: engineering design and executable task planning.
- Plan Reviewer: independent, read-only planning review.
- Executor: implementation orchestration and task-state ownership.
- Reviewer: independent diff-first code review.
- QA: read-only runtime and user-facing evidence.
- Verifier: independent final proof against the approved change.

## CodeGraph

CodeGraph 1.5.0 was the validated OMO-owned runtime version. It supplies derived structural/index evidence only. The custom workflow exposes only `codegraph_codegraph_explore` to Planner, Plan Reviewer, Executor, Reviewer, and Verifier. No custom lifecycle, durable graph state, or additional impact/caller/callee/node/search/file/status surface is introduced.

## Live source model

`scripts/links.tsv` is the auditable source-to-live manifest. The installer validates all sources and live content before changing anything, backs up every replaced path before creating a link, rejects unexpected symlinks, and retains a checksum inventory. `scripts/verify.sh` proves link targets and frozen production hashes.

Installer backups default to `$OPENCODE_WORKFLOW_DATA_ROOT/backups/migrations`, falling back to `~/Workspace/data/opencode-workflow/backups/migrations`. Benchmarks and backups are never live link targets.

OpenSpec's global telemetry configuration remains local and independently owned. This is intentional partial canonicalization: public safety takes precedence over forcing every live file into Git.
