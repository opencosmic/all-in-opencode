---
description: Run a dedicated HyperFrames video-production task
agent: Producer
subtask: false
---

Handle this as a standalone HyperFrames video-production goal. Do not enter
OpenSpec or the repository's CategoryEngine/Implementer workflow, and do not
modify Git history or workflow control-plane state.

Video-production goal:

`$ARGUMENTS`

At the start of the request, load and follow the official upstream
`hyperframes` skill. Let it route to the current supported creation or editing
workflow and load only the HyperFrames skill family that it requires. Use the
upstream validation, preview, user-review, and render-approval gates. Do not
silently update globally installed skills; direct the user to
`scripts/setup-hyperframes.sh` for initial/core setup or refreshes of
already-installed workflows. If the selected workflow is not installed, follow
the upstream confirmation for `npx hyperframes skills update <workflow-name>`.
