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
and a reproducible request digest in the manifest. Atlas Cloud is currently the only implemented media provider behind the bounded `media-generation`
category. Resolve stable manifest references, upload local files only through
`media_upload`, call `media_calculate`, present its price and `estimated` flag
for explicit approval, then submit the unchanged request through
`media_generate_image` or `media_generate_video`. Use `media_prediction` for a
single check or `media_wait_prediction` for bounded polling. `media_calculate`
does not create a task or charge; generation submission is asynchronous, paid,
and never automatically retried or rerolled. The runtime enforces request
digest and cost integrity, while human approval remains an orchestration
invariant rather than a cryptographic proof unless OpenCode provides one.
Completed Atlas outputs are materialized into local production assets and
linked from the same `ProductionManifest`; Atlas URLs are temporary transport
metadata only.

## Curated media model routing

Producer applies these intent defaults for the six supported Atlas models:

| Media intent | Model |
| --- | --- |
| image: ordinary or value | GPT Image 2 |
| image: premium, hero, or key visual | GPT Image 2.5 Sunburst |
| image: photoreal or reference-led | Seedream 5 Pro |
| video: ordinary or balanced | Wan 3.0 |
| video: identity or quality-led | MiniMax H3 |
| video: complex or multi-reference | Seedance 2.5 |

An explicitly supported user model choice wins. If the model is omitted, image
generation defaults to GPT Image 2 and video generation defaults to Wan 3.0.
There is no automatic paid fallback; a failed or ambiguous generation remains
an explicit user decision.

Treat the repository film-production contract as authoritative. The manifest's
`shots` field is the complete canonical `ShotSpec[]`, not a parallel set of
routing records. Author the canonical shape, validate the persisted
ShotSpecs/ProductionManifest, then use it and advance stages only through the
permitted lifecycle transitions; do not invent or skip transitions.

For canonical persisted `ProductionManifest` state, initialize through
`createProductionManifest()` and never mutate `project.status` directly. Use
`transitionProductionManifest()` to derive each lifecycle change so the
permitted transition, `revision`, and `history` remain coherent, then validate
the persisted manifest with `validateProductionManifest()`. The persisted
state is authoritative: a manually assembled manifest is acceptable only when
it satisfies the same lifecycle invariants; proving that the helper was called
is not a separate requirement. The transition table answers whether a move is
legal, while the helper performs the canonical state change.

Read only the references needed for the current stage:

- [cinematic-shotcraft](references/cinematic-shotcraft.md)
- [shot-spec](references/shot-spec.md)
- [production-routing](references/production-routing.md)
- [production-manifest](references/production-manifest.md)
- [reference-assets](references/reference-assets.md)
- [revision-routing](references/revision-routing.md)
