import { setTimeout as delay } from "node:timers/promises"

import { createAtlasMediaRuntime } from "../../plugins/delegation/media-runtime.js"

const [directory, requestJSON, mode] = process.argv.slice(2)
const request = JSON.parse(requestJSON)
const runtime = createAtlasMediaRuntime({
  directory,
  client: {
    calculate: async () => {
      if (mode === "hold-calculate") {
        process.send({ type: "calculate_ready", job_id: request.job_id })
        await new Promise((resolve) => {
          process.once("message", (message) => {
            if (message.type === "continue_calculate") resolve()
          })
        })
      } else {
        await delay(75)
      }
      return { data: { price: 0.20, estimated: false } }
    },
    generateVideo: async () => {
      // The canonical reservation is already persisted, but no provider dispatch happened.
      if (mode === "crash-before-dispatch") process.exit(23)
      process.send({ type: "provider_submission", job_id: request.job_id })
      await delay(75)
      return { data: { id: `fake-worker-${request.job_id}`, status: "processing" } }
    },
  },
})

process.once("message", async () => {
  try {
    const value = await runtime.media_generate_video(request)
    process.send({ type: "result", value })
  } catch (error) {
    process.send({ type: "result", error: error.message })
  } finally {
    process.disconnect()
  }
})
process.send({ type: "ready" })
