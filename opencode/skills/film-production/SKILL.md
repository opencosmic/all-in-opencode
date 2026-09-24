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
assembly, and rendering. Director owns creative intent and ShotSpec authorship;
Creator owns generation strategy; Editor will own post-production through the
official HyperFrames workflow after live migration. Producer owns orchestration,
state, budget, and user approval. The `blender-previs` category is the
lightweight spatial/camera/timing Implementer available to Director alone.
Named Blender is outside the video-production graph. Creator owns generated-
media strategy, execution coordination, and generated-output Watch review by
using the bounded `media-generation` and `video-analysis` Implementer routes.
Producer remains the sole lifecycle, checkpoint, and user approval owner.

## Previs before paid generation

Producer calls `production_preflight` for the canonical
`production/production-manifest.json`, then delegates Director PLAN with the
brief and current canonical state. Director authors complete provider-neutral
ShotSpecs, decides which shots need previs, and returns canonical
`production/previs/<shot-id>/...` destinations. Producer validates and persists
the ShotSpecs and legally advances `planning -> previs` when needed (or
`planning -> production` when none is needed). Producer calls
`production_prepare_artifacts` with the exact canonical file destinations;
the deterministic tool prepares only required parents, rejects symlinks and
traversal, and returns absolute runtime destinations. Producer gives those
paths and finalized ShotSpecs to Director PREVIS. Director alone delegates
`blender-previs` and interprets Watch evidence. `blender-previs` assumes the
parents exist and must fail clearly if one is missing; it never creates or
invents directories. Keep canonical paths workspace-relative in ShotSpecs and
the ProductionManifest. Only returned absolute runtime values reach Blender;
they remain transient and are never persisted as host-specific absolute paths.
Producer persists Director-approved ShotSpec revisions, writes
`production_checkpoint` at meaningful boundaries, and advances
`previs -> production` only after required previs passes.

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
ambiguous. The child reports the exact supplied paths to Director and does not
blindly retry; unresolved recovery returns to Producer. A non-empty `.blend`
is sufficient, a still must also have a recognizable expected image format,
and a non-empty MP4
is preliminary until Watch can decode it. Missing or unusable output requires
an explicit revision/recovery decision before another render.

Review the stills and preview MP4 through
`delegate_task(category="video-analysis", load_skills=["watch"])`. The `.blend`
is an editable source artifact, not the review target. Director compares the
observed evidence with the ShotSpec and decides `PASS`, `REVISION_REQUIRED`,
or `BLOCKED`. A revision should reuse the existing `.blend` where practical.
If it needs new paths, Director returns only canonical destinations to Producer
for preparation and re-delegation. A creative ShotSpec revision goes to Producer
for persistence. Only after the previs evidence passes does Producer enter
`production` and delegate generated-media work to Creator.

For each shot, preserve intent, continuity, references, output constraints,
and a reproducible request digest in the manifest. Atlas Cloud is currently
the only implemented media provider behind the bounded `media-generation`
category. Resolve stable manifest references and upload local files only
through `media_upload`. `media_calculate` does not create a task or charge.
Generation submission is asynchronous and never automatically retried or
rerolled. Producer persists approval for the exact calculated job, request
digest, and maximum USD exposure through `production_approve_generation` in the
canonical `ProductionManifest`. Submission requires that persisted state,
recomputes the request digest and current price, and rejects a changed request
or a price above the approved ceiling. Every external submission, including a
zero-cost quote, requires Producer approval. Completed Atlas outputs are
materialized into local production assets and linked from the same
`ProductionManifest`; Atlas URLs are temporary transport metadata only.

In M4, Creator owns model and reference selection, request construction,
execution coordination, and generated-output review. Creator first calls
`media_calculate` through `media-generation`, then returns the quote, estimate
flag, request digest, job ID, and unchanged request details to Producer.
Producer obtains explicit user approval and persists it with
`production_approve_generation`; Creator then relays the unchanged request and
same job ID to the execution child. The runtime reads the digest and ceiling
from that canonical approval and checks the current price before submission. A
changed request requires a new calculation and approval.
Creator then uses Watch and reports `PASS`, `REVISION_REQUIRED`, or `BLOCKED`.
Allow at most two revision rounds after the first result, with fresh Producer
approval for every revised request. On pass, Producer transitions
`production -> assets-ready` and checkpoints. On block, Producer checkpoints
the evidence and remaining work while lifecycle stays `production`. Stop at
`assets-ready` until M5; do not enter composition or QA in M4.

## Curated media model routing

Creator applies these intent defaults for the six supported Atlas models:

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
`reference_*_asset_ids` or `generate_audio` in `ShotSpec.extensions`. Creator
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
