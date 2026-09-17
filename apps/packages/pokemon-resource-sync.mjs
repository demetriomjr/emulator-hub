import { access, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import sharp from 'sharp'

import { selectPokemonResources } from './pokemon-resource-catalog.mjs'

const SCHEMA_VERSION = 1
export const SPRITE_NORMALIZATION_VERSION = 1
const SPRITE_CANVAS_SIZE = 96
const SPRITE_CONTENT_SIZE = 76

function manifestEntries(resources) {
  return resources.map(({ nationalDex, region, variant, sourceId, normalFile, shinyFile }) => ({ nationalDex, region, variant, sourceId, normalFile, shinyFile }))
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function completeCatalog(targetDirectory) {
  const manifestPath = join(targetDirectory, 'manifest.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (
      manifest?.schemaVersion !== SCHEMA_VERSION
      || manifest?.spriteNormalizationVersion !== SPRITE_NORMALIZATION_VERSION
      || !Array.isArray(manifest.entries)
      || manifest.entries.length === 0
    ) return null
    for (const entry of manifest.entries) {
      if (typeof entry?.normalFile !== 'string' || typeof entry?.shinyFile !== 'string') return null
      if (!await exists(join(targetDirectory, entry.normalFile)) || !await exists(join(targetDirectory, entry.shinyFile))) return null
    }
    return manifest.entries.length
  } catch {
    return null
  }
}

function lockPath(targetDirectory) {
  return join(dirname(targetDirectory), `.${basename(targetDirectory)}.sync.lock`)
}

export async function getPokemonResourceCatalogStatus(targetDirectory) {
  const count = await completeCatalog(targetDirectory)
  if (count != null) return { status: 'complete', count }
  return {
    status: await exists(lockPath(targetDirectory)) ? 'running' : 'incomplete',
    count: 0,
  }
}

async function acquireSyncLock(targetDirectory) {
  await mkdir(dirname(targetDirectory), { recursive: true })
  try {
    const path = lockPath(targetDirectory)
    return { handle: await open(path, 'wx'), path }
  } catch (error) {
    if (error?.code === 'EEXIST') return null
    throw error
  }
}

function assertImage(bytes, url) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new TypeError(`Downloaded resource is empty: ${url}`)
  }
}

function alphaBounds(data, { width, height, channels }) {
  let left = width
  let top = height
  let right = -1
  let bottom = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }

  if (right < left || bottom < top) throw new TypeError('Downloaded sprite has no visible pixels')
  return { left, top, width: right - left + 1, height: bottom - top + 1 }
}

export async function normalizePokemonSprite(bytes) {
  assertImage(bytes, 'sprite')
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const bounds = alphaBounds(data, info)
  const cropped = sharp(data, { raw: info }).extract(bounds).resize({
    width: SPRITE_CONTENT_SIZE,
    height: SPRITE_CONTENT_SIZE,
    fit: 'inside',
    kernel: sharp.kernel.lanczos3,
  })
  const { data: resized, info: resizedInfo } = await cropped.raw().toBuffer({ resolveWithObject: true })
  const horizontalInset = SPRITE_CANVAS_SIZE - resizedInfo.width
  const verticalInset = SPRITE_CANVAS_SIZE - resizedInfo.height

  return sharp(resized, { raw: resizedInfo }).extend({
    top: Math.floor(verticalInset / 2),
    bottom: Math.ceil(verticalInset / 2),
    left: Math.floor(horizontalInset / 2),
    right: Math.ceil(horizontalInset / 2),
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer()
}

async function replaceDirectory(targetDirectory, stageDirectory) {
  const backupDirectory = `${targetDirectory}.backup-${process.pid}-${Date.now()}`
  const targetExists = await exists(targetDirectory)
  let backedUp = false
  try {
    if (targetExists) {
      await rename(targetDirectory, backupDirectory)
      backedUp = true
    }
    await rename(stageDirectory, targetDirectory)
    if (backedUp) await rm(backupDirectory, { recursive: true, force: true })
  } catch (error) {
    if (backedUp && !await exists(targetDirectory) && await exists(backupDirectory)) {
      await rename(backupDirectory, targetDirectory)
    }
    throw error
  }
}

export async function syncPokemonResources({ targetDirectory, loadRecords, download, refresh = false } = {}) {
  if (typeof targetDirectory !== 'string' || targetDirectory.length === 0) throw new TypeError('Target directory is required')
  if (typeof loadRecords !== 'function') throw new TypeError('Record loader is required')
  if (typeof download !== 'function') throw new TypeError('Resource downloader is required')

  const count = await completeCatalog(targetDirectory)
  if (!refresh && count != null) return { status: 'complete', count }

  const lock = await acquireSyncLock(targetDirectory)
  if (!lock) return { status: 'running', count: 0 }

  try {
    const latestCount = await completeCatalog(targetDirectory)
    if (!refresh && latestCount != null) return { status: 'complete', count: latestCount }

    const resources = selectPokemonResources(await loadRecords())
    if (resources.length === 0) throw new Error('Pokemon resource catalog is empty')

    const parentDirectory = dirname(targetDirectory)
    const stageDirectory = join(parentDirectory, `.${basename(targetDirectory)}.sync-${process.pid}-${Date.now()}`)
    await mkdir(stageDirectory)

    try {
      for (const resource of resources) {
        const normal = await download(resource.images.normal)
        assertImage(normal, resource.images.normal)
        await writeFile(join(stageDirectory, resource.normalFile), await normalizePokemonSprite(normal))

        const shiny = await download(resource.images.shiny)
        assertImage(shiny, resource.images.shiny)
        await writeFile(join(stageDirectory, resource.shinyFile), await normalizePokemonSprite(shiny))
      }

      await writeFile(join(stageDirectory, 'manifest.json'), JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        spriteNormalizationVersion: SPRITE_NORMALIZATION_VERSION,
        entries: manifestEntries(resources),
      }, null, 2) + '\n')
      await replaceDirectory(targetDirectory, stageDirectory)
      return { status: 'synchronized', count: resources.length }
    } finally {
      if (await exists(stageDirectory)) await rm(stageDirectory, { recursive: true, force: true })
    }
  } finally {
    await lock.handle.close()
    await rm(lock.path, { force: true })
  }
}
