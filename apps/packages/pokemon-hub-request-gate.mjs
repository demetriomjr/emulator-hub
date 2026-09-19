export function createPokemonHubRequestGate() {
  let tail = Promise.resolve()
  let pending = 0

  return {
    run(request) {
      if (typeof request !== 'function') throw new TypeError('Pokemon Hub session request must be a function')
      pending += 1
      const promise = tail.then(request, request)
      tail = promise.catch(() => {})
      void promise.finally(() => { pending -= 1 }).catch(() => {})
      return promise
    },

    async waitForIdle() {
      while (pending > 0) await tail
      return true
    },

    isInFlight() { return pending > 0 },
  }
}
