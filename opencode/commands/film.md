---
description: Run the advanced AI filmmaking workflow through Producer
agent: Producer
subtask: false
---

Handle this as AIO's advanced AI filmmaking workflow, distinct from the
lightweight `/video` route. Load and follow the repository-owned
`film-production` skill first. Delegate Director to author ShotSpecs and own
`blender-previs` and `video-analysis` for lightweight previs. Producer prepares
previs artifact destinations and owns production state and paid approval.
After previs passes, Creator owns generated-media strategy, bounded
`media-generation` execution, and Watch review. In M4, stop after Producer
advances passing generated assets to `assets-ready`; do not enter HyperFrames
composition or final QA before the M5 Editor migration.
The named Blender route remains available for general-purpose Blender work
outside `/film` previs.

The ordering is `film-production -> Director PLAN -> ShotSpec[] -> Producer
prepare -> Director PREVIS -> blender-previs -> Director Watch review ->
Creator calculate -> Producer approval -> Creator media-generation -> Creator
Watch review -> Producer assets-ready checkpoint (M4 stop)`.

Film-production goal:

`$ARGUMENTS`
