/**
 * Attempts every player save flush, then always releases the player UI.
 * A stopped iframe cannot keep the hub trapped behind its overlay.
 */
export async function closePlayerAfterSaveAttempts({ saveAttempts = [], close } = {}) {
  if (typeof close !== 'function') throw new TypeError('close must be a function')

  const results = await Promise.allSettled(saveAttempts)
  await close()

  return {
    failures: results
      .filter(result => result.status === 'rejected')
      .map(result => result.reason),
  }
}
