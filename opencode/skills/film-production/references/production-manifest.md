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

The lifecycle is `planning -> previs -> production -> assets-ready ->
composition -> qa -> completed`, with explicit failure and revision returns.
Use the transition helper rather than silently changing the project status.
