export async function deliverPlayerInteractionLock({ revision, send, isCurrent, wait = () => new Promise(resolve => setTimeout(resolve, 100)), maxAttempts = 3 }) {
  let lastError
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!isCurrent()) return false
    try {
      const acknowledgement = await send()
      if (acknowledgement.revision >= revision) return true
      lastError = new Error('Player acknowledged an older interaction lock.')
    } catch (error) {
      lastError = error
    }
    if (!isCurrent()) return false
    if (attempt < maxAttempts - 1) await wait()
  }
  throw lastError
}
