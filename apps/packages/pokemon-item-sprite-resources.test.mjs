import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import catalog from './pokemon-item-catalog.json' with { type: 'json' }
import {
  collectPokemonItemKeys,
  normalizePokemonItemSprite,
  renameItemSpriteDirectoryWithRetry,
  selectPokemonItemSpriteSources,
  syncPokemonItemSpriteRequirements,
  validatePokemonItemSpriteRequirements,
} from './pokemon-item-sprite-resources.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sharp = createRequire(new URL('../frontend/package.json', import.meta.url))('sharp')

test('collects one semantic sprite key across present and future game maps', () => {
  assert.deepEqual(collectPokemonItemKeys({ nativeIdMaps: { gba: [null, 'potion', 'rare-candy'], other: [null, 'rare-candy', 'new-item'] } }), [
    'potion', 'rare-candy', 'new-item',
  ])
})

test('selects cohesive artwork first and resolves Gen III legacy names and machine types', () => {
  const paths = new Set([
    'dream-world/potion.png', 'potion.png', 'x-defense.png', 'dream-world/x-defense.png',
    'gen3/itemfinder.png', 'rm-1-key.png', 'mysticticket.png', 'tm-fighting.png', 'hm-normal.png',
  ])
  const selected = selectPokemonItemSpriteSources(
    ['potion', 'x-defend', 'itemfinder', 'room-1-key', 'mystic-ticket', 'tm01-focus-punch', 'hm01-cut'],
    paths,
    { 'focus-punch': 'fighting', cut: 'normal' },
  )
  assert.deepEqual(selected.map(({ itemKey, status, path }) => [itemKey, status, path]), [
    ['potion', 'resolved', 'dream-world/potion.png'],
    ['x-defend', 'resolved', 'dream-world/x-defense.png'],
    ['itemfinder', 'resolved', 'gen3/itemfinder.png'],
    ['room-1-key', 'resolved', 'rm-1-key.png'],
    ['mystic-ticket', 'resolved', 'mysticticket.png'],
    ['tm01-focus-punch', 'resolved', 'tm-fighting.png'],
    ['hm01-cut', 'resolved', 'hm-normal.png'],
  ])
})

test('records missing artwork without assigning an unrelated sprite', () => {
  const selected = selectPokemonItemSpriteSources(['unknown-item'], new Set(), {})
  assert.deepEqual(selected, [{ itemKey: 'unknown-item', status: 'missing', reason: 'no-matching-artwork' }])
})

test('normalizes small sprites to a legible size on a 48 pixel canvas', async () => {
  const source = await sharp({ create: { width: 24, height: 30, channels: 4, background: '#00000000' } })
    .composite([{ input: await sharp({ create: { width: 12, height: 20, channels: 4, background: '#994433' } }).png().toBuffer(), left: 6, top: 5 }]).png().toBuffer()
  const normalized = await normalizePokemonItemSprite(source, sharp)
  const { width, height } = await sharp(normalized).metadata()
  const { info } = await sharp(normalized).trim().toBuffer({ resolveWithObject: true })
  assert.deepEqual({ width, height }, { width: 48, height: 48 })
  assert.deepEqual({ width: info.width, height: info.height }, { width: 19, height: 32 })
})

test('caps enlargement at two times the source size', async () => {
  const source = await sharp({ create: { width: 14, height: 14, channels: 4, background: '#994433' } }).png().toBuffer()
  const normalized = await normalizePokemonItemSprite(source, sharp)
  const { info } = await sharp(normalized).trim().toBuffer({ resolveWithObject: true })
  assert.deepEqual({ width: info.width, height: info.height }, { width: 28, height: 28 })
})

test('downloads verified sprites, reuses them and preserves prior files on hash failure', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pokemon-items-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const targetDirectory = join(directory, 'items')
  const source = await sharp({ create: { width: 90, height: 90, channels: 4, background: '#669944' } }).png().toBuffer()
  const normalized = await normalizePokemonItemSprite(source, sharp)
  const entry = {
    itemKey: 'potion', status: 'resolved', file: 'potion.png', family: 'dream-world',
    sourcePath: 'dream-world/potion.png',
    source: 'https://raw.githubusercontent.com/PokeAPI/sprites/0123456789abcdef0123456789abcdef01234567/sprites/items/dream-world/potion.png',
    sourceSha256: hash(source), sha256: hash(normalized),
  }
  const requirements = { schemaVersion: 1, spriteNormalizationVersion: 2, spriteRepositoryRevision: '0123456789abcdef0123456789abcdef01234567', entries: [entry] }
  assert.deepEqual(validatePokemonItemSpriteRequirements(requirements, ['potion']).entries, [entry])

  let calls = 0
  const download = async () => { calls++; return source }
  assert.deepEqual(await syncPokemonItemSpriteRequirements({ targetDirectory, requirements, download, imageProcessor: sharp }), { status: 'synchronized', count: 1, downloaded: ['potion.png'] })
  assert.equal(calls, 1)
  assert.equal((await readFile(join(targetDirectory, 'potion.png'))).equals(normalized), true)
  assert.deepEqual((await readdir(targetDirectory)).sort(), ['inventory.json', 'potion.png'])
  assert.deepEqual(await syncPokemonItemSpriteRequirements({ targetDirectory, requirements, download, imageProcessor: sharp }), { status: 'complete', count: 1, downloaded: [] })
  assert.equal(calls, 1)

  const changed = { ...requirements, entries: [{ ...entry, sourceSha256: hash('bad'), sha256: hash('new output') }] }
  await assert.rejects(() => syncPokemonItemSpriteRequirements({ targetDirectory, requirements: changed, download, imageProcessor: sharp }), /source hash/)
  assert.equal((await readFile(join(targetDirectory, 'potion.png'))).equals(normalized), true)
})

test('retries a temporary Windows directory lock during publication', async () => {
  let attempts = 0
  const move = async () => {
    attempts++
    if (attempts < 3) throw Object.assign(new Error('temporarily locked'), { code: 'EPERM' })
  }
  await renameItemSpriteDirectoryWithRetry('stage', 'target', move, async () => {})
  assert.equal(attempts, 3)
})

test('the checked-in manifest covers every known Gen III item exactly once', async () => {
  const requirements = JSON.parse(await readFile(new URL('../frontend/pokemon-item-sprite-requirements.json', import.meta.url), 'utf8'))
  const keys = collectPokemonItemKeys(catalog)
  validatePokemonItemSpriteRequirements(requirements, keys)
  assert.equal(requirements.entries.length, keys.length)
  assert.equal(requirements.entries.filter(entry => entry.status === 'resolved').length, keys.length)
})
