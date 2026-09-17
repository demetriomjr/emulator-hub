import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

const systems = new Map([
  ['.gb', { system: 'gb', core: 'gambatte' }],
  ['.gbc', { system: 'gbc', core: 'gambatte' }],
  ['.gba', { system: 'gba', core: 'gba' }],
])

export function createRomDiscovery({ lookupBatch, listDirectory = readdir, inspectPath = lstat, openStream = createReadStream, refreshLegacyMetadata = false } = {}) {
  if (typeof lookupBatch !== 'function') throw new TypeError('lookupBatch is required.')

  return {
    async scan({ romsDirectory, cachedEntries = [], legacyEntries = [] }) {
      const { candidates, rejected } = await collectCandidates(romsDirectory, listDirectory, inspectPath)
      const scanned = await Promise.all(candidates.map(candidate => fingerprint(candidate, openStream)))
      const cachedByFingerprint = new Map(cachedEntries.map(entry => [`${entry.sha1}:${entry.md5}:${entry.sha256}:${entry.size}`, entry]))
      const accepted = []
      const pending = []

      for (const candidate of scanned) {
        const legacy = legacyEntries.find(entry => clean(entry.sha256).toLowerCase() === candidate.sha256 && entry.file === candidate.file && clean(entry.system).toLowerCase() === candidate.system)
        const cached = cachedByFingerprint.get(fingerprintKey(candidate))
        if (legacy && (!refreshLegacyMetadata || cached?.coverUrl)) accepted.push(mergeEntry({ ...candidate, title: clean(legacy.title), region: clean(legacy.region) || 'legacy' }, cached, legacyEntries))
        else if (!legacy && cached && cached.source === 'no-intro') accepted.push(mergeEntry(candidate, cached, legacyEntries))
        else pending.push(candidate)
      }

      for (const batch of batches(pending, 100)) {
        let results
        try {
          results = await lookupBatch(batch.map(candidate => ({ sha1: candidate.sha1, md5: candidate.md5, size: candidate.size, system: candidate.system })))
          if (!Array.isArray(results) || results.length !== batch.length) throw new Error('Lookup result is not aligned.')
        } catch {
          rejected.push(...batch.map(candidate => ({ file: candidate.file, reason: 'ROM lookup was unavailable.' })))
          continue
        }
        for (let index = 0; index < batch.length; index += 1) {
          const entry = fromMatch(batch[index], results[index], legacyEntries)
          if (entry) accepted.push(entry)
          else rejected.push({ file: batch[index].file, reason: 'ROM did not match a trusted No-Intro dump.' })
        }
      }

      const bySha1 = new Map()
      for (const entry of accepted.sort((left, right) => left.file.localeCompare(right.file))) {
        if (!bySha1.has(entry.sha1)) bySha1.set(entry.sha1, entry)
      }
      return { accepted: [...bySha1.values()], rejected }
    },
  }
}

async function collectCandidates(romsDirectory, listDirectory, inspectPath) {
  const rejected = []
  let items
  try { items = await listDirectory(romsDirectory, { withFileTypes: true }) } catch { return { candidates: [], rejected } }
  const candidates = []
  for (const item of items.sort((left, right) => left.name.localeCompare(right.name))) {
    const file = item.name
    const type = systems.get(extname(file).toLowerCase())
    if (!type) { rejected.push({ file, reason: 'ROM extension is not supported.' }); continue }
    const path = join(romsDirectory, file)
    try {
      const stats = await inspectPath(path)
      if (stats.isSymbolicLink()) { rejected.push({ file, reason: 'ROM cannot be a symbolic link.' }); continue }
      if (!stats.isFile()) { rejected.push({ file, reason: 'ROM path is not a regular file.' }); continue }
      candidates.push({ file, path, ...type })
    } catch { rejected.push({ file, reason: 'ROM could not be inspected.' }) }
  }
  return { candidates, rejected }
}

function fingerprint(candidate, openStream) {
  return new Promise((resolve, reject) => {
    const hashes = [createHash('sha1'), createHash('md5'), createHash('sha256')]
    let size = 0
    const stream = openStream(candidate.path)
    stream.on('data', chunk => { size += chunk.length; hashes.forEach(hash => hash.update(chunk)) })
    stream.on('error', reject)
    stream.on('end', () => resolve({ ...candidate, sha1: hashes[0].digest('hex'), md5: hashes[1].digest('hex'), sha256: hashes[2].digest('hex'), size }))
  })
}

function fromMatch(candidate, match, legacyEntries) {
  const dump = match?.dump
  const game = match?.game
  if (!dump || !game || clean(dump.dump_source).toLowerCase() !== 'no-intro' || platformSystem(game.platform) !== candidate.system) return null
  if (clean(dump.sha1).toLowerCase() !== candidate.sha1 || clean(dump.md5).toLowerCase() !== candidate.md5 || dump.size !== candidate.size) return null
  const title = clean(game.names?.us) || clean(game.names?.eu) || clean(game.name)
  const region = clean(dump.region)
  if (!title || !region) return null
  const coverUrl = selectCover(game.media, region)
  return mergeEntry({ ...candidate, title, region, source: 'no-intro', ...(coverUrl ? { coverUrl } : {}) }, null, legacyEntries)
}

function mergeEntry(candidate, cached, legacyEntries) {
  const legacy = legacyEntries.find(entry => clean(entry.sha256).toLowerCase() === candidate.sha256 && entry.file === candidate.file && clean(entry.system).toLowerCase() === candidate.system)
  return {
    schemaVersion: 1,
    id: legacy?.id || cached?.id || `rom-${candidate.sha1}`,
    file: candidate.file,
    system: candidate.system,
    core: candidate.core,
    title: candidate.title || cached?.title,
    sha1: candidate.sha1,
    md5: candidate.md5,
    sha256: candidate.sha256,
    size: candidate.size,
    source: 'no-intro',
    region: candidate.region || cached?.region,
    ...((candidate.coverUrl || cached?.coverUrl) ? { coverUrl: candidate.coverUrl || cached.coverUrl } : {}),
    ...(legacy?.pokemonSave ? { pokemonSave: structuredClone(legacy.pokemonSave) } : cached?.pokemonSave ? { pokemonSave: structuredClone(cached.pokemonSave) } : {}),
  }
}

function platformSystem(platform) {
  const slug = clean(platform?.slug).toLowerCase()
  if (['gb', 'gbc', 'gba'].includes(slug)) return slug
  const name = clean(platform?.name).toLowerCase()
  return name === 'game boy' ? 'gb' : name === 'game boy color' ? 'gbc' : name === 'game boy advance' ? 'gba' : ''
}

function selectCover(media, dumpRegion) {
  if (!Array.isArray(media)) return undefined
  const images = media.filter(item => item?.type === 'box-2D' && isHttps(item.url))
  for (const region of [dumpRegion, 'us', 'eu', 'wor']) {
    const match = images.find(item => item.region === region)
    if (match) return match.url
  }
  return images[0]?.url
}

function isHttps(value) { try { return new URL(value).protocol === 'https:' } catch { return false } }
function clean(value) { return typeof value === 'string' ? value.trim() : '' }
function fingerprintKey(entry) { return `${entry.sha1}:${entry.md5}:${entry.sha256}:${entry.size}` }
function batches(values, size) { return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size)) }
