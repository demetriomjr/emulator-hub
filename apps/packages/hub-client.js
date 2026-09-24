import { parseGameCatalogResponse } from './game-catalog-contract.mjs'

async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`)
    if (typeof body.code === 'string') error.code = body.code
    throw error
  }
  return body
}

export async function getGames() {
  return parseGameCatalogResponse(await getJson('/api/games'))
}

export async function getSaveProfileGames() {
  return parseGameCatalogResponse(await getJson('/api/pokemon-hub/save-profile-games'))
}

export async function getSaveProfileLayout(gameId, profileId, workspaceProfileId = null) {
  const workspace = typeof workspaceProfileId === 'string' && workspaceProfileId ? `?workspaceProfileId=${encodeURIComponent(workspaceProfileId)}` : ''
  const body = await getJson(`/api/pokemon-hub/save-profiles/${encodeURIComponent(gameId)}/${encodeURIComponent(profileId)}/layout${workspace}`)
  if (!body.layout || !Array.isArray(body.party) || !Array.isArray(body.boxes)) throw new Error('Invalid save layout response')
  return body
}

export async function getProfiles(gameId) {
  const body = await getJson(profileCollectionUrl(gameId))
  if (!Array.isArray(body.profiles)) throw new Error('Invalid profile response')
  return body.profiles
}

export async function createProfile(gameId, name) {
  const response = await fetch(profileCollectionUrl(gameId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

export async function deleteProfile(gameId, id) {
  const response = await fetch(`${profileCollectionUrl(gameId)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

export async function updateProfile(gameId, id, name) {
  const response = await fetch(`${profileCollectionUrl(gameId)}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

export function getControlProfile() {
  return getJson('/api/control-profile')
}

export async function updateControlProfile(profile) {
  const response = await fetch('/api/control-profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

export async function getLaunch(id, profileId) {
  const parameters = new URLSearchParams({ profileId })
  return getJson(`/api/games/${encodeURIComponent(id)}/launch?${parameters}`)
}

async function postJson(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(result.error || `Request failed (${response.status})`), { code: result.code })
  return result
}

export async function acquirePlayerLease(gameId, profileId, sessionId) {
  return postJson(`/api/games/${encodeURIComponent(gameId)}/player-leases`, { profileId, sessionId })
}

export async function heartbeatPlayerLease(sessionId, lease) {
  return postJson(`/api/player-leases/${encodeURIComponent(sessionId)}/heartbeat`, lease)
}

export function getPlayerLeaseLaunch(sessionId, lease) {
  const parameters = new URLSearchParams({ profileId: lease.profileId, gameId: lease.gameId, generation: String(lease.generation) })
  return getJson(`/api/player-leases/${encodeURIComponent(sessionId)}/launch?${parameters}`)
}

export async function releasePlayerLease(sessionId, lease) {
  const response = await fetch(`/api/player-leases/${encodeURIComponent(sessionId)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lease) })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status})`), { code: body.code })
  return body
}

export function getPokemonHub(profileId) {
  return getJson(`/api/profiles/${encodeURIComponent(profileId)}/pokemon-hub`)
}

export function openPokemonHubSession(profileId) {
  return postPokemonHubSession(profileId, '', {})
}

export function attachPokemonHubSessionSource(profileId, sessionId, sourceKey) {
  return postPokemonHubSession(profileId, `/${encodeURIComponent(sessionId)}/sources`, { sourceKey })
}

export function heartbeatPokemonHubSession(profileId, sessionId, sequence) {
  return postPokemonHubSession(profileId, `/${encodeURIComponent(sessionId)}/heartbeat`, { sequence })
}

export async function loadPokemonHubSessionPane(profileId, sessionId, pane, source) {
  if (!Number.isInteger(pane) || pane < 0 || pane > 2) throw new TypeError('Pokemon Hub pane is invalid')
  const response = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/pokemon-hub/sessions/${encodeURIComponent(sessionId)}/panes/${pane}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }),
  })
  const snapshot = await response.json().catch(() => ({}))
  if (response.status === 409) return { corrected: true, snapshot }
  if (!response.ok) {
    const error = new Error(snapshot.error || `Request failed (${response.status})`)
    if (typeof snapshot.code === 'string') error.code = snapshot.code
    throw error
  }
  return { corrected: false, snapshot }
}

export async function syncPokemonHubSessionSnapshot(profileId, sessionId, snapshot, idempotencyKey) {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) throw new TypeError('Pokemon Hub snapshot idempotency key is required')
  const response = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/pokemon-hub/sessions/${encodeURIComponent(sessionId)}/snapshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(snapshot),
  })
  if (response.status === 409) return response.json()
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error(body.error || `Request failed (${response.status})`)
    if (typeof body.code === 'string') error.code = body.code
    throw error
  }
  if (response.status !== 200 || await response.text() !== '') throw new Error('Invalid Pokemon Hub snapshot response')
  return null
}

export async function detachPokemonHubSessionSource(profileId, sessionId, sourceId) {
  return deletePokemonHubSession(profileId, `/${encodeURIComponent(sessionId)}/sources/${encodeURIComponent(sourceId)}`)
}

export async function closePokemonHubSession(profileId, sessionId, snapshot, idempotencyKey) {
  if (!snapshot || typeof snapshot !== 'object' || !Number.isInteger(snapshot.revision) || !Array.isArray(snapshot.panes)) throw new TypeError('Pokemon Hub close snapshot is required')
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) throw new TypeError('Pokemon Hub close idempotency key is required')
  const response = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/pokemon-hub/sessions/${encodeURIComponent(sessionId)}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(snapshot),
  })
  if (response.status === 409) {
    const body = await response.json()
    if (Number.isInteger(body?.revision) && Array.isArray(body?.panes)) return body
    const error = new Error(body?.error || 'Pokemon Hub session close conflicted')
    if (typeof body?.code === 'string') error.code = body.code
    throw error
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error(body.error || `Request failed (${response.status})`)
    if (typeof body.code === 'string') error.code = body.code
    throw error
  }
  if (response.status !== 200 || await response.text() !== '') throw new Error('Invalid Pokemon Hub close response')
  return null
}

function profileCollectionUrl(gameId) {
  return `/api/games/${encodeURIComponent(gameId)}/profiles`
}

export function getPokemonHubProfiles() {
  return getJson('/api/pokemon-hub/profiles')
}

export async function createPokemonHubProfile(profile) {
  const response = await fetch('/api/pokemon-hub/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

export async function renamePokemonHubProfile(hubProfileId, name) {
  const response = await fetch(`/api/pokemon-hub/profiles/${encodeURIComponent(hubProfileId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

export async function deletePokemonHubProfile(hubProfileId, { discardOccupied = false } = {}) {
  const parameters = new URLSearchParams({ discardOccupied: String(discardOccupied) })
  const response = await fetch(`/api/pokemon-hub/profiles/${encodeURIComponent(hubProfileId)}?${parameters}`, { method: 'DELETE' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

export async function transferPokemonHub(profileId, transfer) {
  const response = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/pokemon-hub/transfers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(transfer),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`)
    if (typeof body.code === 'string') error.code = body.code
    throw error
  }
  return body
}

export function acquirePokemonHubSnapshot(profileId, request) {
  return postPokemonHubSnapshot(profileId, 'acquire', request)
}

export function renewPokemonHubSnapshot(profileId, request) {
  return postPokemonHubSnapshot(profileId, 'renew', request)
}

export function syncPokemonHubSnapshot(profileId, request) {
  return postPokemonHubSnapshot(profileId, 'sync', request)
}

export function releasePokemonHubSnapshot(profileId, request) {
  return postPokemonHubSnapshot(profileId, 'release', request)
}

async function postPokemonHubSnapshot(profileId, operation, request) {
  const response = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/pokemon-hub/snapshots/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`)
    if (typeof body.code === 'string') error.code = body.code
    throw error
  }
  return body
}

async function postPokemonHubSession(profileId, suffix, body) {
  const response = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/pokemon-hub/sessions${suffix}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return readPokemonHubResponse(response)
}

async function deletePokemonHubSession(profileId, suffix) {
  const response = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/pokemon-hub/sessions${suffix}`, { method: 'DELETE' })
  return readPokemonHubResponse(response)
}

async function readPokemonHubResponse(response) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`)
    if (typeof body.code === 'string') error.code = body.code
    throw error
  }
  return body
}

export async function getCloudSave(url, lease, traceId = null, logger = () => {}) {
  const headers = leaseHeaders(lease)
  if (traceId) headers['X-Save-Trace-Id'] = traceId
  let response
  try {
    response = await fetch(url, { cache: 'no-store', headers })
  } catch (error) {
    logger('save.front.get-failed', { traceId, stage: 'request', error: error?.message ?? String(error) })
    throw error
  }
  if (response.status === 404) {
    logger('save.front.get-response', { traceId, status: response.status, ok: true, found: false })
    return null
  }
  if (!response.ok) {
    logger('save.front.get-response', { traceId, status: response.status, ok: false, found: null })
    throw new Error(`Save request failed (${response.status})`)
  }
  const revision = /^"(\d+)"$/.exec(response.headers.get('etag') ?? '')?.[1]
  if (!revision) {
    logger('save.front.get-failed', { traceId, stage: 'response-validation', status: response.status, error: 'Save response is missing a revision.' })
    throw new Error('Save response is missing a revision.')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  logger('save.front.get-response', { traceId, status: response.status, ok: true, found: true, sizeBytes: bytes.byteLength, revision: Number(revision) })
  return { bytes, revision: Number(revision), traceId }
}

export async function syncOddsResetCount(gameId, profileId, oddsResetCount) {
  const response = await fetch(`${profileCollectionUrl(gameId)}/${encodeURIComponent(profileId)}/odds-state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oddsResetCount }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status})`), { code: body.code })
  return body
}

export function getUserPreferences() {
  return getJson('/api/user-preferences')
}

export async function updateUserPreferences(preferences) {
  const response = await fetch('/api/user-preferences', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

export async function putCloudSave(url, bytes, revision, lease, traceId = null, logger = () => {}) {
  const headers = { 'Content-Type': 'application/octet-stream', 'If-Match': revision === null ? '*' : `"${revision}"`, ...leaseHeaders(lease) }
  if (traceId) headers['X-Save-Trace-Id'] = traceId
  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: bytes,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    logger('save.front.put-response', { traceId, status: response.status, ok: false, code: body.code ?? null })
    const error = new Error(body.error || `Save upload failed (${response.status})`)
    error.code = body.code
    error.status = response.status
    throw error
  }
  logger('save.front.put-response', { traceId, status: response.status, ok: true, revision: body.revision ?? null })
  return body
}

export async function getEmulatorSnapshot(url, lease) {
  const response = await fetch(url, { cache: 'no-store', headers: leaseHeaders(lease) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`)
  const revision = /^"(\d+)"$/.exec(response.headers.get('etag') ?? '')?.[1]
  if (!revision) throw new Error('Snapshot response is missing a revision.')
  const { decodeSnapshotBundle } = await import('./emulator-snapshot.mjs')
  const snapshot = await decodeSnapshotBundle(new Uint8Array(await response.arrayBuffer()))
  return { ...snapshot, revision: Number(revision) }
}

export async function putEmulatorSnapshot(url, bundle, revision, lease) {
  const { encodeSnapshotBundle } = await import('./emulator-snapshot.mjs')
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/vnd.emulator-hub.snapshot', 'If-Match': revision === null ? '*' : `"${revision}"`, ...leaseHeaders(lease) },
    body: await encodeSnapshotBundle(bundle),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Snapshot upload failed (${response.status})`)
  return body
}

export async function deleteEmulatorSnapshot(url, revision, lease) {
  if (!Number.isInteger(revision) || revision < 1) return false
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { 'If-Match': `"${revision}"`, ...leaseHeaders(lease) },
  })
  if (response.status === 404) return false
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error(body.error || `Snapshot deletion failed (${response.status})`)
    error.code = body.code
    error.status = response.status
    throw error
  }
  return true
}

function leaseHeaders(lease) {
  if (!lease) return {}
  return { 'X-Player-Session-Id': lease.sessionId, 'X-Player-Lease-Generation': String(lease.generation) }
}
