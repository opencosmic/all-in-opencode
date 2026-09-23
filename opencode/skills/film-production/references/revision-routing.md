# Revision routing

Review at three useful boundaries: a critical generated shot, a rough cut, and
the final render. Ground findings in `video-analysis`/Watch observations and
record the affected shot and symptom in the manifest.

- camera, blocking, staging, lens, spatial, or timing-at-previs problems go to
  `blender-previs`;
- generation, identity, continuity, or visual-artifact problems go to the
  bounded Atlas-backed `media-generation` route;
- editing, captions, typography, transitions, audio, or final timing problems
  go to HyperFrames.

Do not automatically reroll paid media. Producer should present the finding,
the proposed route, and any new calculate/approval requirement for an explicit
decision. A reroll is a new paid request and must never be created
automatically.

For previs, Director reviews stills and the preview MP4 through
`video-analysis`/Watch, then compares that evidence with the expected ShotSpec.
The `.blend` remains an
editable source artifact and is not itself the review target. A
`REVISION_REQUIRED` request should preserve the current scene and ask
`blender-previs` to edit it where practical. Director returns any complete
provider-neutral ShotSpec revision to Producer for persistence. New artifact
destinations return to Producer for `production_prepare_artifacts`; Director
does not create directories. Previs review must pass before `media-generation`
or any paid Atlas submission.
