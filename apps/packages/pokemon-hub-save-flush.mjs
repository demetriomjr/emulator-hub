import { materializePokemonHubSave } from './pokemon-hub-save-materializer.mjs'

export function createPokemonHubSaveFlushService({ coordinator, saveStore, snapshotStore, resolveSaveSource, materialize = materializePokemonHubSave, onError = console.error } = {}) {
  if (!coordinator || typeof coordinator.getSaveFlushPlan !== 'function' || typeof coordinator.markSaveFlushed !== 'function') throw new TypeError('Pokemon Hub snapshot coordinator is invalid')
  if (!saveStore || typeof saveStore.get !== 'function' || typeof saveStore.put !== 'function') throw new TypeError('Pokemon Hub save store is invalid')
  if (typeof resolveSaveSource !== 'function' || typeof materialize !== 'function') throw new TypeError('Pokemon Hub save flush configuration is invalid')
  const loggedFailures = new Map()

  const api = {
    async flushSource({ sourceKey, generation, state }) {
      try {
        const plan = await coordinator.getSaveFlushPlan({ sourceKey })
        if (plan.source.needsSaveFlush === false) {
          loggedFailures.delete(JSON.stringify([sourceKey]))
          return { status: 'clean' }
        }
        return flush({ sourceKey, generation }, plan)
      } catch (error) {
        if (state === 'acquiring' && error.code === 'SOURCE_NOT_ADOPTED') return { status: 'not-adopted' }
        safeError(error, { sourceKey })
        return { status: 'failed', code: error.code ?? 'SAVE_FLUSH_FAILED' }
      }
    },

    async flushExpiredLeases() {
      if (typeof coordinator.listExpiredLeases !== 'function' || typeof coordinator.releaseExpiredLease !== 'function') throw new TypeError('Pokemon Hub snapshot coordinator cannot release expired leases')
      const expired = await coordinator.listExpiredLeases()
      const groups = Map.groupBy(expired, lease => lease.workspaceId)
      for (const leases of groups.values()) {
        let failed = false
        for (const lease of leases) {
          if ((await api.flushSource(lease)).status === 'failed') failed = true
        }
        if (failed) continue
        for (const lease of leases) await coordinator.releaseExpiredLease(lease)
      }
    },

    dispose() { loggedFailures.clear() },
  }
  return api

  async function flush(job, existingPlan) {
    try {
      const target = await resolveSaveSource({ sourceKey: job.sourceKey })
      if (!target) return { status: 'not-a-save-source' }
      const plan = existingPlan ?? await coordinator.getSaveFlushPlan({ sourceKey: job.sourceKey })
      const sourceProfileId = target.sourceProfileId ?? /^save:([^:]+):/.exec(job.sourceKey)?.[1]
      const stored = await saveStore.get(sourceProfileId, target.gameId)
      if (!stored) throw flushError('SAVE_MISSING', 'Pokemon Hub save is missing during flush.')
      let fenceGeneration = stored.fenceGeneration ?? 0
      if (job.generation !== undefined) {
        if (!Number.isInteger(job.generation) || job.generation < 1) throw flushError('SAVE_FENCE_INVALID', 'Pokemon Hub save fence generation is invalid.')
        if (typeof saveStore.advanceFence !== 'function') throw flushError('SAVE_FENCE_UNAVAILABLE', 'Pokemon Hub save store cannot install a close fence.')
        fenceGeneration = Math.max(fenceGeneration + 1, job.generation)
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
      if (plan.source.saveRevision !== undefined && plan.source.saveRevision !== stored.revision && materialized.changed) {
        throw flushError('SAVE_REVISION_CONFLICT', 'The physical save changed after this source was adopted; refusing to overwrite it.')
      }
      if (job.generation !== undefined) {
        await saveStore.advanceFence(sourceProfileId, target.gameId, fenceGeneration)
      }
      if (materialized.changed) {
        const saved = await saveStore.put(sourceProfileId, target.gameId, materialized.bytes, stored.revision, { fenceGeneration, invalidateRuntimeStates: true })
        saveRevision = saved.revision
      }
      if (snapshotStore) {
        await snapshotStore.delete(sourceProfileId, target.gameId, { kind: 'cloud-recovery' })
      }
      await coordinator.markSaveFlushed({ sourceKey: job.sourceKey, sourceRevision: plan.source.sourceRevision, saveRevision })
      loggedFailures.delete(JSON.stringify([job.sourceKey]))
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
      ...(job ? { sourceKey: job.sourceKey, ...(job.sourceRevision === undefined ? {} : { sourceRevision: job.sourceRevision }) } : {}),
    }
    const key = JSON.stringify([job?.sourceKey])
    const signature = JSON.stringify([details.sourceRevision, details.code, details.message])
    if (loggedFailures.get(key) === signature) return
    loggedFailures.set(key, signature)
    onError('[Pokemon Hub] save flush failed', details)
  }
}

function flushError(code, message) { const error = new Error(message); error.code = code; return error }
