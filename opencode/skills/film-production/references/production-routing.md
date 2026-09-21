# Production routing

Choose the owner by the problem the shot presents:

| Need | Route |
| --- | --- |
| motion graphics, UI, typography, captions, timing, transitions, or audio assembly | HyperFrames during the composition stage |
| generated image or footage execution | `media-generation` through the bounded Implementer runtime |
| camera, blocking, staging, lens, spatial relationships, motion, or rough preview | existing `Blender` specialist |
| exact technical 3D render explicitly required | existing `Blender` specialist, with the final-render requirement stated |
| visual or spoken QA of a shot, rough cut, or final | `video-analysis` with the existing Watch skill |

`Producer` owns orchestration and the manifest. Do not create another director,
media agent, Blender-previs category, or `video-production` category. For
`/film`, film planning comes before HyperFrames; HyperFrames is the later
composition/render owner, not a duplicate planning control plane.

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
