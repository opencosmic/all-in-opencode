---
description: Formalize an approved product strategy as OpenSpec proposal and behavioral specs
agent: Strategist
subtask: false
---

Formalize approved product intent into the product half of a standard OpenSpec change. Stop before engineering design, tasks, or implementation.

Strategy argument:

`$ARGUMENTS`

## Resolve readiness and target

1. Work only in the target project/repository. If the current directory is the user's home directory or the project root is ambiguous, stop and ask the user to open the intended project.
2. Resolve one APPROVED strategy from the explicit path or canonical `.product/strategy/`. With no argument, infer only one unambiguous APPROVED strategy; otherwise ask and stop.
3. Require a defined problem, target customer, selected wedge/behavior, scope, non-goals, contradictory evidence/key assumptions, success criteria, and accepted locked decisions. If a decision-critical product question remains, stop and return it to Strategist.

## Change-workspace placement gate — before persistent artifacts

Before `openspec init`, `openspec new change`, or any proposal/spec write, CALL the `workspace_inspect` tool directly from the tool catalog, passing the selected strategy path and intended worktree base (default `HEAD`). `workspace_inspect` is a callable OpenCode/AIO tool, not an executable or shell command. Do not use Bash, `command -v workspace_inspect`, `git status`, `git worktree`, or `git rev-parse`; shell Git inspection is not a substitute. Use its returned structured result for the placement decision. If the `workspace_inspect` tool is unavailable or its call fails, STOP before writing any OpenSpec artifact and report a tool/runtime blocker. The OpenSpec CLI commands below, such as `openspec init`, `openspec new change`, and `openspec status`, are real shell commands under the existing permissions; that distinction does not apply to `workspace_inspect`. This is a placement gate, not product strategy and not Git management by Strategist.

- Reuse the current workspace when it is already a suitable linked worktree (a submodule does not count), or select `IN_PLACE` when it safely owns this one change.
- Before a `CHANGE_WORKTREE` handoff, require `strategySource.availableFromBase: true`: the selected approved strategy must exist unchanged in the Git base from which the worktree will be created. A tracked-and-clean strategy available from that base may proceed.
- If the selected strategy is untracked, modified from the intended base, missing/absent from that base, outside the repository, or the base cannot be verified, stop before writing any OpenSpec artifact. Explain that the approved strategy content exists only in or differs within the current working tree and require an explicit user decision: preserve/commit the strategy source first and then create/select isolation, or continue `IN_PLACE`.
- If unrelated dirty work exists, another independent OpenSpec change is active, the user requested an isolated/parallel branch, or the current workspace must be preserved, select `CHANGE_WORKTREE` only after the strategy-source check passes. Ask the user to create/select a host-native OpenCode workspace when available, or an explicitly approved manual worktree, then rerun `/spec` there.
- Do not create, switch, move, reset, remove, merge, or clean a worktree; never silently commit, stash, copy, move, delete, or otherwise migrate the strategy/user files; do not use OpenCode session `moveChanges`.

Once proposal/spec artifacts exist, their current workspace is canonical. Report `Execution topology placement: IN_PLACE|CHANGE_WORKTREE` in the handoff, but create no topology ledger or workspace-state file. A later Planner may recommend structure, and Executor resolves runtime scheduling; neither creates a second canonical change directory.

## Initialize standard OpenSpec without global coupling

If `openspec/config.yaml` is absent, run exactly:

`openspec init . --tools none --profile core --no-animation --no-copilot-cloud`

This initializes OpenSpec in the project without globally discovered OpenSpec skills or commands. Do not initialize in `$HOME`. If OpenSpec already exists, preserve its project config and generated integrations. Require the standard `spec-driven` schema unless the project intentionally uses another compatible schema; never overwrite an intentional project choice.

Do not modify global OpenSpec configuration. Add project-level context/rules only when necessary and preserve all existing content.

## Create the product contract

Derive or accept one kebab-case change name. Check `openspec list --json`; create only through `openspec new change <name> --schema spec-driven --json`, or continue a clearly matching existing product-only change.

Use the exact current CLI outputs rather than remembered templates:

1. `openspec status --change <name> --json`
2. `openspec instructions proposal --change <name> --json`
3. Write only the returned `proposal.md`, establishing WHY, WHAT changes, capabilities, scope/non-goals, and product-impact constraints without engineering design.
4. `openspec instructions specs --change <name> --json`
5. Write only the required `specs/**/spec.md` delta files. Specify observable requirements, invariants, inputs/outputs, product-visible failure behavior, and testable `#### Scenario` blocks. Use implementation-independent behavior; security/privacy/reliability constraints belong here only when they are part of the product contract.

Do not create `design.md`, `tasks.md`, or application code. Never use `/opsx-apply`.

Run `openspec validate <name> --type change --strict --no-interactive --json` and inspect final status. Distinguish intentional downstream incompleteness from malformed proposal/specs; actual structural or contract errors block handoff.

Finish with the change name, product artifact paths, workspace/topology placement, validation/status evidence, and `/plan <change>`. Do not invoke the planner automatically.
