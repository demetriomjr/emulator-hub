const cacheDurationMs = 24 * 60 * 60 * 1000

export function createGameMetadataLoader(fetchData = fetch) {
  const cache = new Map()

  async function cached(key, url, headers = {}) {
    const existing = cache.get(key)
    if (existing && existing.expires > Date.now()) return existing.value

    const value = fetchData(url, { headers, signal: AbortSignal.timeout(6000) })
      .then(async response => {
        if (!response.ok) throw new Error(`Metadata API returned ${response.status}`)
        return response.json()
      })
      .catch(() => null)

    cache.set(key, { value, expires: Date.now() + cacheDurationMs })
    return value
  }

  return async function loadGameMetadata(entry) {
    if (!entry.pokeapiVersion && !entry.wikipediaPage) return null

    const version = entry.pokeapiVersion && /^[a-z0-9-]+$/.test(entry.pokeapiVersion)
      ? cached(`pokeapi:${entry.pokeapiVersion}`, `https://pokeapi.co/api/v2/version/${entry.pokeapiVersion}/`)
      : null
    const page = entry.wikipediaPage && /^[\p{L}\p{N}_-]+$/u.test(entry.wikipediaPage)
      ? cached(`wikipedia:${entry.wikipediaPage}`, `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entry.wikipediaPage)}`, { 'User-Agent': 'EmulatorHub/0.1 (local development)' })
      : null

    const [versionData, pageData] = await Promise.all([version, page])
    const name = versionData?.names?.find(item => item.language?.name === 'en')?.name
    const image = pageData?.thumbnail?.source
    let coverUrl
    try {
      const url = new URL(image)
      if (url.protocol === 'https:' && url.hostname === 'upload.wikimedia.org') coverUrl = url.href
    } catch {}

    return {
      ...(typeof name === 'string' && name ? { versionName: name } : {}),
      ...(coverUrl ? { coverUrl } : {}),
    }
  }
}
