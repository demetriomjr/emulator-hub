const keyspacePrefix = 'pokemon-hub:v2'

export const pokemonHubRedisKeys = Object.freeze({
  session: (profileId, sessionId) => profileKey(profileId, 'session', sessionId, 'Session ID'),
  sessionOperation: (profileId, sessionId, operationId) => profileKey(profileId, 'session-operation', sessionId, 'Session ID', operationId, 'Operation ID'),
  sessionTerminal: (profileId, closeKey) => profileKey(profileId, 'session-terminal', closeKey, 'Close key'),
  sessionOutbox: (profileId, outboxId) => profileKey(profileId, 'session-outbox', outboxId, 'Outbox ID'),
  source: (profileId, sourceKey) => profileKey(profileId, 'source', sourceKey, 'Source key'),
  sourceCloseClaim: (profileId, sourceKey) => profileKey(profileId, 'source-close-claim', sourceKey, 'Source key'),
  record: (profileId, pokemonInstanceId) => profileKey(profileId, 'record', pokemonInstanceId, 'Pokemon instance ID'),
  lease: (profileId, sourceKey) => profileKey(profileId, 'lease', sourceKey, 'Source key'),
  workspaceLease: (profileId, workspaceId) => profileKey(profileId, 'workspace-lease', workspaceId, 'Workspace ID'),
  snapshotSync: (profileId, workspaceId, idempotencyKey) => profileKey(profileId, 'snapshot-sync', workspaceId, 'Workspace ID', idempotencyKey, 'Idempotency key'),
  event: (profileId, pokemonInstanceId, eventId) => profileKey(profileId, 'event', pokemonInstanceId, 'Pokemon instance ID', eventId, 'Event ID'),
  eventPrefix: (profileId, pokemonInstanceId) => `${profileTag(profileId)}:event:${encodePokemonHubRedisKeyPart(pokemonInstanceId, 'Pokemon instance ID')}:`,
  eventOutbox: (profileId, eventId) => profileKey(profileId, 'event-outbox', eventId, 'Event ID'),
  migrationMarker: profileId => `${profileTag(profileId)}:migration-marker`,
  expiringSessionIndex: () => `${keyspacePrefix}:expiring-session`,
  expiringLeaseIndex: () => `${keyspacePrefix}:expiring-lease`,
})

export function profileHashTag(profileId) {
  assertComponent(profileId, 'Profile ID')
  return `{ph:${encodeURIComponent(profileId)}}`
}

export function encodePokemonHubRedisKeyPart(value, label = 'Key component') {
  if (typeof value === 'number' && Number.isFinite(value)) return encodeURIComponent(String(value))
  assertComponent(value, label)
  return encodeURIComponent(value)
}

export function taggedProfileKey(profileId, kind, ...parts) {
  assertComponent(kind, 'Key kind')
  return [profileHashTag(profileId), encodePokemonHubRedisKeyPart(kind, 'Key kind'), ...parts.map(([value, label]) => encodePokemonHubRedisKeyPart(value, label))].join(':').replace(/^\{ph:/, `${keyspacePrefix}:{ph:`)
}

function profileKey(profileId, kind, firstValue, firstLabel, secondValue, secondLabel) {
  const parts = [[firstValue, firstLabel]]
  if (secondValue !== undefined) parts.push([secondValue, secondLabel])
  return taggedProfileKey(profileId, kind, ...parts)
}

function profileTag(profileId) {
  return `${keyspacePrefix}:${profileHashTag(profileId)}`
}

function assertComponent(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`)
}
