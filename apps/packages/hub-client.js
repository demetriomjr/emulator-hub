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
  const body = await getJson('/api/games')
  if (!Array.isArray(body.games)) throw new Error('Invalid catalog response')
  return body.games.map(game => {
    if (!Array.isArray(game.profiles) || game.profiles.some(profile => !profile || typeof profile.id !== 'string' || typeof profile.name !== 'string' || typeof profile.createdAt !== 'string')) throw new Error('Invalid catalog profile response')
    return game
  })
}

export async function getSaveProfileGames() {
  const body = await getJson('/api/pokemon-hub/save-profile-games')
  if (!Array.isArray(body.games)) throw new Error('Invalid save-profile game response')
  return body.games
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
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
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
