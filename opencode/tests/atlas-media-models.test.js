import test from "node:test"
import assert from "node:assert/strict"

import {
  ATLAS_GPT_IMAGE_MODEL,
  ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
  ATLAS_IMAGE_MODEL,
  ATLAS_MINIMAX_H3_MODEL,
  ATLAS_SEEDANCE_2_5_MODEL,
  ATLAS_WAN_MODEL,
  buildAtlasMediaRequest,
  listAtlasMediaModels,
  resolveAtlasMediaModel,
} from "../plugins/delegation/atlas-media-models.js"

const referenceResolver = (references) => async (assetID) => references[assetID]

test("Atlas model definitions contain exactly six active models", () => {
  const imageModels = listAtlasMediaModels("image").map(({ model }) => model)
  const videoModels = listAtlasMediaModels("video").map(({ model }) => model)
  const allModels = listAtlasMediaModels().map(({ model }) => model)

  assert.deepEqual(new Set(imageModels), new Set([
    ATLAS_IMAGE_MODEL,
    ATLAS_GPT_IMAGE_MODEL,
    ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
  ]))
  assert.deepEqual(new Set(videoModels), new Set([
    ATLAS_WAN_MODEL,
    ATLAS_MINIMAX_H3_MODEL,
    ATLAS_SEEDANCE_2_5_MODEL,
  ]))
  assert.equal(allModels.length, 6)
  assert.equal(new Set(allModels).size, 6)
})

test("omitted Atlas models default to GPT Image 2 and Wan 3.0", async () => {
  const image = await buildAtlasMediaRequest("image", { prompt: "A clean product portrait" })
  const video = await buildAtlasMediaRequest("video", {
    prompt: "A clean product turntable",
    duration_seconds: 4,
    resolution: "480p",
    ratio: "16:9",
  })

  assert.equal(image.body.model, ATLAS_GPT_IMAGE_MODEL)
  assert.equal(video.body.model, ATLAS_WAN_MODEL)
})

test("Seedream 5 Pro keeps the canonical image request", async () => {
  const request = await buildAtlasMediaRequest("image", {
    model: ATLAS_IMAGE_MODEL,
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

test("GPT Image 2 rejects unsupported sizes and Seedream-only fields", async () => {
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
      thinking: "enabled",
    }),
    /thinking is not supported for GPT Image 2/,
  )
})

test("GPT Image 2 accepts only curated quality values and stable size presets", async () => {
  for (const quality of ["low", "medium", "high"]) {
    const request = await buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "A quality-controlled image",
      quality,
    })
    assert.equal(request.body.quality, quality)
  }
  for (const [size, providerSize] of [
    ["1024*1024", "1024x1024"],
    ["1024*768", "1024x768"],
    ["768*1024", "768x1024"],
    ["1024*1536", "1024x1536"],
    ["1536*1024", "1536x1024"],
    ["2048*2048", "2048x2048"],
    ["2048*1152", "2048x1152"],
    ["1152*2048", "1152x2048"],
    ["2560*1088", "2560x1088"],
    ["1088*2560", "1088x2560"],
  ]) {
    const request = await buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "A stable curated canvas",
      size,
    })
    assert.equal(request.body.size, providerSize)
  }
  const omitted = await buildAtlasMediaRequest("image", {
    model: ATLAS_GPT_IMAGE_MODEL,
    prompt: "No explicit quality",
  })
  assert.equal("quality" in omitted.body, false)
  for (const quality of ["auto", "xhigh", "max"]) {
    await assert.rejects(
      buildAtlasMediaRequest("image", {
        model: ATLAS_GPT_IMAGE_MODEL,
        prompt: "A scene",
        quality,
      }),
      /quality must be one of: low, medium, high/,
    )
  }
  await assert.rejects(
    buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_MODEL,
      prompt: "An experimental canvas",
      size: "2880*2160",
    }),
    /size must map to a documented GPT Image 2 size/,
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

