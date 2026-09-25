import { materializePokemonHubSave } from './pokemon-hub-save-materializer.mjs'

export function createPokemonHubSaveFlushService({ coordinator, saveStore, resolveSaveSource, materialize = materializePokemonHubSave, onError = console.error } = {}) {
  if (!coordinator || typeof coordinator.getSaveFlushPlan !== 'function' || typeof coordinator.markSaveFlushed !== 'function') throw new TypeError('Pokemon Hub snapshot coordinator is invalid')
  if (!saveStore || typeof saveStore.get !== 'function' || typeof saveStore.put !== 'function') throw new TypeError('Pokemon Hub save store is invalid')
  if (typeof resolveSaveSource !== 'function' || typeof materialize !== 'function') throw new TypeError('Pokemon Hub save flush configuration is invalid')
  const loggedFailures = new Map()

  const api = {
    markDirty() {},

    async flushDue() {},

    async flushSource({ profileId, sourceKey, generation }) {
      try {
        const plan = await coordinator.getSaveFlushPlan({ profileId, sourceKey })
        if (plan.source.needsSaveFlush === false) {
          loggedFailures.delete(JSON.stringify([profileId, sourceKey]))
          return { status: 'clean' }
        }
        return flush({ profileId, sourceKey, generation }, plan)
      } catch (error) {
        safeError(error, { profileId, sourceKey })
        return { status: 'failed', code: error.code ?? 'SAVE_FLUSH_FAILED' }
      }
    },

    async flushExpiredLeases() {
      if (typeof coordinator.listExpiredLeases !== 'function' || typeof coordinator.releaseExpiredLease !== 'function') throw new TypeError('Pokemon Hub snapshot coordinator cannot release expired leases')
      const expired = await coordinator.listExpiredLeases()
      for (const lease of expired) {
        const result = await api.flushSource(lease)
        if (result.status === 'failed') continue
        await coordinator.releaseExpiredLease(lease)
      }
    },

    isDirty() { return false },

    dispose() { loggedFailures.clear() },
  }
  return api

  async function flush(job, existingPlan) {
    try {
      const target = await resolveSaveSource({ profileId: job.profileId, sourceKey: job.sourceKey })
      if (!target) return { status: 'not-a-save-source' }
      const plan = existingPlan ?? await coordinator.getSaveFlushPlan({ profileId: job.profileId, sourceKey: job.sourceKey })
      const sourceProfileId = target.sourceProfileId ?? job.profileId
      const stored = await saveStore.get(sourceProfileId, target.gameId)
      if (!stored) throw flushError('SAVE_MISSING', 'Pokemon Hub save is missing during flush.')
      let fenceGeneration = stored.fenceGeneration ?? 0
      if (job.generation !== undefined) {
        if (!Number.isInteger(job.generation) || job.generation < 1) throw flushError('SAVE_FENCE_INVALID', 'Pokemon Hub save fence generation is invalid.')
        if (typeof saveStore.advanceFence !== 'function') throw flushError('SAVE_FENCE_UNAVAILABLE', 'Pokemon Hub save store cannot install a close fence.')
        fenceGeneration = Math.max(fenceGeneration + 1, job.generation)
        await saveStore.advanceFence(sourceProfileId, target.gameId, fenceGeneration)
      }
      const materialized = materialize({
        adapter: target.adapter,
        layout: target.layout,
        bytes: stored.bytes,
        source: plan.source,
        records: plan.records,
        materializePartyRecord: typeof target.adapter.materializePartyRecord === 'function'
          ? ({ boxCore, document }) => target.adapter.materializePartyRecord({ boxCore, document, layout: target.layout })
          : null,
      })
      let saveRevision = stored.revision
      if (materialized.changed) {
        const saved = await saveStore.put(sourceProfileId, target.gameId, materialized.bytes, stored.revision, { fenceGeneration })
        saveRevision = saved.revision
      }
      await coordinator.markSaveFlushed({ profileId: job.profileId, sourceKey: job.sourceKey, sourceRevision: plan.source.sourceRevision, saveRevision })
      loggedFailures.delete(JSON.stringify([job.profileId, job.sourceKey]))
      return { status: materialized.changed ? 'flushed' : 'unchanged' }
    } catch (error) {
      safeError(error, { ...job, sourceRevision: existingPlan?.source?.sourceRevision })
      return { status: 'failed', code: error.code ?? 'SAVE_FLUSH_FAILED' }
    }
  }

  function safeError(error, job) {
    const details = {
      code: error?.code ?? 'SAVE_FLUSH_FAILED',
      message: error?.message ?? 'Pokemon Hub save flush failed.',
      ...(job ? { profileId: job.profileId, sourceKey: job.sourceKey, ...(job.sourceRevision === undefined ? {} : { sourceRevision: job.sourceRevision }) } : {}),
    }
    const key = JSON.stringify([job?.profileId, job?.sourceKey])
    const signature = JSON.stringify([details.sourceRevision, details.code, details.message])
    if (loggedFailures.get(key) === signature) return
    loggedFailures.set(key, signature)
    onError('[Pokemon Hub] save flush failed', details)
  }
}

function flushError(code, message) { const error = new Error(message); error.code = code; return error }
