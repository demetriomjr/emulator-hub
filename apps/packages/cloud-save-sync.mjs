export function createCloudSaveSynchronizer({ load, upload, hash, logger = () => {} }) {
  let remote = null
  let lastHash = null
  let revision = null

  return {
    getRevision() { return revision ?? 0 },
    async load() {
      try {
        remote = await load()
        if (remote) {
          revision = remote.revision
          lastHash = await hash(remote.bytes)
          logger('save.front.load-accepted', { traceId: remote.traceId ?? null, sizeBytes: remote.bytes.byteLength, revision })
        } else {
          logger('save.front.load-missing', {})
        }
        return remote
      } catch (error) {
        logger('save.front.load-failed', { error: error?.message ?? String(error), status: error?.status ?? null, code: error?.code ?? null })
        throw error
      }
    },
    async restore(gameManager) {
      if (!remote) return false
      const context = { traceId: remote.traceId ?? null, sizeBytes: remote.bytes.byteLength, revision: remote.revision }
      logger('save.front.restore-started', context)
      let stage = 'write-file'
      try {
        gameManager.FS.writeFile(gameManager.getSaveFilePath(), remote.bytes)
        stage = 'reload-save-files'
        gameManager.loadSaveFiles()
        logger('save.front.restore-completed', context)
        return true
      } catch (error) {
        logger('save.front.restore-failed', { ...context, stage, error: error?.message ?? String(error) })
        throw error
      }
    },
    async sync(gameManager) {
      const bytes = gameManager.getSaveFile()
      if (!bytes) return false
      return this.syncBytes(bytes)
    },
    async syncBytes(bytes, traceId = null) {
      const sizeBytes = bytes?.byteLength ?? 0
      if (!bytes || sizeBytes === 0) {
        logger('save.front.sync-skipped', { traceId, reason: 'empty-payload', sizeBytes })
        return false
      }
      logger('save.front.sync-started', { traceId, sizeBytes, expectedRevision: revision })
      let stage = 'hash'
      try {
        const nextHash = await hash(bytes)
        logger('save.front.bytes-hashed', { traceId, sizeBytes, sha256: nextHash })
        if (nextHash === lastHash) {
          logger('save.front.deduplicated', { traceId, sizeBytes, sha256: nextHash, revision })
          return false
        }
        stage = 'put'
        logger('save.front.put-started', { traceId, sizeBytes, sha256: nextHash, expectedRevision: revision })
        const accepted = await upload(bytes, revision, traceId)
        revision = accepted.revision
        lastHash = nextHash
        logger('save.front.upload-accepted', { traceId, sizeBytes, sha256: nextHash, revision })
        return true
      } catch (error) {
        logger('save.front.sync-failed', { traceId, stage, sizeBytes, expectedRevision: revision, error: error?.message ?? String(error), code: error?.code ?? null, status: error?.status ?? null })
        throw error
      }
    },
  }
}
