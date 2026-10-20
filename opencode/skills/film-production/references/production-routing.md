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
for `/film` previs and only Director calls it. Producer prepares canonical
artifact paths and gives Director the absolute runtime mapping. Named Blender
is not a video-production fallback. For
`/film`, film planning comes before HyperFrames; the official upstream
HyperFrames workflow belongs directly to Editor after M5. No composition
category or separate HyperFrames agent is part of this graph.

## Previs and review order

For a shot that needs previs, preserve this order:

```text
Director PLAN -> ShotSpec + canonical previs paths
  -> Producer persists ShotSpec and prepares absolute destinations
  -> Director PREVIS -> blender-previs
  -> .blend source + stills + preview MP4 when moving
  -> Director -> video-analysis / Watch
  -> Director compares evidence with ShotSpec
  -> PASS or REVISION_REQUIRED
  -> Producer lifecycle/checkpoint -> Creator strategy and request calculation
  -> Producer persisted job approval -> Creator media-generation execution
  -> Creator video-analysis / Watch -> PASS or BLOCKED
  -> Producer lifecycle/checkpoint at assets-ready (M4 stop)
```

The `.blend` is editable implementation source, not review evidence or the
review target. For a revision, send the observed mismatch and the existing scene
path back to `blender-previs`; do not rebuild a scene or pay for Atlas media
before the evidence passes. Keep previews lightweight: viewport/Eevee-style
rendering and roughly 480p or 720p are appropriate when a video is needed.

## Curated media model defaults

Creator chooses GPT Image 2 for ordinary/value images, GPT Image 2.5 Sunburst for
premium/hero/key visuals, and Seedream 5 Pro for photoreal/reference images.
Use Wan 3.0 for ordinary/balanced video, MiniMax H3 for identity/quality
video, and Seedance 2.5 for complex/multi-reference video. An explicitly
supported user model choice wins. Omitted models default to GPT Image 2 for
images and Wan 3.0 for video; there is no automatic paid fallback.

### Exact curated identifiers and inputs

Read this table before constructing a request. Copy the entire canonical ID
into `model`; display names are not identifiers. `wan-3.0` is rejected. The
runtime registry in `atlas-media-models.js` is authoritative; this table is
guidance for its existing contract, not a separate runtime registry.

| Model | Exact canonical `model` | Modality and references | Supported optional controls and restrictions |
| --- | --- | --- | --- |
| GPT Image 2 | `openai/gpt-image-2/text-to-image` | Image; text only, no reference inputs | `size` from the GPT size presets below; `output_format`: `jpeg` or `png`; `quality`: `low`, `medium`, `high`. No `background`, `thinking`, or `prompt_optimization_mode`. |
| GPT Image 2.5 Sunburst | `openai/gpt-image-2.5-sunburst/text-to-image` | Image; text only, no reference inputs | Same GPT size presets and image formats; `quality`: `auto`, `low`, `medium`, `high`, `xhigh`, `max`; `background`: `auto`, `opaque`, `transparent`. Use PNG for transparency. Prompt limit 32,000 characters. No `thinking` or `prompt_optimization_mode`. |
| Seedream 5 Pro | `bytedance/seedream-v5.0-pro/text-to-image` | Image; text only in this curated subset | `size` from the Seedream presets below; `output_format`: `jpeg` or `png`; `thinking`: `enabled` or `disabled`; `prompt_optimization_mode`: `standard` or `fast`. No `quality` or `background`. |
| Wan 3.0 | `alibaba/wan-3.0/reference-to-video` | Video; visual references optional. Audio requires at least one image or video reference. Up to 20 image, 20 video, 5 audio references, with 20 total maximum. | `duration_seconds`: `-1` or integer 2–30; `resolution`: `480p`, `720p`, `1080p`, `720p-esr`, `1080p-esr`, `1440p-esr`, `4k-esr`; `ratio`: `adaptive`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`; `generate_audio`: boolean; `seed`: integer. Prompt limit 20,000 characters. **No `prompt_expansion` (even `false`) or `video_output_format`.** |
| MiniMax H3 | `minimax/h3/reference-to-video` | Video; at least one image or video reference required. Up to 9 images, 3 videos, 3 audio references, with 9 total maximum. Audio alone is rejected. | Required `duration_seconds`: integer 4–15 and required `resolution`: `768p` or `2k` (AIO maps provider casing). Optional `ratio`: `adaptive`, `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`; `prompt_expansion`: boolean. **No `generate_audio`, `seed`, or `video_output_format`.** |
| Seedance 2.5 | `bytedance/seedance-2.5/reference-to-video` | Video; at least one image, video, or audio reference required. Audio-only is supported. Up to 30 images, 10 videos, 10 audio references. | `duration_seconds`: `-1` or integer 4–30; `resolution` from the Seedance list below; `ratio`: `adaptive`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`; `generate_audio`: boolean; `video_output_format`: `mp4` or `mov`. **No `seed` or `prompt_expansion`.** |

