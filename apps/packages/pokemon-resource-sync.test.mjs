import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { getPokemonResourceCatalogStatus, syncPokemonResources } from './pokemon-resource-sync.mjs'

const record = {
  sourceId: 6,
  speciesId: 6,
  name: 'charizard',
  isDefault: true,
  images: { normal: 'https://assets.example/6.png', shiny: 'https://assets.example/6-shiny.png' },
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pokemon-resource-sync-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function writeCompleteCatalog(directory, normal = 'normal', shiny = 'shiny') {
  await writeFile(join(directory, '6.png'), normal)
  await writeFile(join(directory, '6-shiny.png'), shiny)
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    entries: [{ nationalDex: 6, region: null, variant: null, sourceId: 6, normalFile: '6.png', shinyFile: '6-shiny.png' }],
  }))
}

test('does not contact the network when a complete catalog already exists', async t => {
  const directory = await fixture(t)
  await writeCompleteCatalog(directory)
  let loads = 0

  const result = await syncPokemonResources({
    targetDirectory: directory,
    loadRecords: async () => { loads += 1; return [record] },
    download: async () => Buffer.from('unexpected'),
  })

  assert.deepEqual(result, { status: 'complete', count: 1 })
  assert.equal(loads, 0)
})

test('reports whether the next frontend start needs resource acquisition', async t => {
  const directory = await fixture(t)
  assert.deepEqual(await getPokemonResourceCatalogStatus(directory), { status: 'incomplete', count: 0 })

  await writeCompleteCatalog(directory)
  assert.deepEqual(await getPokemonResourceCatalogStatus(directory), { status: 'complete', count: 1 })
})

test('replaces an incomplete catalog with every expected local resource and manifest', async t => {
  const directory = await fixture(t)
  await writeFile(join(directory, '6.png'), 'stale')
  let downloads = 0

  const result = await syncPokemonResources({
    targetDirectory: directory,
    loadRecords: async () => [record],
    download: async url => { downloads += 1; return Buffer.from(url) },
  })

  assert.deepEqual(result, { status: 'synchronized', count: 1 })
  assert.equal(downloads, 2)
  assert.equal(await readFile(join(directory, '6.png'), 'utf8'), record.images.normal)
  assert.equal(await readFile(join(directory, '6-shiny.png'), 'utf8'), record.images.shiny)
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')), {
    schemaVersion: 1,
    entries: [{ nationalDex: 6, region: null, variant: null, sourceId: 6, normalFile: '6.png', shinyFile: '6-shiny.png' }],
  })
})

test('preserves a complete catalog when explicit refresh cannot download a new catalog', async t => {
  const directory = await fixture(t)
  await writeCompleteCatalog(directory, 'previous-normal', 'previous-shiny')

  await assert.rejects(() => syncPokemonResources({
    targetDirectory: directory,
    refresh: true,
    loadRecords: async () => [record],
    download: async () => { throw new Error('network unavailable') },
  }), /network unavailable/)

  assert.equal(await readFile(join(directory, '6.png'), 'utf8'), 'previous-normal')
  assert.equal(await readFile(join(directory, '6-shiny.png'), 'utf8'), 'previous-shiny')
})
