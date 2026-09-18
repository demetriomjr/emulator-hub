import { materializePokemonHubSave } from './pokemon-hub-save-materializer.mjs'

export function createPokemonHubSaveFlushService({ coordinator, saveStore, resolveSaveSource, materialize = materializePokemonHubSave, now = () => Date.now(), schedule = setTimeout, cancel = clearTimeout, flushDelayMs = 5_000, onError = console.error } = {}) {
  if (!coordinator || typeof coordinator.getSaveFlushPlan !== 'function' || typeof coordinator.markSaveFlushed !== 'function') throw new TypeError('Pokemon Hub snapshot coordinator is invalid')
  if (!saveStore || typeof saveStore.get !== 'function' || typeof saveStore.put !== 'function') throw new TypeError('Pokemon Hub save store is invalid')
  if (typeof resolveSaveSource !== 'function' || typeof materialize !== 'function' || typeof now !== 'function' || typeof schedule !== 'function' || typeof cancel !== 'function' || !Number.isInteger(flushDelayMs) || flushDelayMs < 1) throw new TypeError('Pokemon Hub save flush configuration is invalid')

  const dirty = new Map()

  const api = {
    markDirty({ profileId, sourceKey }) {
      const key = dirtyKey(profileId, sourceKey)
      const existing = dirty.get(key)
      const job = existing ? { ...existing, generation: existing.generation + 1 } : { profileId, sourceKey, dueAt: now() + flushDelayMs, generation: 1, timer: null }
      dirty.set(key, job)
      ensureSchedule(job)
    },

    async flushDue() {
      const due = [...dirty.values()].filter(job => job.dueAt <= now())
      await Promise.all(due.map(job => flush(job)))
    },

    async flushSource({ profileId, sourceKey }) {
      const key = dirtyKey(profileId, sourceKey)
      const job = dirty.get(key)
      if (!job) {
        try {
          const plan = await coordinator.getSaveFlushPlan({ profileId, sourceKey })
          if (plan.source.needsSaveFlush === false) return { status: 'clean' }
          return flush({ profileId, sourceKey, generation: 0, timer: null, recovery: true })
        } catch (error) {
          safeError(error, { profileId, sourceKey })
          return { status: 'failed', code: error.code ?? 'SAVE_FLUSH_FAILED' }
        }
      }
      return flush(job)
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

    isDirty({ profileId, sourceKey }) { return dirty.has(dirtyKey(profileId, sourceKey)) },

    dispose() {
      for (const job of dirty.values()) if (job.timer !== null) cancel(job.timer)
    },
  }
  return api

  function ensureSchedule(job) {
    if (job.timer !== null) return
    const timer = schedule(() => {
      const current = dirty.get(dirtyKey(job.profileId, job.sourceKey))
      if (current) current.timer = null
      void flushDueSafely()
    }, Math.max(0, job.dueAt - now()))
    timer?.unref?.()
    job.timer = timer
  }

  async function flushDueSafely() {
    try { await api.flushDue() } catch (error) { safeError(error, null) }
  }

  async function flush(job) {
    const key = dirtyKey(job.profileId, job.sourceKey)
    const current = dirty.get(key)
    if (!job.recovery && (!current || current.generation !== job.generation)) return { status: 'superseded' }
    try {
      const target = await resolveSaveSource({ profileId: job.profileId, sourceKey: job.sourceKey })
      if (!target) {
        clearJobIfCurrent(job)
        return { status: 'not-a-save-source' }
      }
      const [plan, stored] = await Promise.all([
        coordinator.getSaveFlushPlan({ profileId: job.profileId, sourceKey: job.sourceKey }),
        saveStore.get(job.profileId, target.gameId),
      ])
      if (!stored) throw flushError('SAVE_MISSING', 'Pokemon Hub save is missing during flush.')
      const materialized = materialize({ adapter: target.adapter, layout: target.layout, bytes: stored.bytes, source: plan.source, records: plan.records })
      let saveRevision = stored.revision
      if (materialized.changed) {
        const saved = await saveStore.put(job.profileId, target.gameId, materialized.bytes, stored.revision)
        saveRevision = saved.revision
      }
      await coordinator.markSaveFlushed({ profileId: job.profileId, sourceKey: job.sourceKey, saveRevision })
      clearJobIfCurrent(job)
      return { status: materialized.changed ? 'flushed' : 'unchanged' }
    } catch (error) {
      safeError(error, job)
      return { status: 'failed', code: error.code ?? 'SAVE_FLUSH_FAILED' }
    }
  }

  function clearJobIfCurrent(job) {
    const key = dirtyKey(job.profileId, job.sourceKey)
    const current = dirty.get(key)
    if (!current || current.generation !== job.generation) return
    if (current.timer !== null) cancel(current.timer)
    dirty.delete(key)
  }
  function safeError(error, job) {
    onError('[Pokemon Hub] save flush failed', { code: error?.code ?? 'SAVE_FLUSH_FAILED', ...(job ? { profileId: job.profileId, sourceKey: job.sourceKey } : {}) })
  }
}

function dirtyKey(profileId, sourceKey) { return `${profileId}\u0000${sourceKey}` }
function flushError(code, message) { const error = new Error(message); error.code = code; return error }
