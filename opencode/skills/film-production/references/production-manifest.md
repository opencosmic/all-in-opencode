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
revision: 0
history: []
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
latest_checkpoint: null
```

Keep shot IDs unique. Assets and generation jobs should point back to shots;
request digests, job IDs, output references, revision, and history make a run
resumable and debuggable. Atlas-backed generation jobs record their model,
media type, input/output asset IDs, preflight estimate, approval ceiling,
provider prediction ID, status, and safe provider error details where present.
`actual_usd` remains null when Atlas does not report direct per-job billing.
Atlas temporary URLs belong only in upload/output metadata; stable AIO asset IDs
and local paths are the durable references.

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

For canonical persisted state, initialize with `createProductionManifest()`
and use `transitionProductionManifest()` for every lifecycle change. Never
mutate `project.status` directly: the table checks whether a transition is
legal, while the helper performs the change and keeps `revision` and `history`
coherent. After every persisted update, `validateProductionManifest()` must
pass. The validator enforces the persisted state directly: empty history means
`planning` at revision `0`; otherwise revision equals history length, the
history is a legal chain from `planning`, and its final status matches the
project status. The helper is the preferred way to derive transitions, but
helper invocation itself is not a separate validation requirement.

The canonical file is `production/production-manifest.json` in the active
project. Producer uses `production_preflight` to create or resume it and
`production_prepare_artifacts` to prepare exact artifact parents and transient
absolute runtime paths. One optional `latest_checkpoint` holds concise recovery
facts: `phase`, `current_focus`, `completed`, `remaining`, `verification`,
`important_artifacts`, and `updated_at`. The runtime derives phase and time;
checkpoint writes replace the previous value without changing `revision` or
`history`. Old manifests without this field normalize to `null`. A checkpoint
may be stale after a lifecycle transition; preflight reports that fact and does
not rewrite it.

For M5, Producer alone registers `outputs.rough_cut` and `outputs.final` through
`production_record_output`; each record includes the canonical production path,
SHA-256, and byte size. `assets-ready -> composition` requires ready local visual
assets mapped to every ShotSpec. `composition -> qa` requires an intact
registered final output. `qa -> completed` requires the current QA checkpoint
to contain `verification.watch_verdict: PASS`.

Before a final local HyperFrames render, Producer obtains explicit user approval
and calls `production_approve_final_render` with the canonical HyperFrames
project path and exact final output path. The runtime binds the approval to the
current registered rough-cut digest, project path, and final path. It is
consumed by final-output registration and cannot be supplied through a generic
checkpoint write. Editor cannot mutate this manifest or edit the approved
HyperFrames project before rendering.
