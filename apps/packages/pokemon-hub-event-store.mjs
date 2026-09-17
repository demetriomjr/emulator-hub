import { createHash } from 'node:crypto'

const eventTypes = new Set([
  'pokemon.observed',
  'pokemon.placement-changed',
  'pokemon.projection-applied',
  'pokemon.reconciliation-required',
])

const forbiddenFields = new Set([
  'bytes',
  'bytesBase64',
  'canonical',
  'display',
  'fieldLedger',
  'history',
  'nativeIdentity',
  'representations',
])

export function createPokemonHubEventStore({ persistence, now = () => new Date() }) {
  if (!persistence || typeof persistence.get !== 'function' || typeof persistence.set !== 'function' || typeof persistence.keys !== 'function') {
    throw new TypeError('Pokemon Hub event persistence is invalid')
  }

  return {
    async append(input) {
      const event = normalizeEvent(input, now)
      const eventId = eventIdentifier(event.profileId, event.pokemonInstanceId, event.operationId)
      const key = eventKey(event.profileId, event.pokemonInstanceId, eventId)
      const existing = await persistence.get(key)
      if (existing !== null) return copy(parseEvent(existing))

      const created = { schemaVersion: 1, eventId, ...event }
      const saved = await persistence.set(key, JSON.stringify(created), { NX: true })
      if (saved !== null) return copy(created)

      const raced = await persistence.get(key)
      if (raced === null) throw new Error('Pokemon Hub event could not be stored')
      return copy(parseEvent(raced))
    },
    async listForPokemon(profileId, pokemonInstanceId) {
      assertNonEmptyString(profileId, 'Profile ID')
      assertNonEmptyString(pokemonInstanceId, 'Pokemon instance ID')
      const keys = await persistence.keys(`${eventPrefix(profileId, pokemonInstanceId)}`)
      const events = await Promise.all(keys.map(async key => {
        const source = await persistence.get(key)
        return source === null ? null : parseEvent(source)
      }))
      return events.filter(Boolean).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId)).map(copy)
    },
  }
}

function normalizeEvent(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Pokemon Hub event is invalid')
  for (const field of forbiddenFields) if (Object.hasOwn(input, field)) throw new TypeError(`Pokemon Hub event field ${field} is not allowed`)
  assertNonEmptyString(input.profileId, 'Profile ID')
  assertNonEmptyString(input.pokemonInstanceId, 'Pokemon instance ID')
  assertNonEmptyString(input.operationId, 'Operation ID')
  if (!eventTypes.has(input.type)) throw new TypeError('Pokemon Hub event type is invalid')

  const occurredAt = input.occurredAt ?? now().toISOString()
  if (typeof occurredAt !== 'string' || !Number.isFinite(Date.parse(occurredAt))) throw new TypeError('Pokemon Hub event timestamp is invalid')
  const requiresDestination = input.type === 'pokemon.placement-changed' || input.type === 'pokemon.projection-applied'

  return {
    profileId: input.profileId,
    pokemonInstanceId: input.pokemonInstanceId,
    operationId: input.operationId,
    type: input.type,
    occurredAt,
    source: normalizeEndpoint(input.source, 'Source', true),
    destination: normalizeEndpoint(input.destination, 'Destination', requiresDestination),
    sourceRevision: nonNegativeInteger(input.sourceRevision, 'Source revision'),
    destinationRevision: optionalNonNegativeInteger(input.destinationRevision, 'Destination revision', requiresDestination),
    adapter: normalizeAdapter(input.adapter, requiresDestination),
    representationHashes: normalizeHashes(input.representationHashes, requiresDestination),
  }
}

function parseEvent(source) {
  try {
    const event = JSON.parse(source)
    if (!event || event.schemaVersion !== 1 || typeof event.eventId !== 'string') throw new Error('Invalid event')
    const normalized = normalizeEvent(event, () => new Date(event.occurredAt))
    return { schemaVersion: 1, eventId: event.eventId, ...normalized }
  } catch {
    throw new Error('Pokemon Hub event storage is invalid')
  }
}

function normalizeEndpoint(value, label, required) {
  if (value === undefined || value === null) {
    if (required) throw new TypeError(`${label} endpoint is invalid`)
    return null
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} endpoint is invalid`)
  assertNonEmptyString(value.sourceKey, `${label} source key`)
  if (!value.location || typeof value.location !== 'object' || Array.isArray(value.location)) throw new TypeError(`${label} location is invalid`)
  return { sourceKey: value.sourceKey, location: structuredClone(value.location) }
}

function normalizeAdapter(value, requiresDestination) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Event adapter metadata is invalid')
  assertNonEmptyString(value.source, 'Source adapter')
  assertNonEmptyString(value.capabilityVersion, 'Capability version')
  if ((value.destination === undefined || value.destination === null) && !requiresDestination) return { source: value.source, destination: null, capabilityVersion: value.capabilityVersion }
  assertNonEmptyString(value.destination, 'Destination adapter')
  return { source: value.source, destination: value.destination, capabilityVersion: value.capabilityVersion }
}

function normalizeHashes(value, requiresDestination) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Representation hashes are invalid')
  if (!isHash(value.source)) throw new TypeError('Representation hash is invalid')
  if ((value.destination === undefined || value.destination === null) && !requiresDestination) return { source: value.source, destination: null }
  if (!isHash(value.destination)) throw new TypeError('Representation hash is invalid')
  return { source: value.source, destination: value.destination }
}

function eventIdentifier(profileId, pokemonInstanceId, operationId) {
  return createHash('sha256').update(JSON.stringify([profileId, pokemonInstanceId, operationId])).digest('hex')
}

function eventPrefix(profileId, pokemonInstanceId) {
  return `pokemon-hub:event:${encodeURIComponent(profileId)}:${encodeURIComponent(pokemonInstanceId)}:`
}

function eventKey(profileId, pokemonInstanceId, eventId) {
  return `${eventPrefix(profileId, pokemonInstanceId)}${eventId}`
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`)
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`)
  return value
}

function optionalNonNegativeInteger(value, label, required) {
  if (value === undefined || value === null) {
    if (required) throw new TypeError(`${label} must be a non-negative integer`)
    return null
  }
  return nonNegativeInteger(value, label)
}

function isHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

function copy(value) { return structuredClone(value) }
