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

export async function getSaveProfileLayout(gameId, profileId) {
  const body = await getJson(`/api/pokemon-hub/save-profiles/${encodeURIComponent(gameId)}/${encodeURIComponent(profileId)}/layout`)
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

export async function getCloudSave(url) {
  const response = await fetch(url, { cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Save request failed (${response.status})`)
  const revision = /^"(\d+)"$/.exec(response.headers.get('etag') ?? '')?.[1]
  if (!revision) throw new Error('Save response is missing a revision.')
  return { bytes: new Uint8Array(await response.arrayBuffer()), revision: Number(revision) }
}

export async function putCloudSave(url, bytes, revision) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'If-Match': revision === null ? '*' : `"${revision}"` },
    body: bytes,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Save upload failed (${response.status})`)
  return body
}
