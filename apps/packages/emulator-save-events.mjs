export function observeEmulatorSaveFiles(emulator, onSaveFile) {
  if (!emulator || typeof emulator.on !== 'function' || typeof onSaveFile !== 'function') return false
  emulator.on('saveSaveFiles', bytes => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return
    const copy = new Uint8Array(bytes)
    return Promise.resolve().then(() => onSaveFile(copy)).catch(() => {})
  })
  return true
}