test("all image models reject audio references", async () => {
  for (const model of [ATLAS_IMAGE_MODEL, ATLAS_GPT_IMAGE_MODEL, ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL]) {
    await assert.rejects(
      buildAtlasMediaRequest("image", {
        model,
        prompt: "An image workflow",
        reference_audio_asset_ids: ["voice_reference"],
      }),
      /reference_audio_asset_ids is not supported for image generation/,
    )
  }
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

test("GPT Image 2.5 Sunburst maps stable curated sizes and background controls", async () => {
  for (const [size, providerSize] of [
    ["1024*1024", "1024x1024"],
    ["1024*768", "1024x768"],
    ["768*1024", "768x1024"],
    ["1024*1536", "1024x1536"],
    ["1536*1024", "1536x1024"],
    ["2048*2048", "2048x2048"],
    ["2048*1152", "2048x1152"],
    ["1152*2048", "1152x2048"],
    ["2560*1088", "2560x1088"],
    ["1088*2560", "1088x2560"],
  ]) {
    const request = await buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A stable curated canvas",
      size,
    })
    assert.equal(request.body.size, providerSize)
  }
  for (const background of ["auto", "opaque", "transparent"]) {
    const request = await buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A composited hero image",
      background,
      ...(background === "transparent" ? { output_format: "png" } : {}),
    })
    assert.equal(request.body.background, background)
  }
  const omitted = await buildAtlasMediaRequest("image", {
    model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
    prompt: "No explicit background",
  })
  assert.equal("background" in omitted.body, false)
  await assert.rejects(
    buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "A transparent cutout",
      background: "transparent",
      output_format: "jpeg",
    }),
    /output_format must be png when background is transparent/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("image", {
      model: ATLAS_GPT_IMAGE_2_5_SUNBURST_MODEL,
      prompt: "An experimental canvas",
      size: "2880*2160",
    }),
    /size must map to a documented GPT Image 2.5 Sunburst size/,
  )
})

test("Sunburst background is not broadened to other image models", async () => {
  for (const model of [ATLAS_GPT_IMAGE_MODEL, ATLAS_IMAGE_MODEL]) {
    await assert.rejects(
      buildAtlasMediaRequest("image", {
        model,
        prompt: "A non-Sunburst image",
        background: "opaque",
      }),
      new RegExp(model === ATLAS_IMAGE_MODEL
        ? "background is not supported for Seedream 5.0 Pro"
        : "background is not supported for GPT Image 2"),
    )
  }
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
    /quality must be one of: low, medium, high/,
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

test("MiniMax H3 rejects audio-only references and mismatched media kinds", async () => {
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "An audio-only reference is not allowed",
      reference_audio_asset_ids: ["beat"],
      resolution: "2k",
      duration_seconds: 8,
    }, referenceResolver({})),
    /requires at least one image or video reference/,
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
})

test("MiniMax H3 maps mixed image, video, and audio references in caller order", async () => {
  const request = await buildAtlasMediaRequest("video", {
    model: ATLAS_MINIMAX_H3_MODEL,
    prompt: "The subject follows the voice cue",
    reference_image_asset_ids: ["subject"],
    reference_video_asset_ids: ["movement"],
    reference_audio_asset_ids: ["voice", "rhythm"],
    resolution: "2k",
    duration_seconds: 8,
  }, referenceResolver({
    subject: { url: "https://atlas.example/subject.png", type: "image", mime_type: "image/png" },
    movement: { url: "https://atlas.example/movement.mp4", type: "video", mime_type: "video/mp4" },
    voice: { url: "https://atlas.example/voice.mp3", type: "audio", mime_type: "audio/mpeg" },
    rhythm: { url: "https://atlas.example/rhythm.wav", type: "audio", mime_type: "audio/x-wav" },
  }))

  assert.deepEqual(request.body.refers, [
    { url: "https://atlas.example/subject.png", type: "image" },
    { url: "https://atlas.example/movement.mp4", type: "video" },
    { url: "https://atlas.example/voice.mp3", type: "audio" },
    { url: "https://atlas.example/rhythm.wav", type: "audio" },
  ])
  assert.deepEqual(request.inputAssetIds, ["subject", "movement", "voice", "rhythm"])
})

