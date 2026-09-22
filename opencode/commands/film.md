---
description: Run the advanced AI filmmaking workflow through Producer
agent: Producer
subtask: false
---

Handle this as AIO's advanced AI filmmaking workflow, distinct from the
lightweight `/video` route. Load and follow the repository-owned
`film-production` skill first. Plan shots and production state before entering
HyperFrames composition; use `blender-previs` for lightweight shot previs,
`video-analysis` for review, and `media-generation` only after previs approval.
The named Blender route remains available for general-purpose Blender work
outside `/film` previs.

The ordering is `film-production -> ShotSpec[] -> blender-previs ->
video-analysis review -> media-generation -> HyperFrames composition`.

Film-production goal:

`$ARGUMENTS`
