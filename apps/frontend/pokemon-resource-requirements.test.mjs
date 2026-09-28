import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import sharp from 'sharp'

import { createPokemonRequirements, getPokemonRequirementStatus, syncPokemonRequirements, upgradePokemonRequirements } from '../packages/pokemon-resource-requirements.mjs'
import { normalizePokemonSprite, SPRITE_NORMALIZATION_VERSION } from '../packages/pokemon-resource-sync.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pokemon-requirements-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#123456' } }).png().toBuffer()
  const image = await normalizePokemonSprite(source, sharp)
  return { directory, source, image }
}

function requirements(image) {
  return {
    schemaVersion: 1,
    spriteNormalizationVersion: SPRITE_NORMALIZATION_VERSION,
    entries: [
      { file: '6.png', source: 'https://assets.example/6.png', sha256: sha256(image) },
      { file: 'egg.png', source: 'https://assets.example/egg.png', sha256: sha256(image) },
    ],
  }
}

test('subtracts matching local files from requirements and downloads only the absent file', async t => {
  const { directory, source, image } = await fixture(t)
  await writeFile(join(directory, '6.png'), image)
  const desired = requirements(image)
  assert.deepEqual(await getPokemonRequirementStatus(directory, desired), { status: 'incomplete', count: 1, missing: ['egg.png'] })

  const downloaded = []
  const result = await syncPokemonRequirements({ targetDirectory: directory, requirements: desired, imageProcessor: sharp, download: async url => {
    downloaded.push(url)
    return source
  } })

  assert.deepEqual(result, { status: 'synchronized', count: 2, downloaded: ['egg.png'] })
  assert.deepEqual(downloaded, ['https://assets.example/egg.png'])
  assert.deepEqual(await getPokemonRequirementStatus(directory, desired), { status: 'complete', count: 2, missing: [] })
  assert.equal((await readFile(join(directory, '6.png'))).equals(image), true)
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'inventory.json'), 'utf8')).entries, [
    { file: '6.png', sha256: sha256(image) },
    { file: 'egg.png', sha256: sha256(image) },
  ])
})

test('removes obsolete sprites even when every required sprite already matches', async t => {
  const { directory, image } = await fixture(t)
  const desired = requirements(image)
  await writeFile(join(directory, '6.png'), image)
  await writeFile(join(directory, 'egg.png'), image)
  await writeFile(join(directory, 'inventory.json'), JSON.stringify({ schemaVersion: 1, spriteNormalizationVersion: SPRITE_NORMALIZATION_VERSION, entries: desired.entries.map(({ file, sha256: hash }) => ({ file, sha256: hash })) }, null, 2) + '\n')
  await writeFile(join(directory, 'old-sprite.png'), 'obsolete')

  const result = await syncPokemonRequirements({ targetDirectory: directory, requirements: desired, imageProcessor: sharp, download: async () => {
    throw new Error('valid sprites must be reused')
  } })

  assert.deepEqual(result.downloaded, [])
  assert.deepEqual((await readdir(directory)).sort(), ['6.png', 'egg.png', 'inventory.json'])
})

test('redownloads a file whose content differs from the required hash', async t => {
  const { directory, source, image } = await fixture(t)
  await writeFile(join(directory, '6.png'), 'outdated')
  await writeFile(join(directory, 'egg.png'), image)
  const desired = requirements(image)

  assert.deepEqual(await getPokemonRequirementStatus(directory, desired), { status: 'incomplete', count: 1, missing: ['6.png'] })
  const result = await syncPokemonRequirements({ targetDirectory: directory, requirements: desired, imageProcessor: sharp, download: async () => source })
  assert.deepEqual(result.downloaded, ['6.png'])
  assert.equal((await readFile(join(directory, '6.png'))).equals(image), true)
})

test('keeps existing files when downloaded content fails the required hash', async t => {
  const { directory, image } = await fixture(t)
  await writeFile(join(directory, '6.png'), image)
  const desired = requirements(image)
  await assert.rejects(() => syncPokemonRequirements({
    targetDirectory: directory,
    requirements: desired,
    imageProcessor: sharp,
    download: async () => Buffer.from('bad image'),
  }))
  assert.equal((await readFile(join(directory, '6.png'))).equals(image), true)
})

