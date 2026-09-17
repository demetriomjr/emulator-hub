async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

export async function getGames() {
  const body = await getJson('/api/games')
  if (!Array.isArray(body.games)) throw new Error('Invalid catalog response')
  return body.games
}

export async function getProfiles() {
  const body = await getJson('/api/profiles')
  if (!Array.isArray(body.profiles)) throw new Error('Invalid profile response')
  return body.profiles
}

export async function createProfile(name) {
  const response = await fetch('/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

export async function deleteProfile(id) {
  const response = await fetch(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

export async function updateProfile(id, name) {
  const response = await fetch(`/api/profiles/${encodeURIComponent(id)}`, {
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
