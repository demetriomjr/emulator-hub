export function createRestoreRequest({ requestId, kind, gameId, profileId }) {
  if (![requestId, kind, gameId, profileId].every(value => typeof value === 'string' && value.length > 0)) throw new TypeError('Restore request identity is invalid.')
  return { type: 'emulator-hub:snapshot-restore-request', requestId, kind, gameId, profileId }
}

export function resolveRestoreRequest(pending, message) {
  if (!(pending instanceof Map) || typeof message?.requestId !== 'string' || typeof message.restore !== 'boolean') return null
  const request = pending.get(message.requestId)
  if (!request) return null
  pending.delete(message.requestId)
  return { ...request, restore: message.restore }
}
