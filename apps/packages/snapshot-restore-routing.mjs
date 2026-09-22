export function createRestoreRequest({ requestId, kind, gameId, profileId, sessionId }) {
  if (![requestId, kind, gameId, profileId, sessionId].every(value => typeof value === 'string' && value.length > 0)) throw new TypeError('Restore request identity is invalid.')
  return { type: 'emulator-hub:snapshot-restore-request', requestId, kind, gameId, profileId, sessionId }
}

export function resolveRestoreRequest(pending, message) {
  if (!(pending instanceof Map) || typeof message?.requestId !== 'string' || typeof message.restore !== 'boolean') return null
  const request = pending.get(message.requestId)
  if (!request) return null
  if (request.sessionId && message.sessionId !== request.sessionId) return null
  if (request.gameId && message.gameId !== request.gameId) return null
  if (request.profileId && message.profileId !== request.profileId) return null
  pending.delete(message.requestId)
  return { ...request, restore: message.restore }
}