test("MiniMax H3 enforces the conservative audio and aggregate reference boundaries", async () => {
  const audioIDs = ["audio_0", "audio_1", "audio_2"]
  const references = Object.fromEntries(audioIDs.map((assetID) => [assetID, {
    url: `https://atlas.example/${assetID}.mp3`,
    type: "audio",
    mime_type: "audio/mpeg",
  }]))
  const valid = await buildAtlasMediaRequest("video", {
    model: ATLAS_MINIMAX_H3_MODEL,
    prompt: "A visual anchor with three audio cues",
    reference_image_asset_ids: ["subject"],
    reference_audio_asset_ids: audioIDs,
    resolution: "2k",
    duration_seconds: 8,
  }, referenceResolver({
    subject: { url: "https://atlas.example/subject.png", type: "image", mime_type: "image/png" },
    ...references,
  }))
  assert.equal(valid.body.refers.length, 4)

  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "Too many audio cues",
      reference_image_asset_ids: ["subject"],
      reference_audio_asset_ids: [...audioIDs, "audio_3"],
      resolution: "2k",
      duration_seconds: 8,
    }, referenceResolver({})),
    /reference_audio_asset_ids must contain at most 3 asset IDs/,
  )

  const images = Array.from({ length: 7 }, (_, index) => `image_${index}`)
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "Too many total references",
      reference_image_asset_ids: images,
      reference_audio_asset_ids: audioIDs,
      resolution: "2k",
      duration_seconds: 8,
    }, referenceResolver({})),
    /MiniMax H3 supports at most 9 total references in the current AIO subset/,
  )

  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "Unsupported audio format",
      reference_image_asset_ids: ["subject"],
      reference_audio_asset_ids: ["bad_audio"],
      resolution: "2k",
      duration_seconds: 8,
    }, referenceResolver({
      subject: { url: "https://atlas.example/subject.png", type: "image", mime_type: "image/png" },
      bad_audio: { url: "https://atlas.example/bad.ogg", type: "audio", mime_type: "audio/ogg" },
    })),
    /unsupported MiniMax H3 audio format/,
  )
})

