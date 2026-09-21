import test from "node:test"
import assert from "node:assert/strict"

import {
  ATLAS_GPT_IMAGE_MODEL,
  ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
  ATLAS_IMAGE_MODEL,
  ATLAS_MINIMAX_H3_MODEL,
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

test("GPT Image 2.5 Sunburst uses the exact model ID and provider defaults", async () => {
  const request = await buildAtlasMediaRequest("image", {
    model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
    prompt: "A premium cinematic product still",
  })

  assert.equal(ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL, "openai/gpt-image-2.5-sunburst/text-to-image")
  assert.deepEqual(request, {
    body: {
      model: "openai/gpt-image-2.5-sunburst/text-to-image",
      prompt: "A premium cinematic product still",
    },
    inputAssetIds: [],
  })
})

test("GPT Image 2.5 Sunburst maps AIO size and output format exactly", async () => {
  for (const output_format of ["jpeg", "png"]) {
    const request = await buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A polished hero image",
      size: "2048*1152",
      output_format,
      quality: "xhigh",
    })

    assert.deepEqual(request.body, {
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A polished hero image",
      size: "2048x1152",
      output_format,
      quality: "xhigh",
    })
  }
  await assert.rejects(
    buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A polished hero image",
      output_format: "webp",
    }),
    /output_format must be one of: jpeg, png/,
  )
})

test("GPT Image 2.5 Sunburst accepts every documented quality value", async () => {
  for (const quality of ["auto", "low", "medium", "high", "xhigh", "max"]) {
    const request = await buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A quality-controlled image",
      quality,
    })
    assert.equal(request.body.quality, quality)
  }
})

test("GPT Image 2.5 Sunburst rejects invalid quality and unsupported sizes before network work", async () => {
  await assert.rejects(
    buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A scene",
      quality: "ultra",
    }),
    /quality must be one of: auto, low, medium, high, xhigh, max/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A scene",
      size: "2720*1530",
    }),
    /size must map to a documented GPT Image 2.5 Sunburst size/,
  )
})

test("Sunburst quality is model-specific and does not broaden existing image models", async () => {
  const request = await buildAtlasMediaRequest("image", {
    model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
    prompt: "A premium image",
    quality: "max",
  })
  assert.equal(request.body.quality, "max")

  await assert.rejects(
    buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "An existing GPT Image 2 request",
      quality: "max",
    }),
    /quality is not supported by the AIO media-generation contract/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("image", {
      model: ATLAS_IMAGE_MODEL,
      prompt: "An existing Seedream request",
      quality: "max",
    }),
    /quality is not supported by the AIO media-generation contract/,
  )
})

test("GPT Image 2.5 Sunburst rejects Seedream, edit, and unexposed provider fields", async () => {
  for (const [field, value, message] of [
    ["thinking", "enabled", /thinking is not supported for GPT Image 2.5 Sunburst/],
    ["prompt_optimization_mode", "standard", /prompt_optimization_mode is not supported for GPT Image 2.5 Sunburst/],
    ["reference_image_asset_ids", ["reference"], /reference_image_asset_ids is not supported for image generation/],
    ["mask", "mask-data", /mask is not supported by the AIO media-generation contract/],
    ["background", "opaque", /background is not supported by the AIO media-generation contract/],
    ["n", 2, /n is not supported by the AIO media-generation contract/],
  ]) {
    await assert.rejects(
      buildAtlasMediaRequest("image", {
        model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
        prompt: "A scene",
        [field]: value,
      }),
      message,
    )
  }
})

