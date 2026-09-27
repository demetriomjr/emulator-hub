export function createPokemonGen3EventBatchDelivery({ backupService, saveStore, profileStore, eventDeliveryService } = {}) {
  if (typeof backupService?.create !== 'function' || typeof saveStore?.listAll !== 'function' || typeof profileStore?.get !== 'function' || typeof eventDeliveryService?.attempt !== 'function') {
    throw new TypeError('Gen III event batch dependencies are invalid.')
  }
  let running = false
  return { run }

  async function run() {
    if (running) {
      const error = new Error('A Gen III event batch is already running.')
      error.code = 'EVENT_BATCH_RUNNING'
      throw error
    }
    running = true
    try {
      const backup = await backupService.create('gen3-event-delivery')
      const saves = await saveStore.listAll()
      const results = []
      for (const { profileId, gameId } of saves) {
        try {
          const profile = await profileStore.get(gameId, profileId)
          if (!profile) {
            results.push({ profileId, gameId, status: 'profile-missing' })
            continue
          }
          const outcome = await eventDeliveryService.attempt({ profileId, gameId })
          results.push({ profileId, gameId, status: outcome.status, ...(outcome.reason ? { reason: outcome.reason } : {}), ...(outcome.code ? { code: outcome.code } : {}), ...(outcome.revision ? { revision: outcome.revision } : {}) })
        } catch (error) {
          results.push({ profileId, gameId, status: 'skipped', code: error.code ?? 'EVENT_DELIVERY_FAILED' })
        }
      }
      const counts = { scanned: results.length }
      for (const { status } of results) counts[status] = (counts[status] ?? 0) + 1
      return { backup, counts, results }
    } finally {
      running = false
    }
  }
}