test("MiniMax H3 preserves explicit prompt expansion and rejects other new video controls", async () => {
  const resolveReference = referenceResolver({
    subject: { url: "https://atlas.example/subject.png", type: "image", mime_type: "image/png" },
  })
  for (const prompt_expansion of [true, false]) {
    const request = await buildAtlasMediaRequest("video", {
      model: ATLAS_MINIMAX_H3_MODEL,
      prompt: "A prompt-controlled scene",
      reference_image_asset_ids: ["subject"],
      resolution: "2k",
      duration_seconds: 8,
      prompt_expansion,
    }, resolveReference)
    assert.equal(request.body.prompt_expansion, prompt_expansion)
  }
  const omitted = await buildAtlasMediaRequest("video", {
    model: ATLAS_MINIMAX_H3_MODEL,
    prompt: "No explicit prompt expansion",
    reference_image_asset_ids: ["subject"],
    resolution: "2k",
    duration_seconds: 8,
  }, resolveReference)
  assert.equal("prompt_expansion" in omitted.body, false)
  for (const [field, value] of [["generate_audio", false], ["seed", 123], ["video_output_format", "mov"]]) {
    await assert.rejects(
      buildAtlasMediaRequest("video", {
        model: ATLAS_MINIMAX_H3_MODEL,
        prompt: "A scene",
        reference_image_asset_ids: ["subject"],
        resolution: "2k",
        duration_seconds: 8,
        [field]: value,
      }, resolveReference),
      new RegExp(`${field} is not supported for MiniMax H3 reference-to-video`),
    )
  }
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

test("Seedance 2.5 builds the minimal reference-to-video request with the exact model ID", async () => {
  const request = await buildAtlasMediaRequest("video", {
    model: ATLAS_SEEDANCE_2_5_MODEL,
    prompt: "The subject turns toward camera",
    reference_image_asset_ids: ["subject_front"],
  }, referenceResolver({
    subject_front: { url: "https://atlas.example/subject.png", type: "image", mime_type: "image/png" },
  }))

  assert.equal(ATLAS_SEEDANCE_2_5_MODEL, "bytedance/seedance-2.5/reference-to-video")
  assert.deepEqual(request, {
    body: {
      model: "bytedance/seedance-2.5/reference-to-video",
      prompt: "The subject turns toward camera",
      reference_images: ["https://atlas.example/subject.png"],
      omni_reference_task_type: "reference",
    },
    inputAssetIds: ["subject_front"],
  })
})

test("Seedance 2.5 maps ordered image and video references to exact provider fields", async () => {
  const request = await buildAtlasMediaRequest("video", {
    model: ATLAS_SEEDANCE_2_5_MODEL,
    prompt: "The subject moves through the set",
    reference_image_asset_ids: ["image_b", "image_a"],
    reference_video_asset_ids: ["video_b", "video_a"],
    duration_seconds: 30,
    resolution: "1080p-esr & 60fps",
    ratio: "21:9",
  }, referenceResolver({
    image_a: { url: "https://atlas.example/image-a.png", type: "image", mime_type: "image/png" },
    image_b: { url: "https://atlas.example/image-b.webp", type: "image", mime_type: "image/webp" },
    video_a: { url: "https://atlas.example/video-a.mp4", type: "video", mime_type: "video/mp4" },
    video_b: { url: "https://atlas.example/video-b.mov", type: "video", mime_type: "video/quicktime" },
  }))

  assert.deepEqual(request.body, {
    model: ATLAS_SEEDANCE_2_5_MODEL,
    prompt: "The subject moves through the set",
    reference_images: ["https://atlas.example/image-b.webp", "https://atlas.example/image-a.png"],
    reference_videos: ["https://atlas.example/video-b.mov", "https://atlas.example/video-a.mp4"],
    duration: 30,
    resolution: "1080p-esr & 60fps",
    ratio: "21:9",
    omni_reference_task_type: "reference",
  })
  assert.deepEqual(request.inputAssetIds, ["image_b", "image_a", "video_b", "video_a"])
})

test("Seedance 2.5 maps ordered audio references to reference_audios and supports audio-only", async () => {
  const mixed = await buildAtlasMediaRequest("video", {
    model: ATLAS_SEEDANCE_2_5_MODEL,
    prompt: "The subject follows the voice and rhythm",
    reference_image_asset_ids: ["subject"],
    reference_audio_asset_ids: ["voice", "music"],
    generate_audio: false,
  }, referenceResolver({
    subject: { url: "https://atlas.example/subject.png", type: "image", mime_type: "image/png" },
    voice: { url: "https://atlas.example/voice.mp3", type: "audio", mime_type: "audio/mpeg", size_bytes: 1_024 },
    music: { url: "https://atlas.example/music.wav", type: "audio", mime_type: "audio/wav", size_bytes: 2_048 },
  }))
  assert.deepEqual(mixed.body.reference_audios, [
    "https://atlas.example/voice.mp3",
    "https://atlas.example/music.wav",
  ])
  assert.equal(mixed.body.generate_audio, false)
  assert.equal(mixed.body.omni_reference_task_type, "reference")
  assert.deepEqual(mixed.inputAssetIds, ["subject", "voice", "music"])

  const audioOnly = await buildAtlasMediaRequest("video", {
    model: ATLAS_SEEDANCE_2_5_MODEL,
    prompt: "A visual sequence paced by this music",
    reference_audio_asset_ids: ["music"],
  }, referenceResolver({
    music: { url: "https://atlas.example/music.wav", type: "audio", mime_type: "audio/wav" },
  }))
  assert.deepEqual(audioOnly.body.reference_audios, ["https://atlas.example/music.wav"])
  assert.equal(audioOnly.body.reference_images, undefined)
  assert.equal(audioOnly.body.reference_videos, undefined)
  assert.equal(audioOnly.body.omni_reference_task_type, "reference")
})

test("Seedance 2.5 enforces audio count, format, and size boundaries", async () => {
  const audioIDs = Array.from({ length: 10 }, (_, index) => `audio_${index}`)
  const references = Object.fromEntries(audioIDs.map((assetID) => [assetID, {
    url: `https://atlas.example/${assetID}.mp3`,
    type: "audio",
    mime_type: "audio/mpeg",
    size_bytes: 15 * 1024 * 1024,
  }]))
  const valid = await buildAtlasMediaRequest("video", {
    model: ATLAS_SEEDANCE_2_5_MODEL,
    prompt: "Ten ordered audio references",
    reference_audio_asset_ids: audioIDs,
  }, referenceResolver(references))
  assert.equal(valid.body.reference_audios.length, 10)
  assert.deepEqual(valid.inputAssetIds, audioIDs)

  let resolutions = 0
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "Too many audio references",
      reference_audio_asset_ids: [...audioIDs, "audio_overflow"],
    }, async () => {
      resolutions += 1
      return references.audio_0
    }),
    /reference_audio_asset_ids must contain at most 10 asset IDs/,
  )
  assert.equal(resolutions, 0)

  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "Unsupported audio format",
      reference_audio_asset_ids: ["bad_audio"],
    }, referenceResolver({
      bad_audio: { url: "https://atlas.example/bad.ogg", type: "audio", mime_type: "audio/ogg" },
    })),
    /unsupported Seedance 2.5 audio format/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "Audio file is too large",
      reference_audio_asset_ids: ["large_audio"],
    }, referenceResolver({
      large_audio: {
        url: "https://atlas.example/large.mp3",
        type: "audio",
        mime_type: "audio/mpeg",
        size_bytes: 15 * 1024 * 1024 + 1,
      },
    })),
    /exceeds the Seedance 2.5 audio size limit/,
  )
})

