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

For a new video, omit `resume_video_task_id`. To continue an existing video,
select the exact terminal Editor `task_id` from this Producer session and pass
it as `resume_video_task_id`. If the user's selected project is ambiguous or
its task ID cannot be found, ask which project to continue; never substitute
the most recent project. The runtime validates the task owner, workspace, and
existing project tree before restoring its scope. This explicit task identity
also supports delayed approval after the original command context expires.

Editor returns a project-local preview and exact output plan. Producer presents
it for review and obtains explicit user approval before resuming Editor for a
local render. Handle blocked work and missing input assets with the user. Do
not enter Director, Creator, Blender PREVIS, Atlas generation, or the
`/film` ProductionManifest lifecycle. Preserve HyperFrames initialization and
skill-refresh permission gates. Never silently update globally installed
skills. Use the verified installed setup-script location supplied in the runtime
context for recovery; never assume it exists relative to the production workspace.
If unavailable, ask the user for their AIO installation location. Keep the upstream
confirmation flow and obtain explicit approval for shared/global changes.
