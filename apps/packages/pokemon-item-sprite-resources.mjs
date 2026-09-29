import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

export const ITEM_SPRITE_NORMALIZATION_VERSION = 2
const CANVAS_SIZE = 48
const CONTENT_SIZE = 42
const MIN_CONTENT_SIZE = 32
const HASH = /^[a-f0-9]{64}$/
const REVISION = /^[a-f0-9]{40}$/
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SOURCE_ROOT = 'https://raw.githubusercontent.com/PokeAPI/sprites/'
const LEGACY_PATHS = {
  'x-defend': 'x-defense',
  'x-special': 'x-sp-atk',
  itemfinder: 'gen3/itemfinder',
  'room-1-key': 'rm-1-key',
  'room-2-key': 'rm-2-key',
  'room-4-key': 'rm-4-key',
  'room-6-key': 'rm-6-key',
  'mystic-ticket': 'mysticticket',
  'aurora-ticket': 'auroraticket',
  'ss-ticket': 'ss-ticket--hoenn',
  'basement-key': 'basement-key--new-mauville',
  'storage-key': 'storage-key--sea-mauville',
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function collectPokemonItemKeys(catalog) {
  if (!catalog?.nativeIdMaps || typeof catalog.nativeIdMaps !== 'object') throw new TypeError('Item ID maps are required')
  return [...new Set(Object.values(catalog.nativeIdMaps).flat().filter(Boolean))]
}

export function selectPokemonItemSpriteSources(itemKeys, availablePaths, moveTypes = {}) {
  if (!Array.isArray(itemKeys) || !(availablePaths instanceof Set)) throw new TypeError('Item keys and available sprite paths are required')
  const seen = new Set()
  return itemKeys.map(itemKey => {
    if (!KEY.test(itemKey) || seen.has(itemKey)) throw new TypeError(`Invalid or duplicate item key: ${itemKey}`)
    seen.add(itemKey)
    const machine = /^(tm|hm)\d\d-(.+)$/.exec(itemKey)
    let candidates
    if (machine) {
      const move = machine[2] === 'solarbeam' ? 'solar-beam' : machine[2]
      const type = moveTypes[move]
      candidates = type && KEY.test(type) ? [`${machine[1]}-${type}.png`] : []
    } else {
      const name = LEGACY_PATHS[itemKey] ?? itemKey
      candidates = name.includes('/') ? [`${name}.png`] : [`dream-world/${name}.png`, `${name}.png`]
    }
    const path = candidates.find(candidate => availablePaths.has(candidate))
    if (!path) return { itemKey, status: 'missing', reason: 'no-matching-artwork' }
    return { itemKey, status: 'resolved', path, family: path.startsWith('dream-world/') ? 'dream-world' : path.startsWith('gen3/') ? 'gen3' : 'default' }
  })
}

export function validatePokemonItemSpriteRequirements(requirements, itemKeys = null) {
  if (requirements?.schemaVersion !== 1 || requirements?.spriteNormalizationVersion !== ITEM_SPRITE_NORMALIZATION_VERSION
    || !REVISION.test(requirements?.spriteRepositoryRevision) || !Array.isArray(requirements.entries)) {
    throw new TypeError('Invalid item sprite requirements manifest')
  }
  const expected = itemKeys == null ? null : new Set(itemKeys)
  const seen = new Set()
  for (const entry of requirements.entries) {
    if (!KEY.test(entry?.itemKey) || seen.has(entry.itemKey) || (expected && !expected.has(entry.itemKey))) throw new TypeError('Invalid or duplicate item sprite key')
    seen.add(entry.itemKey)
    if (entry.status === 'missing') {
      if (typeof entry.reason !== 'string' || !entry.reason) throw new TypeError('Missing item sprite reason is required')
      continue
    }
    if (entry.status !== 'resolved' || entry.file !== `${entry.itemKey}.png`
      || !/^(?:dream-world\/|gen3\/)?[a-z0-9-]+(?:--[a-z0-9-]+)?\.png$/.test(entry.sourcePath)
      || !['dream-world', 'gen3', 'default'].includes(entry.family)
      || !HASH.test(entry.sourceSha256) || !HASH.test(entry.sha256)
      || entry.source !== `${SOURCE_ROOT}${requirements.spriteRepositoryRevision}/sprites/items/${entry.sourcePath}`) {
      throw new TypeError(`Invalid item sprite requirement: ${entry.itemKey}`)
    }
  }
  if (expected && (seen.size !== expected.size || expected.size !== itemKeys.length)) throw new TypeError('Item sprite manifest does not cover the catalog')
  return requirements
}

export async function normalizePokemonItemSprite(bytes, imageProcessor) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || typeof imageProcessor !== 'function') throw new TypeError('PNG bytes and image processor are required')
  const source = imageProcessor(bytes)
  if ((await source.metadata()).format !== 'png') throw new TypeError('Item sprite source must be PNG')
  const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width; let top = info.height; let right = -1; let bottom = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] === 0) continue
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
    }
  }
  if (right < left) throw new TypeError('Item sprite has no visible pixels')
  const width = right - left + 1
  const height = bottom - top + 1
  const largest = Math.max(width, height)
  const target = largest < MIN_CONTENT_SIZE ? Math.min(MIN_CONTENT_SIZE, largest * 2) : Math.min(CONTENT_SIZE, largest)
  const scale = target / largest
  const cropped = imageProcessor(data, { raw: info }).extract({ left, top, width, height })
    .resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), fit: 'fill', kernel: imageProcessor.kernel.lanczos3 })
  const { data: resized, info: resizedInfo } = await cropped.raw().toBuffer({ resolveWithObject: true })
  const horizontal = CANVAS_SIZE - resizedInfo.width
  const vertical = CANVAS_SIZE - resizedInfo.height
  return imageProcessor(resized, { raw: resizedInfo }).extend({
    left: Math.floor(horizontal / 2), right: Math.ceil(horizontal / 2),
    top: Math.floor(vertical / 2), bottom: Math.ceil(vertical / 2),
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer()
}

function inventoryText(requirements) {
  return JSON.stringify({ schemaVersion: 1, spriteNormalizationVersion: ITEM_SPRITE_NORMALIZATION_VERSION,
    entries: requirements.entries.filter(entry => entry.status === 'resolved').map(({ itemKey, file, sha256: hash }) => ({ itemKey, file, sha256: hash })) }, null, 2) + '\n'
}

async function exists(path) {
  try { await access(path); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function presentFiles(targetDirectory, entries) {
  const present = new Set()
  for (const entry of entries) {
    try { if (sha256(await readFile(join(targetDirectory, entry.file))) === entry.sha256) present.add(entry.file) }
    catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
  return present
}

async function isComplete(targetDirectory, requirements, present) {
  const entries = requirements.entries.filter(entry => entry.status === 'resolved')
  if (present.size !== entries.length) return false
  try {
    const files = await readdir(targetDirectory)
    if (files.length !== entries.length + 1 || !files.includes('inventory.json')) return false
    return await readFile(join(targetDirectory, 'inventory.json'), 'utf8') === inventoryText(requirements)
  } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

export async function getPokemonItemSpriteRequirementStatus(targetDirectory, requirements) {
  validatePokemonItemSpriteRequirements(requirements)
  const target = resolve(targetDirectory)
  const entries = requirements.entries.filter(entry => entry.status === 'resolved')
  const present = await presentFiles(target, entries)
  const lock = join(dirname(target), `.${basename(target)}.sync.lock`)
  return { status: await isComplete(target, requirements, present) ? 'complete' : await exists(lock) ? 'running' : 'incomplete', count: present.size }
}

async function replaceDirectory(target, stage) {
  const parent = dirname(target)
  if (dirname(stage) !== parent || !basename(stage).startsWith(`.${basename(target)}.sync-`)) throw new TypeError('Unsafe item sprite stage directory')
  const backup = join(parent, `.${basename(target)}.backup-${process.pid}-${Date.now()}`)
  let backedUp = false
  try {
    if (await exists(target)) { await renameItemSpriteDirectoryWithRetry(target, backup); backedUp = true }
    await renameItemSpriteDirectoryWithRetry(stage, target)
  } catch (error) {
    if (backedUp && !await exists(target)) await renameItemSpriteDirectoryWithRetry(backup, target)
    throw error
  }
  if (backedUp) await rm(backup, { recursive: true, force: true })
}

export async function renameItemSpriteDirectoryWithRetry(from, to, move = rename, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { await move(from, to); return }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code) || attempt === 4) throw error
      await pause(100 * (attempt + 1))
    }
  }
}

export async function syncPokemonItemSpriteRequirements({ targetDirectory, requirements, download, imageProcessor } = {}) {
  validatePokemonItemSpriteRequirements(requirements)
  if (typeof targetDirectory !== 'string' || !targetDirectory || typeof download !== 'function' || typeof imageProcessor !== 'function') throw new TypeError('Target directory, downloader and image processor are required')
  const target = resolve(targetDirectory)
  const parent = dirname(target)
  await mkdir(parent, { recursive: true })
  const lockPath = join(parent, `.${basename(target)}.sync.lock`)
  let lock
  try { lock = await open(lockPath, 'wx') }
  catch (error) { if (error?.code === 'EEXIST') return { status: 'running', count: 0, downloaded: [] }; throw error }
  try {
    const entries = requirements.entries.filter(entry => entry.status === 'resolved')
    const present = await presentFiles(target, entries)
    if (await isComplete(target, requirements, present)) return { status: 'complete', count: entries.length, downloaded: [] }
    const stage = join(parent, `.${basename(target)}.sync-${process.pid}-${Date.now()}`)
    if (dirname(stage) !== parent) throw new TypeError('Unsafe item sprite stage directory')
    await mkdir(stage)
    try {
      let next = 0
      const downloaded = []
      const workers = Array.from({ length: Math.min(8, entries.length) }, async () => {
        while (next < entries.length) {
          const entry = entries[next++]
          if (present.has(entry.file)) { await copyFile(join(target, entry.file), join(stage, entry.file)); continue }
          const source = await download(entry.source)
          if (!(source instanceof Uint8Array) || sha256(source) !== entry.sourceSha256) throw new Error(`Item sprite source hash differs from requirements: ${entry.file}`)
          const normalized = await normalizePokemonItemSprite(source, imageProcessor)
          if (sha256(normalized) !== entry.sha256) throw new Error(`Item sprite output hash differs from requirements: ${entry.file}`)
          await writeFile(join(stage, entry.file), normalized)
          downloaded.push(entry.file)
        }
      })
      const results = await Promise.allSettled(workers)
      const failure = results.find(result => result.status === 'rejected')
      if (failure) throw failure.reason
      await writeFile(join(stage, 'inventory.json'), inventoryText(requirements))
      await replaceDirectory(target, stage)
      return { status: 'synchronized', count: entries.length, downloaded: downloaded.sort() }
    } finally { await rm(stage, { recursive: true, force: true }) }
  } finally { await lock.close(); await rm(lockPath, { force: true }) }
}