test("Seedance 2.5 accepts the official per-type reference boundaries and rejects overflow before resolving", async () => {
  const imageIDs = Array.from({ length: 30 }, (_, index) => `image_${index}`)
  const videoIDs = Array.from({ length: 10 }, (_, index) => `video_${index}`)
  const references = Object.fromEntries([
    ...imageIDs.map((assetID) => [assetID, { url: `https://atlas.example/${assetID}.png`, type: "image", mime_type: "image/png" }]),
    ...videoIDs.map((assetID) => [assetID, { url: `https://atlas.example/${assetID}.mp4`, type: "video", mime_type: "video/mp4" }]),
  ])
  const request = await buildAtlasMediaRequest("video", {
    model: ATLAS_SEEDANCE_2_5_MODEL,
    prompt: "A complex reference composition",
    reference_image_asset_ids: imageIDs,
    reference_video_asset_ids: videoIDs,
  }, referenceResolver(references))
  assert.equal(request.body.reference_images.length, 30)
  assert.equal(request.body.reference_videos.length, 10)

  let resolutions = 0
  const resolveReference = async () => {
    resolutions += 1
    return { url: "https://atlas.example/reference.png", type: "image", mime_type: "image/png" }
  }
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "Too many image references",
      reference_image_asset_ids: [...imageIDs, "image_overflow"],
    }, resolveReference),
    /reference_image_asset_ids must contain at most 30 asset IDs/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "Too many video references",
      reference_video_asset_ids: [...videoIDs, "video_overflow"],
    }, resolveReference),
    /reference_video_asset_ids must contain at most 10 asset IDs/,
  )
  assert.equal(resolutions, 0)
})

