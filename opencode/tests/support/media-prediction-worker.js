import { parentPort, workerData } from "node:worker_threads"

import { createAtlasMediaRuntime } from "../../plugins/delegation/media-runtime.js"

const signal = new Int32Array(workerData.signal)
const client = {
  prediction: async (predictionID) => ({
    data: {
      id: predictionID,
      status: "completed",
      outputs: ["https://atlas.example/wait-completed.png"],
      price: 0.2,
    },
  }),
  download: async (url) => ({
    bytes: Buffer.from(`materialized:${url}`),
    contentType: "image/png",
    sizeBytes: url.length + 15,
  }),
}

try {
  const runtime = createAtlasMediaRuntime({ directory: workerData.directory, client })
  const result = await runtime.media_prediction({
    job_id: workerData.job_id,
    manifest_path: workerData.manifest_path,
  })
  parentPort.postMessage({ result })
  Atomics.store(signal, 0, 1)
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) })
  Atomics.store(signal, 0, -1)
} finally {
  Atomics.notify(signal, 0)
}
