# ShotSpec

`ShotSpec` is a provider-neutral description of one shot. The validated AIO
contract lives in `opencode/plugins/film-production/contracts.js`; this
reference describes its production meaning rather than duplicating its code.

Required fields are:

```yaml
shot_id: shot_03
purpose: hero_reveal
duration_seconds: 6
subject:
  id: hornet
  action: fly_forward
camera:
  movement: orbit
  lens_mm: 50
  framing_start: medium_wide
  framing_end: close
environment:
  id: sci_fi_hangar
output:
  aspect_ratio: "16:9"
  fps: 24
```

Optional `references`, `control.previs`, `generation.intent`, and `extensions`
carry provider-neutral planning decisions without coupling the contract to a
provider endpoint. Do not use `ShotSpec.extensions` to persist provider/model
IDs, Atlas roles, or provider request controls such as
`reference_*_asset_ids` and `generate_audio`. Producer may keep a transient
routing plan while choosing a curated model; after a generation job exists,
execution metadata belongs in the existing `ProductionManifest.generation_jobs`
records. Use `control.previs: required` when camera, blocking, or spatial
relationships need Blender evidence before production routing.

Planning references such as `fox_identity` or `misty_forest_dawn` are stable
manifest IDs, not provider asset IDs. Only materialized or uploaded assets may
be passed through provider-specific request fields.

When present, `references` MUST be an object whose values are arrays of stable
reference IDs grouped by role. Do not use a flat list.

```yaml
references:
  subject:
    - speaker_front
    - speaker_three_quarter
  environment:
    - dark_studio
  palette:
    - premium_cyan
  audio:
    - voice_reference
```