test("Seedance 2.5 validates duration, resolution, and ratio independently of existing Seedance models", async () => {
  const resolveReference = referenceResolver({
    subject: { url: "https://atlas.example/subject.png", type: "image", mime_type: "image/png" },
  })
  for (const duration_seconds of [-1, 4, 30]) {
    await assert.doesNotReject(buildAtlasMediaRequest("video", {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "A reference generation",
      reference_image_asset_ids: ["subject"],
      duration_seconds,
    }, resolveReference))
  }
  for (const resolution of [
    "480p",
    "720p",
    "720p-sr",
    "720p-esr",
    "1080p",
    "1080p-sr",
    "1080p-esr",
    "1080p-esr & 60fps",
    "1440p-sr",
    "1440p-esr",
    "4k-esr",
  ]) {
    await assert.doesNotReject(buildAtlasMediaRequest("video", {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "A reference generation",
      reference_image_asset_ids: ["subject"],
      resolution,
    }, resolveReference))
  }
  for (const ratio of ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]) {
    await assert.doesNotReject(buildAtlasMediaRequest("video", {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "A reference generation",
      reference_image_asset_ids: ["subject"],
      ratio,
    }, resolveReference))
  }
  for (const [field, value] of [
    ["duration_seconds", 3],
    ["duration_seconds", 31],
    ["duration_seconds", 4.5],
    ["resolution", "8k-esr"],
    ["ratio", "4:5"],
  ]) {
    await assert.rejects(
      buildAtlasMediaRequest("video", {
        model: ATLAS_SEEDANCE_2_5_MODEL,
        prompt: "A reference generation",
        reference_image_asset_ids: ["subject"],
        duration_seconds: field === "duration_seconds" ? value : undefined,
        resolution: field === "resolution" ? value : undefined,
        ratio: field === "ratio" ? value : undefined,
      }, resolveReference),
      new RegExp(field === "duration_seconds" ? "duration_seconds must be -1 or an integer from 4 through 30" : `${field} must be one of:`),
    )
  }
})

test("Seedance 2.5 maps normalized audio and video output controls exactly", async () => {
  const resolveReference = referenceResolver({
    subject: { url: "https://atlas.example/subject.png", type: "image", mime_type: "image/png" },
  })
  for (const generate_audio of [true, false]) {
    const request = await buildAtlasMediaRequest("video", {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "A soundtrack-aware reference shot",
      reference_image_asset_ids: ["subject"],
      generate_audio,
      video_output_format: "mov",
    }, resolveReference)
    assert.equal(request.body.generate_audio, generate_audio)
    assert.equal(request.body.output_format, "mov")
  }
  const omitted = await buildAtlasMediaRequest("video", {
    model: ATLAS_SEEDANCE_2_5_MODEL,
    prompt: "No explicit soundtrack or container",
    reference_image_asset_ids: ["subject"],
  }, resolveReference)
  assert.equal("generate_audio" in omitted.body, false)
  assert.equal("output_format" in omitted.body, false)
  for (const video_output_format of ["mp4", "mov"]) {
    await assert.doesNotReject(buildAtlasMediaRequest("video", {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "A valid container choice",
      reference_image_asset_ids: ["subject"],
      video_output_format,
    }, resolveReference))
  }
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "An invalid container",
      reference_image_asset_ids: ["subject"],
      video_output_format: "webm",
    }, resolveReference),
    /video_output_format must be one of: mp4, mov/,
  )
  for (const [field, value] of [["seed", 123], ["prompt_expansion", true]]) {
    await assert.rejects(
      buildAtlasMediaRequest("video", {
        model: ATLAS_SEEDANCE_2_5_MODEL,
        prompt: "A scene",
        reference_image_asset_ids: ["subject"],
        [field]: value,
      }, resolveReference),
      new RegExp(`${field} is not supported for Seedance 2.5 reference-to-video`),
    )
  }
})

test("Seedance 2.5 validates manifest media kinds and documented reference formats", async () => {
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "A scene",
      reference_image_asset_ids: ["audio"],
    }, referenceResolver({
      audio: { url: "https://atlas.example/voice.mp3", type: "audio", mime_type: "audio/mpeg" },
    })),
    /must resolve to a image for Seedance 2.5 reference-to-video/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_SEEDANCE_2_5_MODEL,
      prompt: "A scene",
      reference_video_asset_ids: ["webm"],
    }, referenceResolver({
      webm: { url: "https://atlas.example/reference.webm", type: "video", mime_type: "video/webm" },
    })),
    /unsupported Seedance 2.5 video format/,
  )
  await assert.doesNotReject(buildAtlasMediaRequest("video", {
    model: ATLAS_SEEDANCE_2_5_MODEL,
    prompt: "A scene",
    reference_image_asset_ids: ["tiff"],
    reference_video_asset_ids: ["mov"],
  }, referenceResolver({
    tiff: { url: "https://atlas.example/reference.tiff", type: "image", mime_type: "image/tiff" },
    mov: { url: "https://atlas.example/reference.mov", type: "video", mime_type: "video/quicktime" },
  })))
})

