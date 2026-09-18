export function createPokemonHubSnapshotFlight({ capture, send, onAccepted, onCorrection, onFailure, newId = () => globalThis.crypto.randomUUID() } = {}) {
  if (typeof capture !== 'function' || typeof send !== 'function' || typeof onAccepted !== 'function' || typeof onCorrection !== 'function' || typeof onFailure !== 'function' || typeof newId !== 'function') {
    throw new TypeError('Pokemon Hub snapshot flight configuration is invalid')
  }

  let dirty = false
  let inFlight = null
  let failedRequest = null

  const api = {
    markDirty() {
      dirty = true
      return true
    },

    async flush() {
      if (inFlight) return inFlight.promise
      if (failedRequest) return false
      if (!dirty) return true

      dirty = false
      const request = { snapshot: structuredClone(capture()), idempotencyKey: newId() }
      const promise = execute(request)
      inFlight = { ...request, promise }
      return promise
    },

    async retryFailed() {
      if (inFlight) return inFlight.promise
      if (!failedRequest) return false
      const request = failedRequest
      failedRequest = null
      const promise = execute(request)
      inFlight = { ...request, promise }
      return promise
    },

    async drain() {
      while (inFlight || dirty) {
        const completed = inFlight ? await inFlight.promise : await api.flush()
        if (!completed) return false
      }
      return true
    },

    isDirty() { return dirty },
    isInFlight() { return inFlight !== null },
    currentRequest() { return inFlight ? { snapshot: structuredClone(inFlight.snapshot), idempotencyKey: inFlight.idempotencyKey } : null },
  }

  return api

  async function execute(request) {
    try {
      const correction = await send(request)
      if (correction) {
        dirty = false
        failedRequest = null
        await onCorrection(correction)
      } else {
        failedRequest = null
        await onAccepted(request.snapshot)
      }
      return true
    } catch (error) {
      dirty = false
      failedRequest = request
      await onFailure(error)
      return false
    } finally {
      if (inFlight?.idempotencyKey === request.idempotencyKey) inFlight = null
      if (dirty && !failedRequest) void api.flush()
    }
  }
}
