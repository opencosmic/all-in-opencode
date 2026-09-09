# OpenCode workflow

This repository is the canonical authored source for a workflow-owned OpenCode/OpenSpec system. It uses stock OpenCode public plugin and SDK APIs, Git worktrees, an independent CodeGraph MCP server, and an external browser runtime. It has no Oh My OpenAgent runtime dependency.

## Workflows

`Assistant` handles ordinary work: explanations, investigation, bounded implementation, documentation, reviews, dependency research, Git mechanics, and browser interaction. It answers or edits directly when work is truly small, consults read-only specialists when evidence improves correctness, and routes non-trivial implementation through `delegate_task(category=...)` to `Implementer`.

The formal lifecycle is:

```text
/spec -> Strategist -> proposal.md + specs/**
/plan -> Planner -> design.md + tasks.md -> Plan Reviewer
/execute -> Executor -> Implementer -> Reviewer/QA -> git category
/verify -> Verifier
/ship -> Executor
```

OpenSpec `tasks.md` is the only durable execution-progress source of truth. Runtime task and workspace manifests hold infrastructure provenance and recovery evidence, not workflow decisions.

## Agents

Primary agents are `Assistant`, `Browser`, `Strategist`, `Planner`, and `Executor`. `Verifier` is the independent verification role used by the formal route. Read-only specialists are:

- `Explorer`: local source, symbols, architecture, and call/data-flow discovery.
- `Librarian`: official external documentation, upstream source, APIs, releases, and version-specific behavior.
- `Technical Advisor`: trigger-only consultation for difficult technical decisions; never an approval gate.
- `Plan Reviewer`: independent `[APPROVED]` / `[REJECTED]` plan gate.
- `Researcher`, `Validator`, `Reviewer`, and `QA`: bounded product evidence, falsification, code review, and runtime evidence.

Named delegation is fail closed. Only the repository-owned specialist allowlist is accepted.

## Delegation Runtime

The runtime exposes exactly six tools:

- `workspace_prepare`
- `delegate_task`
- `task_status`
- `task_output`
- `task_cancel`
- `workspace_release`

`CategoryEngine` maps the current enabled category registry to one reusable `Implementer`. Built-ins are preserved in the registry, while `opencode/categories.json` can override a built-in, add a custom category, or disable one without JavaScript changes. The `delegate_task` description presents the resolved catalog at startup.

Categories define the model, optional variant, execution mindset, and optional tool narrowing. The V1 schema is intentionally small:

```json
{
  "categories": {
    "deep": { "model": "openai/gpt-5.6-sol", "variant": "max" },
    "backend-heavy": {
      "description": "Complex backend implementation work",
      "model": "provider/model",
      "variant": "high",
      "prompt_append": "Check failure and data-integrity paths."
    },
    "unused-category": { "disable": true }
  }
}
```

Each enabled category has exactly one configured `model` and may have one string `variant`; there are no model arrays, fallback models, or category-level `reasoning` fields. A category still routes only to the reusable Implementer. Skills are separate specialized instructions and are injected only when selected, for example `delegate_task(category="deep", load_skills=["debugging"], ...)`.

Independent background launches in one parent turn form one completion group. The parent does unrelated work or yields. `CompletionTracker` records terminal state and `ParentResumeCoordinator` resumes the idle parent exactly once after the group is terminal. The parent then retrieves bounded results with `task_output`; it does not run a model-driven polling loop.

Release is provenance-bound and non-destructive. The runtime accepts direct ancestry or Git-proven patch equivalence; after a cherry-pick it can remove the clean worktree while retaining the non-ancestor source branch instead of force-deleting it.

Executor prepares isolated workspaces, launches ready independent implementation categories, inspects real diffs, obtains Reviewer/QA evidence, determines integration order, and uses `category="git"` for explicitly authorized Git mechanics. The Git category may stage, create task-local commits, inspect history, and integrate selected SHAs, but cannot reset, clean, force-remove, force-push, or silently discard user changes. A normal implementation category is never used to re-apply an isolated diff into canonical.

## CodeGraph

CodeGraph is configured directly as a public local MCP server in [`opencode/opencode.jsonc`](opencode/opencode.jsonc):

```text
codegraph serve --mcp
```

The stable OpenCode tool is `codegraph_codegraph_explore`. Explorer is its main consumer. Other structurally relevant roles may use it selectively. CodeGraph is derived structural evidence; source, Git diff, compilers, tests, and runtime observations remain correctness authority.

Install the public CodeGraph CLI and initialize this repository once:

```sh
./scripts/setup-codegraph.sh
```

Check runtime, index, and OpenCode MCP health with:

```sh
./scripts/check-codegraph.sh
```

## Browser automation

There are intentionally two browser entry paths for practical comparison:

- `/browser` opens the dedicated workflow-owned `Browser` agent for direct browser workflows.
- Assistant delegates `category="browser-automation", load_skills=["ego-browser"]` through CategoryEngine to Implementer for browser work requested as part of ordinary assistance.

The dedicated `Browser` route is the workflow-facing browser agent. The `browser-automation` category is browser capability through the reusable Implementer, and `ego-browser` is the current external backend/skill identifier. Both paths use the external official `citrolabs/ego-lite` runtime.

Provision the current backend explicitly, then verify it:

```sh
./scripts/setup-ego-browser.sh
./scripts/check-ego-browser.sh
```

The backend remains external. This repository does not vendor its skill, application, Task Spaces, browser state, or credentials.

## Installation

The live OpenCode configuration is linked narrowly from this repository:

```sh
./scripts/install.sh --dry-run
./scripts/install.sh
```

The installer backs up pre-existing matching content before linking. During migration it removes the old `~/.omo/omo.jsonc` destination only when it is a symlink to this repository's former managed config. Any other file or symlink is preserved and reported.

Install the stock public JavaScript plugin dependency where OpenCode discovers it:

```sh
npm install --prefix ~/.config/opencode @opencode-ai/plugin@1.18.29
```

Final verification used OpenCode 1.18.30, `@opencode-ai/plugin` 1.18.29, CodeGraph 1.5.0, OpenSpec CLI, and Node.js 24.

## Verification

```sh
git diff --check
node --test opencode/tests/*.test.js
./scripts/verify.sh
npm ls --depth=1 --prefix ~/.config/opencode
npm audit --omit=dev --prefix ~/.config/opencode
opencode debug config
opencode agent list
opencode debug agent Assistant
opencode debug agent Browser
opencode debug agent Executor
```

The deterministic suite covers discovery, permissions, planning/execution gates, independent CodeGraph configuration, loader safety, shared cross-worktree control-plane ownership, workspace provenance, completion correctness, grouped single-resume behavior, cancellation, category-specific Git/browser policy, and conservative release.

Edit canonical files here, rerun verification, inspect the diff, and commit one coherent change. Never copy sessions, caches, credentials, indexes, runtime state, browser state, or external repositories into this repository.
