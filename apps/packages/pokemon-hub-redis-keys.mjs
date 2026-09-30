// Sources have their own identity; the fixed hash tag permits atomic cross-source writes.
const prefix = 'pokemon-hub:v3:{pokemon-hub}'
const key = (kind, ...parts) => prefix + ':' + kind + ':' + parts.map(part => encodePokemonHubRedisKeyPart(part, kind)).join(':')
export const pokemonHubRedisKeys = Object.freeze({
  session: sessionId => key('session', sessionId),
  sessionOperation: (sessionId, operationId) => key('session-operation', sessionId, operationId),
  sessionTerminal: (sessionId, closeKey) => key('session-terminal', sessionId, closeKey),
  sessionHistory: sessionId => key('session-history', sessionId),
  sessionHistoryPrefix: () => prefix + ':session-history:',
  sessionHistoryIndex: () => prefix + ':session-history-index',
  source: sourceKey => key('source', sourceKey),
  record: pokemonInstanceId => key('record', pokemonInstanceId),
  lease: sourceKey => key('lease', sourceKey),
  workspaceLease: sessionId => key('workspace-lease', sessionId),
  snapshotSync: (sessionId, operationId) => key('snapshot-sync', sessionId, operationId),
  event: (pokemonInstanceId, eventId) => key('event', pokemonInstanceId, eventId),
  eventPrefix: pokemonInstanceId => key('event', pokemonInstanceId) + ':',
  expiringSessionIndex: () => prefix + ':expiring-session',
  expiringLeaseIndex: () => prefix + ':expiring-lease',
})
export function encodePokemonHubRedisKeyPart(value, label = 'Key component') {
  if (typeof value === 'number' && Number.isFinite(value)) return encodeURIComponent(String(value))
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(label + ' is required')
  return encodeURIComponent(value)
}
