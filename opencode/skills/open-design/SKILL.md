---
name: open-design
description: Read bounded, task-relevant OpenDesign design-system and functional skill references for visual-engineering work
---

# OpenDesign resource capability

Use this skill only when it is explicitly selected for the assignment. OpenDesign
is a read-only design-knowledge provider; OpenCode and `opencode-workflow` remain
the orchestrator and the current repository/worktree remains the source of truth.

## Repository-first selection

Before calling an OpenDesign resource tool, inspect the current task and enough of
the repository to understand the existing product. Derive a compact task profile;
do not force an exhaustive taxonomy. Capture the factors that matter, such as:

- surface type (for example dashboard, landing page, settings/admin, mobile UI,
  data visualization, form/workflow, marketing surface, or other)
- audience and task intent
- information density and interaction density
- existing visual language, design system, components, and tokens
- hard constraints and behavior that must remain unchanged

Use this precedence rule when applying guidance:

1. user requirements
2. existing product behavior
3. existing repository design system, components, and tokens
4. selected OpenDesign functional skill
5. selected OpenDesign design system

For normal visual refinement, OpenDesign is guidance, not authority. It must not
automatically replace the existing brand, behavior, tokens, component contracts,
or architecture unless the user explicitly requests a redesign that permits it.

## One bounded selection pass

Treat resource selection as one deliberate pass:

1. Discover the OpenDesign catalog through OpenCode's generic
   `list_mcp_resources` interface, targeting the `open-design` server, once per
   selection pass. In practice, call `list_mcp_resources(server="open-design")`
   once and use the returned metadata only at this stage: name, description or
   summary, and URI. Do not repeatedly list the full catalog while evaluating
   ordinary uncertainty. A second listing is justified only by a real catalog or
   context failure.
2. Build a metadata-only shortlist before reading any resource body. Keep at most
   3 functional skill candidates from `od://skills/<id>/SKILL.md` and at most 3
   design-system candidates from `od://design-systems/<id>/DESIGN.md`. These are
   upper bounds, not targets; shortlist fewer or none when metadata is not a
   clear match.
3. Read bounded candidate bodies with the generic
   `read_mcp_resource` interface. Across this selection pass, read at most 2
   candidate `SKILL.md` resources and at most 2 candidate `DESIGN.md` resources.
   Read fewer when metadata is already decisive. Do not read dozens of resources
   before implementation. A resource is eligible for final selection or
   application only after its actual body has been read: a functional skill
   requires reading its `SKILL.md`, and a design system requires reading its
   `DESIGN.md`. Metadata alone may shortlist, exclude, or prioritize candidates;
   it is never enough to report a resource as selected, apply its guidance, or
   claim it was consulted. If a candidate is not read, leave it unselected.
4. Apply a qualitative relevance gate. Select a candidate only when its metadata
   or content clearly matches at least one material task dimension: surface,
   audience, workflow, design intent, interaction model, information density, or
   visual-system need. Do not select a resource merely because it is interesting,
   sophisticated-sounding, popular, generally design-related, or visually novel.

Keep the two resource types distinct:

- A functional skill answers: “What capability, workflow, or design technique is
  useful for this task?” Examples include frontend taste, dashboard guidance,
  accessibility, responsive design, data visualization, or an artifact workflow.
- A design system answers: “What visual language/system fits this product,
  audience, and design intent?” Do not choose one merely because its name sounds
  attractive, and do not treat it as interchangeable with a functional skill.

After evaluating the candidates, select at most one primary functional skill and
at most one primary design system. Selecting neither is valid when no resource
clearly improves the task; do not force a weak match. Before implementation,
state a compact rationale in this form:

```text
Selected functional skill:
<resource or none> — one short reason

Selected design system:
<resource or none> — one short reason
```

Once primary resources are selected, stop catalog exploration and implement using
the selected guidance with the actual repository context. Allow at most one
replacement selection round if a selected resource proves unusable, directly
contradictory, or materially mismatched after reading. A replacement uses the
existing shortlist and remaining read budget; it must not become an unlimited
exploration loop.

## Apply guidance without changing the control plane

Adapt useful principles to the existing product. Do not copy an entire foreign
design system into the repository, rewrite component architecture solely to match
`DESIGN.md`, change product behavior because a resource recommends another
workflow, or replace brand identity without user intent.

Use only generic OpenCode MCP resource operations for this capability:
`list_mcp_resources` and `read_mcp_resource`, targeting the `open-design` server.
Do not call `start_run`, `get_run`, `cancel_run`, or `list_agents`; do not launch
another coding agent, use OpenDesign orchestration, mutate OpenDesign projects or
files, or treat OpenDesign-generated files as authoritative over the current
worktree. Verify the implementation with the repository's existing capabilities
as appropriate.
