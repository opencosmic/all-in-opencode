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
  -> optional previs and review -> production routing -> references/assets -> production state
  -> later HyperFrames composition -> QA and revision
```

Use the references in this skill for shotcraft, contracts, routing, assets,
and revision decisions. HyperFrames remains authoritative once composition
starts: it owns motion graphics, typography, captions, transitions, audio
assembly, and rendering. The Producer-only `blender-previs` category is the
lightweight spatial/camera/timing Implementer; the named `Blender` route remains
available for general-purpose or explicitly technical Blender work. The
`media-generation` category is the bounded provider-neutral Implementer route;
`video-analysis`/Watch supplies grounded visual QA.

## Previs before paid generation

When a ShotSpec has `control.previs: required` or `recommended`, Producer sends
the already-defined request to `delegate_task(category="blender-previs")`.
Before delegation, Producer prepares and verifies exactly the parent
directories required by the supplied previs artifact destinations inside the
active production workspace. `blender-previs` assumes those parents exist and
must fail clearly if one is missing; it does not create or invent directories.
That category implements only lightweight blocking, camera/framing, lens
intent, motion/timing, and basic lighting direction. Its practical handoff is
an editable `.blend` source, key stills, and a low-resolution preview MP4 for
moving shots; stills may be sufficient for a genuinely static shot.
Optimize ordinary previs for reviewability: prefer viewport/OpenGL/playblast,
then Workbench, then lightweight Eevee only when needed. Do not use Cycles, high
samples, expensive denoising, photoreal materials, high-resolution output, or
final-film rendering. Use 480×270 or lower by default (720p maximum for
ordinary previs) and about 8–12 fps for moving previews. Preserve each shot's
full duration; reduced preview fps changes the evidence frame count, not the
canonical ShotSpec duration or output fps. Stills establish framing and
composition; the MP4 establishes motion and timing.

For every shot requesting camera and/or subject motion, `blender-previs` must
verify the requested animation before generating its preview MP4. After
authoring, inspect Blender-native evaluated state at the shot's start frame,
middle frame `floor((frame_start + frame_end) / 2)`, and end frame for each
requested moving target. Check camera world transforms against the move's
intent (pan/tilt may change orientation while location stays fixed); check the
relevant proxy's evaluated transform or animation state for requested subject
motion. Verify both independently when both are requested. Do not reject a
locked/static camera or fully static shot for unchanged transforms when that
motion was not requested, and do not invent motion. Missing or inconsistent
requested motion blocks MP4 generation until the animation is corrected and
verified. Return concise transient start/middle/end evidence without changing
ShotSpec or manifest schemas. This proves motion was authored; Watch remains
required after rendering to decide whether it looks correct.

If a Blender MCP save/render/playblast call times out, treat completion as
ambiguous. The child reports the exact supplied paths and does not blindly
retry; Producer checks only those paths. A non-empty `.blend` is sufficient, a
still must also have a recognizable expected image format, and a non-empty MP4
is preliminary until Watch can decode it. Missing or unusable output requires
an explicit revision/recovery decision before another render.

Review the stills and preview MP4 through
`delegate_task(category="video-analysis", load_skills=["watch"])`. The `.blend`
is an editable source artifact, not the review target. Producer compares the
observed evidence with the ShotSpec and decides `PASS` or
`REVISION_REQUIRED`. A revision should reuse the existing `.blend` where
practical. Only after the previs evidence passes should Producer finalize
generation instructions and enter the `media-generation` calculate/approval
path. This review happens before any paid Atlas submission.

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

### Provider-neutral persistence boundary

Keep the canonical `ShotSpec` provider-neutral. Do not persist a selected
provider, curated model ID, Atlas role, or provider request controls such as
`reference_*_asset_ids` or `generate_audio` in `ShotSpec.extensions`. Producer
may derive a transient routing plan that maps shot intent to a curated model
immediately before execution. Once a generation job exists, provider/model
selection, request digest, approval/cost state, prediction state, outputs, and
provider status belong in the existing `ProductionManifest.generation_jobs`
runtime state. Exact provider request controls may remain transient when they
are bound by the canonical request digest; do not add them to ShotSpec merely
to persist them. Keep placeholder planning references as stable manifest IDs;
only materialized or uploaded asset IDs may enter provider request fields.

Use the curated generation controls described in
[production-routing](references/production-routing.md) only after model
selection. They refine the provider request without changing routing: preserve
explicit values, keep omitted values absent, and recalculate before approval
when a control changes.

Audio conditioning uses ordinary manifest assets and the same stable-ID flow:
record an MP3 or WAV asset, reference it in the generic `ShotSpec.references`
object when useful, and pass its ID as `reference_audio_asset_ids`. This input
conditions the selected video model and remains separate from `generate_audio`,
which controls native audio in the output. Those fields are transient execution
request fields, not canonical ShotSpec fields. Wan and H3 require visual references
when audio is supplied; Seedance also supports audio-only reference requests.

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