test("MiniMax H3 builds the minimal documented reference-to-video request", async () => {
  const request = await buildAtlasMediaRequest("video", {
    model: ATLAS_MINIMAX_H3_MODEL,
    prompt: "A subject walks through a rainy night market",
    reference_image_asset_ids: ["subject_front"],
    resolution: "2k",
    duration_seconds: 8,
  }, referenceResolver({
    subject_front: { url: "https://atlas.example/subject.png", type: "image", mime_type: "image/png" },
  }))

  assert.equal(ATLAS_MINIMAX_H3_MODEL, "minimax/h3/reference-to-video")
  assert.deepEqual(request, {
    body: {
      model: "minimax/h3/reference-to-video",
      prompt: "A subject walks through a rainy night market",
      refers: [{ url: "https://atlas.example/subject.png", type: "image" }],
      resolution: "2K",
      duration: 8,
    },
    inputAssetIds: ["subject_front"],
  })
})

test("MiniMax H3 maps mixed image and video references with provider resolution casing", async () => {
  const request = await buildAtlasMediaRequest("video", {
    model: ATLAS_MINIMAX_H3_MODEL,
    prompt: "The subject moves from the street into the shop",
    reference_image_asset_ids: ["subject_front"],
    reference_video_asset_ids: ["movement_reference"],
    resolution: "768p",
    duration_seconds: 15,
    ratio: "21:9",
  }, referenceResolver({
    subject_front: { url: "https://atlas.example/subject.webp", type: "image", mime_type: "image/webp" },
    movement_reference: { url: "https://atlas.example/movement.mov", type: "video", mime_type: "video/quicktime" },
  }))

  assert.deepEqual(request, {
    body: {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "The subject moves from the street into the shop",
      refers: [
        { url: "https://atlas.example/subject.webp", type: "image" },
        { url: "https://atlas.example/movement.mov", type: "video" },
      ],
      resolution: "768P",
      duration: 15,
      ratio: "21:9",
    },
    inputAssetIds: ["subject_front", "movement_reference"],
  })
})

test("MiniMax H3 requires a visual reference before resolving or contacting a provider", async () => {
  let resolutions = 0
  const resolveReference = async () => {
    resolutions += 1
    return { url: "https://atlas.example/reference.png", type: "image", mime_type: "image/png" }
  }

  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "A scene with no visual anchor",
      resolution: "2k",
      duration_seconds: 8,
    }, resolveReference),
    /requires at least one image or video reference/,
  )
  assert.equal(resolutions, 0)
})

test("MiniMax H3 rejects invalid duration, resolution, and ratio before reference resolution", async () => {
  let resolutions = 0
  const resolveReference = async () => {
    resolutions += 1
    return { url: "https://atlas.example/reference.png", type: "image", mime_type: "image/png" }
  }

  for (const [field, value, message] of [
    ["duration_seconds", 3, /duration_seconds must be an integer from 4 through 15/],
    ["duration_seconds", -1, /duration_seconds must be an integer from 4 through 15/],
    ["resolution", "1080p", /resolution must be one of: 768p, 2k/],
    ["ratio", "4:5", /ratio must be one of:/],
  ]) {
    await assert.rejects(
      buildAtlasMediaRequest("video", {
        model: ATLAS_MINIMAX_H3_MODEL,
        prompt: "A scene",
        reference_image_asset_ids: ["subject"],
        resolution: field === "resolution" ? value : "2k",
        duration_seconds: field === "duration_seconds" ? value : 8,
        ratio: field === "ratio" ? value : undefined,
      }, resolveReference),
      message,
    )
  }
  assert.equal(resolutions, 0)
})

test("MiniMax H3 enforces the conservative documented image and video reference subset", async () => {
  const images = Array.from({ length: 10 }, (_, index) => `image_${index}`)
  const videos = Array.from({ length: 4 }, (_, index) => `video_${index}`)
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "Too many images",
      reference_image_asset_ids: images,
      resolution: "2k",
      duration_seconds: 8,
    }, referenceResolver({})),
    /reference_image_asset_ids must contain at most 9 asset IDs/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "Too many videos",
      reference_video_asset_ids: videos,
      resolution: "2k",
      duration_seconds: 8,
    }, referenceResolver({})),
    /reference_video_asset_ids must contain at most 3 asset IDs/,
  )
})

