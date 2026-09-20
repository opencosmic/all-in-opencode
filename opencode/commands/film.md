---
description: Run the advanced AI filmmaking workflow through Producer
agent: Producer
subtask: false
---

Handle this as AIO's advanced AI filmmaking workflow, distinct from the
lightweight `/video` route. Load and follow the repository-owned
`film-production` skill first. Plan shots and production state before entering
HyperFrames composition; use only the existing Blender, media-generation, and
video-analysis routes authorized by Producer.

The ordering is `film-production -> ShotSpec[] -> production routing ->
HyperFrames composition`.

Film-production goal:

`$ARGUMENTS`