test("Seedance 2.5 rejects audio, raw provider references, and edit or extension controls", async () => {
  for (const [field, value, message] of [
    ["reference_audios", ["https://atlas.example/audio.mp3"], /reference_audios is not supported by the AIO media-generation contract/],
    ["reference_images", ["https://atlas.example/reference.png"], /reference_images is not supported by the AIO media-generation contract/],
    ["reference_videos", ["https://atlas.example/reference.mp4"], /reference_videos is not supported by the AIO media-generation contract/],
    ["omni_reference_task_type", "edit", /omni_reference_task_type is not supported by the AIO media-generation contract/],
    ["editing", true, /editing is not supported by the AIO media-generation contract/],
    ["extend", true, /extend is not supported by the AIO media-generation contract/],
  ]) {
    await assert.rejects(
      buildAtlasMediaRequest("video", {
        model: ATLAS_SEEDANCE_2_5_MODEL,
        prompt: "A scene",
        reference_image_asset_ids: ["subject"],
        [field]: value,
      }, referenceResolver({
        subject: { url: "https://atlas.example/subject.png", type: "image", mime_type: "image/png" },
      })),
      message,
    )
  }
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
    reference_audio_asset_ids: ["voice_reference", "rhythm_reference"],
    duration_seconds: -1,
    resolution: "1080p-esr",
    ratio: "adaptive",
    generate_audio: false,
    seed: -1,
  }, referenceResolver({
    subject_front: { url: "https://atlas.example/front.png", type: "image", mime_type: "image/png" },
    subject_side: { url: "https://atlas.example/side.webp", type: "image", mime_type: "image/webp" },
    movement_reference: { url: "https://atlas.example/movement.mov", type: "video", mime_type: "video/quicktime" },
    voice_reference: { url: "https://atlas.example/voice.mp3", type: "audio", mime_type: "audio/mpeg" },
    rhythm_reference: { url: "https://atlas.example/rhythm.wav", type: "audio", mime_type: "audio/x-wav" },
  }))

  assert.deepEqual(request, {
    body: {
      model: ATLAS_WAN_MODEL,
      prompt: "Keep the subject identity while walking through the set",
      refers: [
      { url: "https://atlas.example/front.png", type: "image" },
      { url: "https://atlas.example/side.webp", type: "image" },
      { url: "https://atlas.example/movement.mov", type: "video" },
      { url: "https://atlas.example/voice.mp3", type: "audio" },
      { url: "https://atlas.example/rhythm.wav", type: "audio" },
      ],
      resolution: "1080p-esr",
      duration: -1,
      ratio: "adaptive",
      audio: false,
      seed: -1,
    },
    inputAssetIds: ["subject_front", "subject_side", "movement_reference", "voice_reference", "rhythm_reference"],
  })
})

