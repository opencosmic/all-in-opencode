# ProductionManifest

Keep one project-local manifest as the resumable production state. The
validated AIO contract is in `opencode/plugins/film-production/contracts.js`.
It is intentionally one contract, not separate shot, asset, cost, or job
manifests.

```yaml
schema_version: 1
project:
  id: example-film
  status: planning
shots: []
assets: []
generation_jobs: []
costs:
  estimated_usd: null
  approved_usd: null
  actual_usd: null
outputs:
  rough_cut: null
  final: null
```

Keep shot IDs unique. Assets and generation jobs should point back to shots;
request digests, job IDs, output references, revision, and optional history
make a run resumable and debuggable. Cost fields are reserved for a later
calculate/approval/submit flow and must remain null until a real approved
runtime exists. The current mock reports zero estimated cost and never submits
paid work.

`ProductionManifest.shots` MUST contain the complete canonical `ShotSpec[]`.
`validateProductionManifest()` validates those entries as ShotSpecs; do not
replace them with routing-only summaries or status records. A ShotSpec's
`references`, when present, uses the role-grouped object-of-arrays shape
described in [shot-spec](shot-spec.md).

For example, a manifest shot remains a full ShotSpec rather than only a route:

```yaml
shots:
  - shot_id: shot_01
    purpose: Establish the product silhouette
    duration_seconds: 3.5
    subject:
      id: speaker
      action: stationary reveal
    camera:
      movement: slow dolly
      lens_mm: 65
      framing_start: silhouette
      framing_end: medium product
    environment:
      id: dark_studio
    references:
      subject:
        - speaker_front
      environment:
        - dark_studio
    output:
      aspect_ratio: "16:9"
      fps: 24
```

The lifecycle is `planning -> previs -> production -> assets-ready ->
composition -> qa -> completed`, with explicit failure and revision returns.
The canonical transition table is authoritative: do not invent or skip a
transition such as `previs -> assets-ready`. Before treating ShotSpecs or a
ProductionManifest as persisted canonical state, validate the persisted
representation against the contract, then persist/use it and advance the
stage only through a permitted transition.
