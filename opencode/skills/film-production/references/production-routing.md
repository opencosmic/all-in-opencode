# Production routing

Choose the owner by the problem the shot presents:

| Need | Route |
| --- | --- |
| motion graphics, UI, typography, captions, timing, transitions, or audio assembly | HyperFrames during the composition stage |
| generated image or footage execution | `media-generation` through the bounded Implementer runtime |
| lightweight camera, blocking, staging, lens, spatial relationships, motion, or rough preview for `/film` | `blender-previs` through the shared Implementer |
| standalone general-purpose Blender work outside video production | `/blender` or Executor's named `Blender` specialist |
| visual or spoken QA of a shot, rough cut, or final | `video-analysis` with the existing Watch skill |

`Producer` owns orchestration, the manifest, budget, and approvals. `Director`
owns creative intent and ShotSpecs, `Creator` owns generation strategy, and
`Editor` owns post-production. `blender-previs` is the single narrow category
for `/film` previs. Producer temporarily calls it directly until the Director
workflow migrates. Named Blender is not a video-production fallback. For
`/film`, film planning comes before HyperFrames; the official upstream
HyperFrames workflow belongs directly to Editor after M5. No composition
category or separate HyperFrames agent is part of this graph.

## Previs and review order

For a shot that needs previs, preserve this order:

```text
ShotSpec
  -> blender-previs
  -> .blend source + stills + preview MP4 when moving
  -> video-analysis / Watch
  -> Producer compares evidence with ShotSpec
  -> PASS or REVISION_REQUIRED
  -> media-generation calculate/approval
```

The `.blend` is editable implementation source, not review evidence or the
review target. For a revision, send the observed mismatch and the existing scene
path back to `blender-previs`; do not rebuild a scene or pay for Atlas media
before the evidence passes. Keep previews lightweight: viewport/Eevee-style
rendering and roughly 480p or 720p are appropriate when a video is needed.

## Curated media model defaults

Use GPT Image 2 for ordinary/value images, GPT Image 2.5 Sunburst for
premium/hero/key visuals, and Seedream 5 Pro for photoreal/reference images.
Use Wan 3.0 for ordinary/balanced video, MiniMax H3 for identity/quality
video, and Seedance 2.5 for complex/multi-reference video. An explicitly
supported user model choice wins. Omitted models default to GPT Image 2 for
images and Wan 3.0 for video; there is no automatic paid fallback.

## Curated generation controls

These controls refine an already selected model; they do not change routing.
Pass explicit values through unchanged, keep omitted optional fields absent, and
run `media_calculate` again whenever a control changes. For GPT Image 2, use
`quality` `low` for drafts, `medium` or omission for ordinary work, and `high`
for important finals. Sunburst keeps its wider quality range; use
`background: transparent` for compositing or cutouts and `auto`/`opaque` for
ordinary imagery. Transparent Sunburst output requires PNG in the curated AIO
subset.

For video, `generate_audio: false` is appropriate when downstream audio,
voiceover, sound effects, or composition owns the soundtrack; `true` or
omission requests native model audio. Use Wan `seed` only for reproducibility
or controlled comparisons, and leave it unset for ordinary variation. Use H3
`prompt_expansion: true` when a sparse prompt should be enriched, and false or
omission when the authored prompt should remain tight. For Seedance, keep the
default MP4 unless a downstream high-fidelity editing workflow benefits from
MOV. Do not invent dimensions, WebP output, provider-only passthrough fields,
or hardcoded prices, and do not auto-escalate a control.

Audio references are conditioning inputs, passed as stable manifest IDs through
`reference_audio_asset_ids`; they do not replace `generate_audio`. Wan and H3
can use audio with visual references, while H3 still requires an image or video
reference. Seedance can use audio with visual references or as an audio-only
reference, and prompts may address ordered audio inputs as `@Audio1`, `@Audio2`
when needed. These capabilities refine the selected model and do not change
the routing defaults; Seedance is a natural choice when audio-only or complex
audio/visual conditioning is required. In the conservative AIO subset, Wan
allows up to 5 audio references within 20 total references, while H3 allows up
to 3 audio references within its existing 9-total policy.
