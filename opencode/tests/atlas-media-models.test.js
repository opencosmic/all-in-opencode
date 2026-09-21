import test from "node:test"
import assert from "node:assert/strict"

import {
  ATLAS_GPT_IMAGE_MODEL,
  ATLAS_IMAGE_MODEL,
  ATLAS_VIDEO_MODEL,
  ATLAS_WAN_MODEL,
  buildAtlasMediaRequest,
  resolveAtlasMediaModel,
} from "../plugins/delegation/atlas-media-models.js"

const referenceResolver = (references) => async (assetID) => references[assetID]

test("Seedream 5 Pro keeps the canonical image request", async () => {
  const request = await buildAtlasMediaRequest("image", {
    prompt: "A premium speaker in a dark studio",
    size: "2048*1152",
    output_format: "png",
    thinking: "enabled",
    prompt_optimization_mode: "standard",
  })

  assert.deepEqual(request, {
    body: {
      model: ATLAS_IMAGE_MODEL,
      prompt: "A premium speaker in a dark studio",
      size: "2048*1152",
      output_format: "png",
      thinking: "enabled",
      prompt_optimization_mode: "standard",
    },
    inputAssetIds: [],
  })
})

test("GPT Image 2 uses the exact Atlas model ID in its minimal request", async () => {
  const request = await buildAtlasMediaRequest("image", {
    model: ATLAS_GPT_IMAGE_MODEL,
    prompt: "A glass sculpture on a black plinth",
  })

  assert.equal(ATLAS_GPT_IMAGE_MODEL, "openai/gpt-image-2/text-to-image")
  assert.deepEqual(request, {
    body: {
      model: "openai/gpt-image-2/text-to-image",
      prompt: "A glass sculpture on a black plinth",
    },
    inputAssetIds: [],
  })
})

test("GPT Image 2 maps the supported AIO image size and output format", async () => {
  const request = await buildAtlasMediaRequest("image", {
    model: ATLAS_GPT_IMAGE_MODEL,
    prompt: "A cinematic product still",
    size: "2048*1152",
    output_format: "png",
  })

  assert.deepEqual(request, {
    body: {
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "A cinematic product still",
      size: "2048x1152",
      output_format: "png",
    },
    inputAssetIds: [],
  })
})

test("GPT Image 2 rejects unsupported sizes, quality controls, and Seedream-only fields", async () => {
  await assert.rejects(
    buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "A scene",
      size: "2720*1530",
    }),
    /size must map to a documented GPT Image 2 size/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "A scene",
      quality: "high",
    }),
    /quality is not supported by the AIO media-generation contract/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "A scene",
      thinking: "enabled",
    }),
    /thinking is not supported for GPT Image 2/,
  )
})

test("GPT Image 2 rejects video references and unexposed provider fields instead of dropping them", async () => {
  await assert.rejects(
    buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "A scene",
      reference_image_asset_ids: ["reference"],
    }),
    /reference_image_asset_ids is not supported for image generation/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "A scene",
      negative_prompt: "blurry",
    }),
    /negative_prompt is not supported by the AIO media-generation contract/,
  )
})

test("Seedance 2.0 Fast keeps the canonical reference-to-video request", async () => {
  const request = await buildAtlasMediaRequest("video", {
    prompt: "The speaker rotates slowly",
    reference_image_asset_ids: ["speaker_front"],
    reference_video_asset_ids: ["previs"],
    duration_seconds: 5,
    resolution: "720p-SR",
    ratio: "16:9",
  }, referenceResolver({
    speaker_front: { url: "https://atlas.example/speaker.png", type: "image" },
    previs: { url: "https://atlas.example/previs.mp4", type: "video" },
  }))

  assert.deepEqual(request, {
    body: {
      model: ATLAS_VIDEO_MODEL,
      prompt: "The speaker rotates slowly",
      reference_images: ["https://atlas.example/speaker.png"],
      reference_videos: ["https://atlas.example/previs.mp4"],
      duration: 5,
      resolution: "720p-SR",
      ratio: "16:9",
    },
    inputAssetIds: ["speaker_front", "previs"],
  })
})

test("Wan 3.0 reference-to-video emits the documented minimal request", async () => {
  const request = await buildAtlasMediaRequest("video", {
    model: ATLAS_WAN_MODEL,
    prompt: "A cinematic turn toward camera",
  })

  assert.deepEqual(request, {
    body: {
      model: "alibaba/wan-3.0/reference-to-video",
      prompt: "A cinematic turn toward camera",
    },
    inputAssetIds: [],
  })
})

