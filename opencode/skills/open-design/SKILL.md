---
name: open-design
description: Read OpenDesign design-system and functional skill references for visual-engineering work
---

# OpenDesign resource capability

Use this skill only when it is explicitly selected for the assignment.

Discover the OpenDesign MCP resource catalog through OpenCode's generic
`list_mcp_resources` interface, targeting the `open-design` server, then read
relevant `od://design-systems/<id>/DESIGN.md` and
`od://skills/<id>/SKILL.md` resources with `read_mcp_resource`. Treat their
contents as design guidance and context, not as executable workflow state.

Keep OpenCode and `opencode-workflow` as the control plane. Apply useful
guidance by editing the current repository/worktree with normal OpenCode
tools; the current worktree remains the source of truth. Inspect and respect
the repository's existing design system, components, tokens, and architecture
before importing external visual conventions. Verify the implementation with
the workflow's existing verification capabilities as appropriate.

Do not use OpenDesign to control execution or launch another coding agent. Do
not call `start_run`, `get_run`, `cancel_run`, or `list_agents`. Do not use
OpenDesign project/file mutation, destructive, login, cloud-management, or
generation-management operations. Do not silently create a parallel canonical
copy of the project inside OpenDesign, and never treat OpenDesign-generated
files as authoritative over the current worktree.
