---
description: Run the advanced AI filmmaking workflow through Producer
agent: Producer
subtask: false
---

Handle this as AIO's advanced AI filmmaking workflow. Load the repository-owned
`film-production` skill first. Producer owns canonical state, lifecycle,
checkpoints, user interaction, and approvals. Delegate creative planning and
previs to Director, generated-media strategy/execution to Creator, and
post-production through the official HyperFrames workflow to Editor.

The order is `film-production -> Director PLAN -> ShotSpec[] -> Producer
prepare -> Director PREVIS -> blender-previs -> Director Watch -> Creator
calculate -> Producer approval -> Creator media-generation / Watch -> Producer
assets-ready -> Editor HyperFrames composition / rough cut -> Producer
final-render approval -> Editor local final render / Watch QA -> Producer
completed checkpoint`. A blocked earlier phase cannot fall through to Editor.
The lightweight `/video` route also enters through Producer, then delegates
HyperFrames composition and rendering to Editor in its runtime-issued video
project scope. `/video` does not use this film manifest or lifecycle.

Film-production goal:

`$ARGUMENTS`