test("Wan 3.0 maps AIO image and video assets to typed refers entries", async () => {
  const request = await buildAtlasMediaRequest("video", {
    model: ATLAS_WAN_MODEL,
    prompt: "Keep the subject identity while walking through the set",
    reference_image_asset_ids: ["subject_front", "subject_side"],
    reference_video_asset_ids: ["movement_reference"],
    duration_seconds: -1,
    resolution: "1080p-esr",
    ratio: "adaptive",
  }, referenceResolver({
    subject_front: { url: "https://atlas.example/front.png", type: "image", mime_type: "image/png" },
    subject_side: { url: "https://atlas.example/side.webp", type: "image", mime_type: "image/webp" },
    movement_reference: { url: "https://atlas.example/movement.mov", type: "video", mime_type: "video/quicktime" },
  }))

  assert.deepEqual(request, {
    body: {
      model: ATLAS_WAN_MODEL,
      prompt: "Keep the subject identity while walking through the set",
      refers: [
        { url: "https://atlas.example/front.png", type: "image" },
        { url: "https://atlas.example/side.webp", type: "image" },
        { url: "https://atlas.example/movement.mov", type: "video" },
      ],
      resolution: "1080p-esr",
      duration: -1,
      ratio: "adaptive",
    },
    inputAssetIds: ["subject_front", "subject_side", "movement_reference"],
  })
})

test("unsupported or mismatched Atlas models are rejected before request construction", async () => {
  assert.throws(() => resolveAtlasMediaModel("video", "alibaba/wan-3.0/text-to-video"), /unsupported Atlas media model/)
  await assert.rejects(
    buildAtlasMediaRequest("image", { model: ATLAS_WAN_MODEL, prompt: "wrong modality" }),
    /is not supported for image generation/,
  )
})

test("Wan duration validation happens before reference resolution or network work", async () => {
  let resolutions = 0
  const resolveReference = async () => {
    resolutions += 1
    return { url: "https://atlas.example/ref.png", type: "image", mime_type: "image/png" }
  }

  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_WAN_MODEL,
      prompt: "A scene",
      reference_image_asset_ids: ["subject"],
      duration_seconds: 31,
    }, resolveReference),
    /duration_seconds must be -1 or an integer from 2 through 30/,
  )
  assert.equal(resolutions, 0)
})

test("Wan resolution validation happens before reference resolution or network work", async () => {
  let resolutions = 0
  const resolveReference = async () => {
    resolutions += 1
    return { url: "https://atlas.example/ref.png", type: "image", mime_type: "image/png" }
  }

  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_WAN_MODEL,
      prompt: "A scene",
      reference_image_asset_ids: ["subject"],
      resolution: "720p-SR",
    }, resolveReference),
    /resolution must be one of:/,
  )
  assert.equal(resolutions, 0)
})

test("Wan validates reference counts, duplicates, and media kinds", async () => {
  const elevenImages = Array.from({ length: 11 }, (_, index) => `image_${index}`)
  const tenVideos = Array.from({ length: 10 }, (_, index) => `video_${index}`)
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_WAN_MODEL,
      prompt: "Too many references",
      reference_image_asset_ids: elevenImages,
      reference_video_asset_ids: tenVideos,
    }, referenceResolver({})),
    /references must contain at most 20 asset IDs/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_WAN_MODEL,
      prompt: "Duplicate image",
      reference_image_asset_ids: ["same", "same"],
    }, referenceResolver({})),
    /must not contain duplicate asset ID same/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_WAN_MODEL,
      prompt: "Audio is not in the current AIO subset",
      reference_image_asset_ids: ["audio_ref"],
    }, referenceResolver({
      audio_ref: { url: "https://atlas.example/ref.mp3", type: "audio", mime_type: "audio/mpeg" },
    })),
    /must resolve to a image for Wan refers/,
  )
})

test("unsupported provider-specific fields are rejected instead of silently omitted", async () => {
  for (const [field, value] of [["audio", false], ["enable_thinking", true], ["file", "https://example.com/brief.pdf"], ["seed", 1], ["refers", []]]) {
    await assert.rejects(
      buildAtlasMediaRequest("video", { model: ATLAS_WAN_MODEL, prompt: "A scene", [field]: value }),
      new RegExp(`${field} is not supported`),
    )
  }
})
