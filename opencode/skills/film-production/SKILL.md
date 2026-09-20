---
name: film-production
description: AIO methodology for advanced AI filmmaking, shot planning, production routing, and grounded revision
---

# AIO film production

Use this skill for `/film`, not for the lightweight `/video` route. Keep the
workflow provider-neutral and drive it with structured `ShotSpec` entries and
one `ProductionManifest`.

The lifecycle is:

```text
request -> creative intent -> shot decomposition -> ShotSpec[]
  -> production routing -> references/assets -> production state
  -> later HyperFrames composition -> QA and revision
```

Use the references in this skill for shotcraft, contracts, routing, assets,
and revision decisions. HyperFrames remains authoritative once composition
starts: it owns motion graphics, typography, captions, transitions, audio
assembly, and rendering. Blender is the spatial/camera/previs specialist;
`media-generation` is the bounded provider-neutral Implementer category; and
`video-analysis`/Watch supplies grounded visual QA.

For each shot, preserve intent, continuity, references, output constraints,
and a reproducible request digest in the manifest. Separate planning and
previs from any later generation approval. The current media runtime is a
deterministic mock only: this phase has no paid generation, provider calls,
billing, or automatic rerolls. Atlas Cloud integration is deferred to a later
phase.

Treat the repository film-production contract as authoritative. The manifest's
`shots` field is the complete canonical `ShotSpec[]`, not a parallel set of
routing records. Author the canonical shape, validate the persisted
ShotSpecs/ProductionManifest, then use it and advance stages only through the
permitted lifecycle transitions; do not invent or skip transitions.

For canonical persisted `ProductionManifest` state, initialize through
`createProductionManifest()` and never mutate `project.status` directly. Use
`transitionProductionManifest()` to perform each lifecycle change so the
permitted transition, `revision`, and `history` remain coherent. The transition
table answers whether a move is legal; the helper performs the canonical state
change.

Read only the references needed for the current stage:

- [cinematic-shotcraft](references/cinematic-shotcraft.md)
- [shot-spec](references/shot-spec.md)
- [production-routing](references/production-routing.md)
- [production-manifest](references/production-manifest.md)
- [reference-assets](references/reference-assets.md)
- [revision-routing](references/revision-routing.md)
