# Using the workflow

## Ordinary work

Use Assistant for normal questions and bounded work. It may answer directly, inspect the codebase, make a truly small safe edit, or choose one specialist:

- Explorer for local code and architecture evidence.
- Librarian for upstream documentation and version-specific behavior.
- Technical Advisor for a difficult design decision with meaningful alternatives.

Non-trivial implementation flows through `delegate_task(category=...)` to Implementer. Use `load_skills=["skill-name"]` only for selected specialized instructions. Use `git` only when the Git operation and authority are explicit. For browser work, use `/browser` for the dedicated Browser agent or ask Assistant, which routes it through `browser-automation` with `load_skills=["ego-browser"]` to the currently installed browser backend. Both entry paths are intentionally retained.

The category catalog is dynamic. Built-ins are centrally defined; `opencode/categories.json` can add, override, or disable entries. Each enabled entry uses one `model`, an optional `variant`, an optional `prompt_append`, and optional tool narrowing. It does not support model arrays, fallback models, or `reasoning`.

Assistant uses todos for meaningful multi-step work and verifies results before reporting completion. It does not silently create OpenSpec changes.

## Formal workflow

```text
approved product strategy
  -> /spec <strategy>
  -> proposal.md + specs/**
  -> /plan <change>
  -> design.md + tasks.md + independent Plan Reviewer
  -> /execute <change>
  -> isolated implementation + review + deterministic Git integration
  -> /verify <change>
  -> /ship <change>
```

`/spec` owns product behavior, not engineering design. `/plan` owns engineering design and unchecked tasks, not implementation. Technical Advisor may advise Planner on a genuinely difficult choice; Plan Reviewer remains the separate mandatory approval gate.

`/execute` treats `tasks.md` as the durable progress source. It prepares isolated workspaces only from sufficient committed baselines, launches independent ready tasks in one background group, yields, and resumes once when the group is terminal. It then retrieves outputs, inspects diffs, obtains Reviewer/QA evidence, uses `git` for authorized task-local commits and integration, runs combined checks, updates checkboxes, and releases clean integrated workspaces.

If commit authority is absent, Executor preserves the workspace and reports integration pending. It never fakes completion or uses a normal Implementer to duplicate reviewed changes in canonical.

`/verify` independently proves the current implementation against the product contract. `/ship` preserves the existing explicit integration menu and never infers push, PR, deploy, cleanup, or archive authority.

## Background work

Launch independent tasks together only when dependencies and write scopes make that safe. After launch, do unrelated useful work or yield. Do not poll task state in a loop. The runtime records completion and wakes the idle parent exactly once for the terminal group. Use `task_output` after that wake. `task_cancel` aborts a child but preserves its workspace.

## CodeGraph

Run `./scripts/setup-codegraph.sh` once per machine/repository and `./scripts/check-codegraph.sh` for health. Explorer uses the graph for architecture, structural relationships, and cross-file flow. If the index is unavailable, pending, stale, or insufficient, use ordinary source tools immediately. Always use real source, diffs, tests, and runtime evidence for correctness.

## Browser automation

Before first browser use, run:

```sh
./scripts/setup-ego-browser.sh
./scripts/check-ego-browser.sh
```

The dedicated user-facing route is `/browser` and the Assistant category route is `browser-automation`; Ego Lite is only the current backend. Login, CAPTCHA, MFA, payment, security confirmation, and user takeover remain human-control boundaries. Browser work must verify the resulting page state and must not mutate repository files.
