const retryDelayMs = 800

export async function validateSaveWithRetry(initialBytes, { validate, readCurrent, wait, onAttempt = () => {} }) {
  if (typeof validate !== 'function' || typeof readCurrent !== 'function' || typeof wait !== 'function') throw new TypeError('Save validation retry dependencies are required.')

  let bytes = initialBytes
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let validation = null
    let error = null
    try {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('Save bytes are unavailable.')
      validation = validate(bytes)
    } catch (caught) {
      error = caught
    }

    await onAttempt({ attempt, bytes, valid: error === null, validation, error })
    if (error === null) return { bytes, validation, attempt }
    if (attempt === 1) {
      await wait(retryDelayMs)
      bytes = await readCurrent()
    }
  }
  return null
}
