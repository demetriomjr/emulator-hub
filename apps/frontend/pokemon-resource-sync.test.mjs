import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import sharp from 'sharp'

import { getPokemonResourceCatalogStatus, normalizePokemonSprite, SPRITE_NORMALIZATION_VERSION, syncPokemonResources } from '../packages/pokemon-resource-sync.mjs'

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
    spriteNormalizationVersion: SPRITE_NORMALIZATION_VERSION,
    entries: [{ nationalDex: 6, region: null, variant: null, sourceId: 6, normalFile: '6.png', shinyFile: '6-shiny.png' }],
  }))
}

async function alphaBounds(image) {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }

  return { left, top, width: right - left + 1, height: bottom - top + 1 }
}

async function opaqueSprite(width = 10, height = 20) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 50, g: 120, b: 210, alpha: 1 } },
  }).png().toBuffer()
}

test('normalizes transparent outer space into a centered fixed-size sprite canvas', async () => {
  const source = await sharp({
    create: { width: 40, height: 30, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{
    input: await sharp({ create: { width: 10, height: 20, channels: 4, background: { r: 220, g: 40, b: 80, alpha: 1 } } }).png().toBuffer(),
    left: 2,
    top: 4,
  }]).png().toBuffer()

  const normalized = await normalizePokemonSprite(source, sharp)
  assert.deepEqual(await sharp(normalized).metadata().then(({ width, height, hasAlpha }) => ({ width, height, hasAlpha })), {
    width: 96,
    height: 96,
    hasAlpha: true,
  })
  assert.deepEqual(await alphaBounds(normalized), { left: 29, top: 10, width: 38, height: 76 })
})

test('treats a manifest from an earlier sprite normalization as incomplete', async t => {
  const directory = await fixture(t)
  await writeFile(join(directory, '6.png'), 'normal')
  await writeFile(join(directory, '6-shiny.png'), 'shiny')
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    spriteNormalizationVersion: SPRITE_NORMALIZATION_VERSION - 1,
    entries: [{ nationalDex: 6, region: null, variant: null, sourceId: 6, normalFile: '6.png', shinyFile: '6-shiny.png' }],
  }))

  assert.deepEqual(await getPokemonResourceCatalogStatus(directory), { status: 'incomplete', count: 0 })
})

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
    download: async () => { downloads += 1; return opaqueSprite() },
    imageProcessor: sharp,
  })

  assert.deepEqual(result, { status: 'synchronized', count: 1 })
  assert.equal(downloads, 2)
  assert.deepEqual(await sharp(join(directory, '6.png')).metadata().then(({ width, height }) => ({ width, height })), { width: 96, height: 96 })
  assert.deepEqual(await sharp(join(directory, '6-shiny.png')).metadata().then(({ width, height }) => ({ width, height })), { width: 96, height: 96 })
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')), {
    schemaVersion: 1,
    spriteNormalizationVersion: SPRITE_NORMALIZATION_VERSION,
    entries: [{ nationalDex: 6, region: null, variant: null, sourceId: 6, normalFile: '6.png', shinyFile: '6-shiny.png' }],
  })
})

test('normalizes a trailing slash before atomically replacing the catalog', async t => {
  const directory = await fixture(t)

  const result = await syncPokemonResources({
    targetDirectory: `${directory}/`,
    loadRecords: async () => [record],
    download: async () => opaqueSprite(),
    imageProcessor: sharp,
  })

  assert.deepEqual(result, { status: 'synchronized', count: 1 })
  assert.equal(await getPokemonResourceCatalogStatus(`${directory}/`).then(({ status }) => status), 'complete')
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
