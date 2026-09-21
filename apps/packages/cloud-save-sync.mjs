export function createCloudSaveSynchronizer({ load, upload, hash }) {
  let remote = null
  let lastHash = null
  let revision = null

  return {
    getRevision() { return revision ?? 0 },
    async load() {
      remote = await load()
      if (remote) {
        revision = remote.revision
        lastHash = await hash(remote.bytes)
      }
      return remote
    },
    async restore(gameManager) {
      if (!remote) return false
      gameManager.FS.writeFile(gameManager.getSaveFilePath(), remote.bytes)
      gameManager.loadSaveFiles()
      return true
    },
    async sync(gameManager) {
      const bytes = gameManager.getSaveFile()
      if (!bytes) return false
      return this.syncBytes(bytes)
    },
    async syncBytes(bytes) {
      if (!bytes || bytes.byteLength === 0) return false
      const nextHash = await hash(bytes)
      if (nextHash === lastHash) return false
      const accepted = await upload(bytes, revision)
      revision = accepted.revision
      lastHash = nextHash
      return true
    },
  }
}