test("MiniMax H3 accepts the conservative aggregate reference boundary", async () => {
  const images = Array.from({ length: 6 }, (_, index) => `image_${index}`)
  const videos = Array.from({ length: 3 }, (_, index) => `video_${index}`)
  const references = Object.fromEntries([
    ...images.map((assetID) => [assetID, { url: `https://atlas.example/${assetID}.png`, type: "image", mime_type: "image/png" }]),
    ...videos.map((assetID) => [assetID, { url: `https://atlas.example/${assetID}.mp4`, type: "video", mime_type: "video/mp4" }]),
  ])

  const request = await buildAtlasMediaRequest("video", {
    model: ATLAS_MINIMAX_H3_MODEL,
    prompt: "Accept nine total visual references",
    reference_image_asset_ids: images,
    reference_video_asset_ids: videos,
    resolution: "2k",
    duration_seconds: 8,
  }, referenceResolver(references))

  assert.equal(request.body.refers.length, 9)
  assert.deepEqual(request.inputAssetIds, [...images, ...videos])
})

test("MiniMax H3 rejects aggregate reference overflow within the per-type limits", async () => {
  const images = Array.from({ length: 7 }, (_, index) => `image_${index}`)
  const videos = Array.from({ length: 3 }, (_, index) => `video_${index}`)
  const references = Object.fromEntries([
    ...images.map((assetID) => [assetID, { url: `https://atlas.example/${assetID}.png`, type: "image", mime_type: "image/png" }]),
    ...videos.map((assetID) => [assetID, { url: `https://atlas.example/${assetID}.mp4`, type: "video", mime_type: "video/mp4" }]),
  ])
  let resolutions = 0
  const resolveReference = async (assetID) => {
    resolutions += 1
    return references[assetID]
  }

  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "Reject ten total visual references",
      reference_image_asset_ids: images,
      reference_video_asset_ids: videos,
      resolution: "2k",
      duration_seconds: 8,
    }, resolveReference),
    /MiniMax H3 supports at most 9 total references in the current AIO subset/,
  )
  assert.equal(resolutions, 0)
})

test("MiniMax H3 rejects audio references and unsupported provider fields", async () => {
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "An audio-only reference is not allowed",
      reference_audio_asset_ids: ["beat"],
      resolution: "2k",
      duration_seconds: 8,
    }, referenceResolver({})),
    /reference_audio_asset_ids is not supported by the AIO media-generation contract/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "An audio reference is not in the current AIO subset",
      reference_image_asset_ids: ["audio"],
      resolution: "2k",
      duration_seconds: 8,
    }, referenceResolver({
      audio: { url: "https://atlas.example/beat.mp3", type: "audio", mime_type: "audio/mpeg" },
    })),
    /must resolve to a image for MiniMax H3 refers/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "Prompt expansion remains unexposed",
      reference_image_asset_ids: ["subject"],
      resolution: "2k",
      duration_seconds: 8,
      prompt_expansion: true,
    }, referenceResolver({})),
    /prompt_expansion is not supported by the AIO media-generation contract/,
  )
})

test("MiniMax H3 rejects unsupported reference formats and preserves explicit types", async () => {
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "A scene",
      reference_image_asset_ids: ["gif_reference"],
      resolution: "2k",
      duration_seconds: 8,
    }, referenceResolver({
      gif_reference: { url: "https://atlas.example/reference.gif", type: "image", mime_type: "image/gif" },
    })),
    /unsupported MiniMax H3 image format/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "A scene",
      reference_video_asset_ids: ["webm_reference"],
      resolution: "2k",
      duration_seconds: 8,
    }, referenceResolver({
      webm_reference: { url: "https://atlas.example/reference.webm", type: "video", mime_type: "video/webm" },
    })),
    /unsupported MiniMax H3 video format/,
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