test("Wan 3.0 enforces audio limits, supported formats, and the verified visual boundary", async () => {
  const audioIDs = ["audio_0", "audio_1", "audio_2", "audio_3", "audio_4"]
  const references = Object.fromEntries(audioIDs.map((assetID) => [assetID, {
    url: `https://atlas.example/${assetID}.mp3`,
    type: "audio",
    mime_type: "audio/mpeg",
  }]))
  const valid = await buildAtlasMediaRequest("video", {
    model: ATLAS_WAN_MODEL,
    prompt: "Visual subject with five audio cues",
    reference_image_asset_ids: ["subject"],
    reference_audio_asset_ids: audioIDs,
    generate_audio: false,
  }, referenceResolver({
    subject: { url: "https://atlas.example/subject.png", type: "image", mime_type: "image/png" },
    ...references,
  }))
  assert.equal(valid.body.refers.length, 6)
  assert.equal(valid.body.audio, false)
  assert.deepEqual(valid.inputAssetIds, ["subject", ...audioIDs])

  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_WAN_MODEL,
      prompt: "Too many audio references",
      reference_image_asset_ids: ["subject"],
      reference_audio_asset_ids: [...audioIDs, "audio_overflow"],
    }, referenceResolver({})),
    /reference_audio_asset_ids must contain at most 5 asset IDs/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_WAN_MODEL,
      prompt: "Too many total references",
      reference_image_asset_ids: Array.from({ length: 16 }, (_, index) => `image_${index}`),
      reference_audio_asset_ids: audioIDs,
    }, referenceResolver({})),
    /references must contain at most 20 asset IDs/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_WAN_MODEL,
      prompt: "Audio-only references remain outside the ambiguous Wan contract",
      reference_audio_asset_ids: ["audio_0"],
    }, referenceResolver(references)),
    /requires at least one image or video reference when audio references are provided/,
  )
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_WAN_MODEL,
      prompt: "Unsupported audio format",
      reference_image_asset_ids: ["subject"],
      reference_audio_asset_ids: ["bad_audio"],
    }, referenceResolver({
      subject: { url: "https://atlas.example/subject.png", type: "image", mime_type: "image/png" },
      bad_audio: { url: "https://atlas.example/bad.flac", type: "audio", mime_type: "audio/flac" },
    })),
    /unsupported Wan audio format/,
  )
})

test("Wan 3.0 accepts the exact resolution set and normalized audio and seed controls", async () => {
  const resolveReference = referenceResolver({
    subject: { url: "https://atlas.example/subject.png", type: "image", mime_type: "image/png" },
  })
  for (const resolution of ["480p", "720p", "1080p", "720p-esr", "1080p-esr", "1440p-esr", "4k-esr"]) {
    await assert.doesNotReject(buildAtlasMediaRequest("video", {
      model: ATLAS_WAN_MODEL,
      prompt: "A supported Wan resolution",
      reference_image_asset_ids: ["subject"],
      resolution,
    }, resolveReference))
  }
  for (const generate_audio of [true, false]) {
    const request = await buildAtlasMediaRequest("video", {
      model: ATLAS_WAN_MODEL,
      prompt: "A soundtrack-aware Wan shot",
      reference_image_asset_ids: ["subject"],
      generate_audio,
    }, resolveReference)
    assert.equal(request.body.audio, generate_audio)
  }
  for (const seed of [-1, 0, 123456789]) {
    const request = await buildAtlasMediaRequest("video", {
      model: ATLAS_WAN_MODEL,
      prompt: "A reproducible Wan shot",
      reference_image_asset_ids: ["subject"],
      seed,
    }, resolveReference)
    assert.equal(request.body.seed, seed)
  }
  const omitted = await buildAtlasMediaRequest("video", {
    model: ATLAS_WAN_MODEL,
    prompt: "No explicit soundtrack or seed",
    reference_image_asset_ids: ["subject"],
  }, resolveReference)
  assert.equal("audio" in omitted.body, false)
  assert.equal("seed" in omitted.body, false)
  await assert.rejects(
    buildAtlasMediaRequest("video", {
      model: ATLAS_WAN_MODEL,
      prompt: "A noninteger seed",
      seed: 1.5,
    }),
    /seed must be an integer/,
  )
  for (const [field, value] of [["prompt_expansion", true], ["video_output_format", "mov"]]) {
    await assert.rejects(
      buildAtlasMediaRequest("video", {
        model: ATLAS_WAN_MODEL,
        prompt: "A scene",
        [field]: value,
      }),
      new RegExp(`${field} is not supported for Wan reference-to-video`),
    )
  }
})

test("unsupported or mismatched Atlas models are rejected before request construction", async () => {
  assert.throws(() => resolveAtlasMediaModel("video", "example/unsupported/model"), /unsupported Atlas media model/)
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
      resolution: "8k-esr",
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
  for (const [field, value] of [["audio", false], ["enable_thinking", true], ["file", "https://example.com/brief.pdf"], ["refers", []]]) {
    await assert.rejects(
      buildAtlasMediaRequest("video", { model: ATLAS_WAN_MODEL, prompt: "A scene", [field]: value }),
      new RegExp(`${field} is not supported`),
    )
  }
})
