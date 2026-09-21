const DEFAULT_BASE_URL = "https://api.atlascloud.ai"
const DEFAULT_RETRY_DELAY_MS = 250

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function redact(value, secret = "") {
  let safe = String(value ?? "")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/(?:api[_-]?key|authorization|token|secret)\s*[:=]\s*[^\s,}"']+/gi, "credential=[redacted]")
  if (secret) {
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    safe = safe.replace(new RegExp(escaped, "g"), "[redacted]")
  }
  return safe.slice(0, 400)
}

function providerMessage(payload, secret) {
  const candidates = [
    payload?.error?.message,
    payload?.error,
    payload?.message,
    payload?.data?.error?.message,
    payload?.data?.error,
    payload?.data?.message,
  ]
  const message = candidates.find((value) => typeof value === "string" && value.trim())
  return redact(message ?? "request rejected", secret)
}

async function responsePayload(response) {
  if (typeof response?.text === "function") {
    const text = await response.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  if (typeof response?.json === "function") return response.json()
  return null
}

function transientStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

export class AtlasCloudError extends Error {
  constructor(message, { operation, status, code, predictionId } = {}) {
    super(message)
    this.name = "AtlasCloudError"
    this.operation = operation ?? null
    this.status = status ?? null
    this.code = code ?? null
    this.prediction_id = predictionId ?? null
  }
}

export function createAtlasClient({
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  apiKey,
  sleepImpl = sleep,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Atlas Cloud requires a supported fetch implementation")
  const root = String(baseUrl).replace(/\/$/, "")

  function configuredKey() {
    const value = apiKey === undefined ? process.env.ATLASCLOUD_API_KEY : apiKey
    if (typeof value !== "string" || !value.trim()) {
      throw new AtlasCloudError("Atlas Cloud is not configured: ATLASCLOUD_API_KEY is missing", {
        operation: "configure",
      })
    }
    return value.trim()
  }

  async function request(operation, path, {
    method = "GET",
    jsonBody,
    formData,
    retries = 0,
  } = {}) {
    const key = configuredKey()
    const headers = {
      Authorization: `Bearer ${key}`,
    }
    let body
    if (formData !== undefined) {
      body = formData
    } else if (jsonBody !== undefined) {
      headers["Content-Type"] = "application/json"
      body = JSON.stringify(jsonBody)
    }

    for (let attempt = 0; ; attempt += 1) {
      let response
      try {
        response = await fetchImpl(`${root}${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body }),
        })
      } catch {
        if (attempt < retries) {
          await sleepImpl(retryDelayMs * (attempt + 1))
          continue
        }
        throw new AtlasCloudError(`Atlas ${operation} request failed: network error`, { operation })
      }

      const payload = await responsePayload(response)
      const status = Number(response?.status ?? 0)
      const ok = response?.ok ?? (status >= 200 && status < 300)
      if (ok) return payload

      if (attempt < retries && transientStatus(status)) {
        await sleepImpl(retryDelayMs * (attempt + 1))
        continue
      }

      const code = typeof payload?.error?.code === "string"
        ? payload.error.code
        : typeof payload?.code === "string" ? payload.code : null
      throw new AtlasCloudError(
        `Atlas ${operation} failed (HTTP ${status || "unknown"}): ${providerMessage(payload, key)}`,
        { operation, status, code },
      )
    }
  }

  async function download(url) {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      throw new AtlasCloudError("Atlas output download rejected: invalid provider URL", { operation: "download" })
    }
    if (parsed.protocol !== "https:") {
      throw new AtlasCloudError("Atlas output download rejected: provider URL must use HTTPS", { operation: "download" })
    }

    let response
    try {
      response = await fetchImpl(parsed.toString(), { method: "GET" })
    } catch {
      throw new AtlasCloudError("Atlas output download failed: network error", { operation: "download" })
    }
    const status = Number(response?.status ?? 0)
    const ok = response?.ok ?? (status >= 200 && status < 300)
    if (!ok) {
      const payload = await responsePayload(response)
      throw new AtlasCloudError(
        `Atlas output download failed (HTTP ${status || "unknown"}): ${providerMessage(payload)}`,
        { operation: "download", status },
      )
    }
    if (typeof response?.arrayBuffer !== "function") {
      throw new AtlasCloudError("Atlas output download failed: response body is not readable", { operation: "download" })
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    const contentType = typeof response?.headers?.get === "function"
      ? response.headers.get("content-type")
      : null
    return { bytes, contentType: contentType || null, sizeBytes: bytes.length }
  }

  return {
    calculate: (body) => request("calculate", "/api/v1/model/calculate", {
      method: "POST",
      jsonBody: body,
      retries: 2,
    }),
    uploadMedia: (formData) => request("uploadMedia", "/api/v1/model/uploadMedia", {
      method: "POST",
      formData,
    }),
    generateImage: (body) => request("generateImage", "/api/v1/model/generateImage", {
      method: "POST",
      jsonBody: body,
    }),
    generateVideo: (body) => request("generateVideo", "/api/v1/model/generateVideo", {
      method: "POST",
      jsonBody: body,
    }),
    prediction: (predictionId) => request(
      "prediction",
      `/api/v1/model/prediction/${encodeURIComponent(predictionId)}`,
      { retries: 2 },
    ),
    download,
  }
}

export { DEFAULT_BASE_URL }