test('creates reviewable requirements with file hashes from the local catalog', async t => {
  const { directory, image } = await fixture(t)
  await writeFile(join(directory, '6.png'), image)
  await writeFile(join(directory, '6-shiny.png'), image)
  await writeFile(join(directory, 'egg.png'), image)

  const actual = await createPokemonRequirements(directory, [{
    sourceId: 6,
    normalFile: '6.png',
    shinyFile: '6-shiny.png',
    images: { normal: 'https://assets.example/6.png', shiny: 'https://assets.example/6-shiny.png' },
  }])

  assert.deepEqual(actual, {
    schemaVersion: 1,
    spriteNormalizationVersion: SPRITE_NORMALIZATION_VERSION,
    entries: [
      { file: '6.png', source: 'https://assets.example/6.png', sha256: sha256(image) },
      { file: '6-shiny.png', source: 'https://assets.example/6-shiny.png', sha256: sha256(image) },
      { file: 'egg.png', source: 'https://projectpokemon.org/images/sprites-models/homeimg/poke_capture_0000_000_uk_n_00000000_f_n.png', sha256: sha256(image) },
    ],
  })
})

test('upgrades legacy sprites and their hashes from registered sources', async t => {
  const { directory, source } = await fixture(t)
  await writeFile(join(directory, '6.png'), 'previous-normal')
  await writeFile(join(directory, 'egg.png'), 'previous-egg')
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, spriteNormalizationVersion: 1, entries: [{ normalFile: '6.png', shinyFile: 'egg.png' }] }))
  const legacy = { schemaVersion: 1, spriteNormalizationVersion: 1, entries: [
    { file: '6.png', source: 'https://assets.example/6.png', sha256: sha256('previous-normal') },
    { file: 'egg.png', source: 'https://assets.example/egg.png', sha256: sha256('previous-egg') },
  ] }
  const downloaded = []
  const upgraded = await upgradePokemonRequirements({ targetDirectory: directory, requirements: legacy, imageProcessor: sharp, download: async url => {
    downloaded.push(url)
    return source
  } })
  assert.equal(upgraded.spriteNormalizationVersion, SPRITE_NORMALIZATION_VERSION)
  assert.deepEqual(downloaded, legacy.entries.map(entry => entry.source))
  assert.deepEqual(await sharp(join(directory, '6.png')).metadata().then(({ width, height }) => ({ width, height })), { width: 480, height: 480 })
  assert.deepEqual(await getPokemonRequirementStatus(directory, upgraded), { status: 'complete', count: 2, missing: [] })
  assert.equal(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')).spriteNormalizationVersion, SPRITE_NORMALIZATION_VERSION)

  const reused = await upgradePokemonRequirements({ targetDirectory: directory, requirements: legacy, imageProcessor: sharp, download: async () => {
    throw new Error('cached sprite should not be downloaded')
  } })
  assert.deepEqual(reused, upgraded)

  const changedSource = { ...legacy, entries: legacy.entries.map(entry => entry.file === 'egg.png' ? { ...entry, source: 'https://assets.example/new-egg.png' } : entry) }
  const changedDownloads = []
  await upgradePokemonRequirements({ targetDirectory: directory, requirements: changedSource, imageProcessor: sharp, download: async url => {
    changedDownloads.push(url)
    return source
  } })
  assert.deepEqual(changedDownloads, ['https://assets.example/new-egg.png'])
})

test('preserves legacy sprites when resolution upgrade fails', async t => {
  const { directory, source } = await fixture(t)
  await writeFile(join(directory, '6.png'), 'previous-normal')
  await writeFile(join(directory, 'egg.png'), 'previous-egg')
  const legacy = { schemaVersion: 1, spriteNormalizationVersion: 1, entries: [
    { file: '6.png', source: 'https://assets.example/6.png', sha256: sha256('previous-normal') },
    { file: 'egg.png', source: 'https://assets.example/egg.png', sha256: sha256('previous-egg') },
  ] }
  await assert.rejects(() => upgradePokemonRequirements({ targetDirectory: directory, requirements: legacy, imageProcessor: sharp, download: async url => {
    if (url.endsWith('egg.png')) throw new Error('network unavailable')
    return source
  } }), /network unavailable/)
  assert.equal(await readFile(join(directory, '6.png'), 'utf8'), 'previous-normal')
  assert.equal(await readFile(join(directory, 'egg.png'), 'utf8'), 'previous-egg')
})
