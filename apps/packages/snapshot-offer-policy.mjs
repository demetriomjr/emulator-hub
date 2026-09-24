export function createSnapshotOfferPolicy({ now = () => Date.now(), closeWindowMs = 10_000, suppressedLaunchSaveRevision = null } = {}) {
  let inputSequence = 0
  let manualSaveSequence = 0
  let saveUncertaintySequence = 0
  let latestCheckpoint = null
  let suppressedRevision = validRevision(suppressedLaunchSaveRevision) ? suppressedLaunchSaveRevision : null
  let runtimeRestored = false
  const pending = new WeakSet()

  return {
    recordInput() {
      inputSequence += 1
      suppressedRevision = null
    },
    beginLiveSave() {
      const token = { observedAt: now(), inputSequence, manualSaveSequence, saveUncertaintySequence }
      pending.add(token)
      return token
    },
    confirmLiveSave(token, revision) {
      if (!pending.delete(token) || !validRevision(revision)) return false
      if (latestCheckpoint && (revision < latestCheckpoint.revision || (revision === latestCheckpoint.revision && token.observedAt < latestCheckpoint.observedAt))) return false
      latestCheckpoint = { observedAt: token.observedAt, inputSequence: token.inputSequence, manualSaveSequence: token.manualSaveSequence, saveUncertaintySequence: token.saveUncertaintySequence, revision }
      suppressedRevision = null
      return true
    },
    recordManualStateSave() {
      manualSaveSequence += 1
      suppressedRevision = null
    },
    recordSaveUncertainty() {
      saveUncertaintySequence += 1
      suppressedRevision = null
    },
    recordRuntimeRestore() {
      runtimeRestored = true
      suppressedRevision = null
    },
    shouldCapturePeriodic() { return suppressedRevision === null },
    shouldPromptAtClose(revision) {
      if (!validRevision(revision) || runtimeRestored) return true
      if (suppressedRevision === revision) return false
      if (!latestCheckpoint || latestCheckpoint.revision !== revision || latestCheckpoint.inputSequence !== inputSequence || latestCheckpoint.manualSaveSequence !== manualSaveSequence || latestCheckpoint.saveUncertaintySequence !== saveUncertaintySequence) return true
      const elapsed = now() - latestCheckpoint.observedAt
      return !Number.isFinite(elapsed) || elapsed < 0 || elapsed > closeWindowMs
    },
  }
}

function validRevision(value) { return Number.isInteger(value) && value >= 0 }