GPT size presets (AIO `*` spelling): `1024*1024`, `1024*768`, `768*1024`,
`1024*1536`, `1536*1024`, `2048*2048`, `2048*1152`, `1152*2048`,
`2560*1088`, `1088*2560`.

Seedream size presets: `2048*2048`, `2304*1728`, `1728*2304`, `2720*1530`,
`1530*2720`, `2496*1664`, `1664*2496`, `1024*1024`, `1536*1536`,
`1776*1328`, `1328*1776`, `2048*1152`, `1152*2048`.

Seedance resolutions: `480p`, `720p`, `720p-sr`, `720p-esr`, `1080p`,
`1080p-sr`, `1080p-esr`, `1080p-esr & 60fps`, `1440p-sr`, `1440p-esr`,
`4k-esr`.

Reference fields use authorized, uploaded manifest asset IDs:
`reference_image_asset_ids`, `reference_video_asset_ids`, and
`reference_audio_asset_ids`. Do not pass provider URLs or raw `refers` /
`reference_images` / `reference_videos` / `reference_audios` payloads. Wan
visual references accept JPEG, PNG, BMP, WebP, MP4, and MOV. H3 accepts JPEG,
PNG, WebP images and MP4/MOV videos. Seedance accepts JPEG, PNG, WebP, BMP,
TIFF, GIF, HEIC/HEIF images and MP4/MOV videos. Audio references use MP3 or WAV;
Seedance rejects audio above 15 MiB when size metadata is available. Preserve
reference ordering and model-specific limits.

Minimal ordinary video request (plus canonical `manifest_path` and `shot_id`):

```json
{
  "media_type": "video",
  "model": "alibaba/wan-3.0/reference-to-video",
  "prompt": "A red fox with a blue scarf crosses a misty dawn clearing.",
  "duration_seconds": 5,
  "resolution": "480p",
  "ratio": "16:9"
}
```

Only include model-specific optional fields when they are explicitly supported
by the selected model and actually needed by the request. Omission and `false`
are not interchangeable under strict validation. For Wan, omit
`prompt_expansion` entirely; never include `prompt_expansion=false` merely to
express a default. Unsupported identifiers or fields stop calculation; return
the exact error to Producer instead of adding aliases or trying a fallback.

Refreshing an unchanged job's quote within its persisted approved ceiling keeps
that approval and its original approved price; a refresh never raises the
ceiling. A changed digest or a quote above the ceiling requires fresh Producer
approval. Submission takes an exclusive filesystem claim for that canonical
job and persists `submitted` before provider dispatch. Once reserved, the claim
is retained even on failure or process exit: an uncertain request must be
reconciled explicitly, never retried or reopened automatically.

## Curated generation controls

These controls refine an already selected model; they do not change routing.
Pass explicit values through unchanged, keep omitted optional fields absent, and
run `media_calculate` again whenever a control changes. For GPT Image 2, use
`quality` `low` for drafts, `medium` or omission for ordinary work, and `high`
for important finals. Sunburst keeps its wider quality range; use
`background: transparent` for compositing or cutouts and `auto`/`opaque` for
ordinary imagery. Transparent Sunburst output requires PNG in the curated AIO
subset.

For Wan and Seedance video, `generate_audio: false` is appropriate when downstream audio,
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
