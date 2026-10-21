---
description: Run a dedicated HyperFrames video-production task
agent: Producer
subtask: false
---

Handle this as AIO's lightweight HyperFrames video workflow. Producer owns the
user conversation and approvals; delegate composition and HyperFrames execution
to Editor. Do not enter OpenSpec or the repository's CategoryEngine/Implementer
workflow, modify Git history, or initialize `/film` production state.

Video-production goal:

`$ARGUMENTS`

Receive the user brief and clarify essential creative or delivery decisions.
Then delegate a named Editor task with `load_skills=["hyperframes"]`. Include
the full brief, supplied assets and their locations, review requirements, and
delivery constraints. The runtime creates and binds the lightweight project
scope; never invent or pass an external path as authorization. Editor must use
the official upstream `hyperframes` router, which selects the current supported
creation/editing workflow and its domain skills. Producer does not author the
composition or execute HyperFrames commands.

Editor returns a project-local preview and exact output plan. Producer presents
it for review and obtains explicit user approval before resuming Editor for a
local render. Handle blocked work and missing input assets with the user. Do
not enter Director, Creator, Blender PREVIS, Atlas generation, or the
`/film` ProductionManifest lifecycle. Preserve HyperFrames initialization and
skill-refresh permission gates. Never silently update globally installed
skills; direct setup/refresh needs to `scripts/setup-hyperframes.sh` and the
upstream confirmation flow.
