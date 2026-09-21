# Reference assets

References are continuity inputs, not provider-specific payloads. Give each
reference a stable human-readable ID and record what it controls: subject
identity, costume/material, environment, prop, palette, lens/framing, or
motion. A `ShotSpec` may list those IDs by role; the `ProductionManifest`
tracks the corresponding asset and its readiness.

Keep source paths or URIs, ownership/usage notes, and the shots that depend on
an asset in the manifest. For Atlas generation, pass the stable asset ID to
`media_upload`; the runtime resolves the local path, rejects traversal and
symlink escapes, and stores the temporary provider URL only as execution
metadata. Do not copy secrets into the manifest. If a required reference is
missing or not uploaded, keep the asset pending and route the blocking decision
to Producer instead of inventing a substitute silently.
