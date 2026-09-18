export function createPokemonHubRequestGate() {
  const active = new Set()

  return {
    run(request) {
      if (typeof request !== 'function') throw new TypeError('Pokemon Hub session request must be a function')
      const promise = Promise.resolve().then(request)
      active.add(promise)
      void promise.finally(() => active.delete(promise)).catch(() => {})
      return promise
    },

    async waitForIdle() {
      while (active.size > 0) await Promise.allSettled([...active])
      return true
    },

    isInFlight() { return active.size > 0 },
  }
}
