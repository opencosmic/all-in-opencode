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
carry planning decisions without coupling the contract to a provider endpoint.
Use `control.previs: required` when camera, blocking, or spatial relationships
need Blender evidence before production routing.

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
```
