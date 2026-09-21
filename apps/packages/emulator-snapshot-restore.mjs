export function restoreSnapshotState(snapshot, gameManager, confirmRestore) {
  if (!(snapshot?.state instanceof Uint8Array) || !gameManager || typeof gameManager.loadState !== 'function' || typeof confirmRestore !== 'function') return false
  if (confirmRestore() !== true) return false
  gameManager.loadState(new Uint8Array(snapshot.state))
  return true
}
