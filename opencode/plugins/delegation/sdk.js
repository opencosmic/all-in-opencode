export function sdkData(result, operation) {
  if (result && typeof result === "object" && "error" in result && result.error) {
    const message = result.error?.data?.message ?? result.error?.message ?? JSON.stringify(result.error)
    throw new Error(`${operation} failed: ${message}`)
  }
  if (result && typeof result === "object" && "data" in result) return result.data
  return result
}

export function parseModel(reference) {
  if (!reference) return undefined
  const separator = reference.indexOf("/")
  if (separator < 1 || separator === reference.length - 1) {
    throw new Error(`model must use provider/model form: ${reference}`)
  }
  return {
    providerID: reference.slice(0, separator),
    modelID: reference.slice(separator + 1),
  }
}

export function sessionStatusFor(result, sessionID) {
  const statuses = sdkData(result, "session.status") ?? {}
  return statuses[sessionID] ?? { type: "unknown" }
}
