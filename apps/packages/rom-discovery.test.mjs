import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { createRomDiscovery } from './rom-discovery.mjs'

const roots = new Set()

afterEach(async () => {
  await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true })))
  roots.clear()
})

async function createRoms(files) {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-rom-discovery-'))
  const romsDirectory = join(root, 'roms')
  roots.add(root)
  await mkdir(romsDirectory)
  await Promise.all(Object.entries(files).map(([file, bytes]) => writeFile(join(romsDirectory, file), bytes)))
  return { root, romsDirectory }
}

function noIntroMatch({ sha1, md5, size }, overrides = {}) {
  return {
    game: {
      name: 'Pokemon - Versione Smeraldo',
      names: { us: 'Pokémon Emerald Version', eu: 'Pokémon: Emerald Version' },
      platform: { name: 'Game Boy Advance', slug: 'gba' },
      media: [
        { type: 'box-2D', region: 'wor', url: 'https://retrocollection.example/world.png' },
        { type: 'box-2D', region: 'us', url: 'https://retrocollection.example/us.png' },
      ],
    },
    dump: { sha1: sha1.toUpperCase(), md5: md5.toUpperCase(), size, region: 'wor', dump_source: 'no-intro' },
    ...overrides,
  }
}

test('accepts an exact No-Intro GBA match with preferred title and HTTPS cover', async () => {
  const { romsDirectory } = await createRoms({ 'emerald.gba': Buffer.from('trusted emerald bytes') })
  const calls = []
  const discovery = createRomDiscovery({
    lookupBatch: async lookups => {
      calls.push(lookups)
      return lookups.map(noIntroMatch)
    },
  })

  const result = await discovery.scan({ romsDirectory, cachedEntries: [], legacyEntries: [] })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, 1)
  assert.deepEqual(result.rejected, [])
  assert.equal(result.accepted.length, 1)
  assert.equal(result.accepted[0].title, 'Pokémon Emerald Version')
  assert.equal(result.accepted[0].system, 'gba')
  assert.equal(result.accepted[0].core, 'gba')
  assert.equal(result.accepted[0].source, 'no-intro')
  assert.equal(result.accepted[0].coverUrl, 'https://retrocollection.example/world.png')
})

test('enriches a legacy registration without a cover while preserving its stable ID', async () => {
  const { romsDirectory } = await createRoms({ 'emerald.gba': Buffer.from('legacy emerald bytes') })
  let called = 0
  const discovery = createRomDiscovery({
    refreshLegacyMetadata: true,
    lookupBatch: async lookups => {
      called += 1
      return lookups.map(noIntroMatch)
    },
  })
  const bytes = Buffer.from('legacy emerald bytes')
  const legacyEntries = [{
    id: 'pokemon-emerald-usa-europe', file: 'emerald.gba', system: 'gba', core: 'gba', title: 'Pokémon Emerald Version',
    sha256: (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'),
    pokemonSave: { supported: true, adapter: 'gen3-gba-v1' },
  }]

  const result = await discovery.scan({ romsDirectory, cachedEntries: [], legacyEntries })

  assert.equal(called, 1)
  assert.equal(result.accepted[0].id, 'pokemon-emerald-usa-europe')
  assert.equal(result.accepted[0].coverUrl, 'https://retrocollection.example/world.png')
  assert.deepEqual(result.accepted[0].pokemonSave, legacyEntries[0].pokemonSave)
})

test('rejects unsupported, symlinked, unmatched, non-No-Intro, and mismatched candidates', async () => {
  const { root, romsDirectory } = await createRoms({
    'trusted.gba': Buffer.from('trusted'),
    'unknown.gba': Buffer.from('unknown'),
    'ignored.zip': Buffer.from('archive'),
    'linked.gba': Buffer.from('link placeholder'),
  })
  await mkdir(join(romsDirectory, 'nested'))

  const discovery = createRomDiscovery({
    inspectPath: async path => path.endsWith('linked.gba')
      ? { isSymbolicLink: () => true, isFile: () => false }
      : lstat(path),
    lookupBatch: async lookups => lookups.map((lookup, index) => index === 0
      ? noIntroMatch(lookup)
      : index === 1 ? noIntroMatch(lookup, { dump: { ...noIntroMatch(lookup).dump, dump_source: 'community' } })
      : null),
  })
  const result = await discovery.scan({ romsDirectory, cachedEntries: [], legacyEntries: [] })

  assert.equal(result.accepted.length, 1)
  assert.ok(result.rejected.some(item => item.file === 'unknown.gba'))
  assert.ok(result.rejected.some(item => item.file === 'ignored.zip'))
  assert.ok(result.rejected.some(item => item.file === 'linked.gba'))
})
