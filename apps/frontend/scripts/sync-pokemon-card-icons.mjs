import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { preferredBallIconSources } from '../../packages/pokemon-card-ball-icon.mjs'
import { gen3MoveTypeSlugs } from '../../packages/pokemon-card-move-type-icon.mjs'
import { normalizeBallIcon } from './pokemon-ball-icon-normalizer.mjs'

// Emerald PokéNav: src/pokenav_ribbons_summary.c, sRibbonGfxData.
// The 8×192 indexed atlas stores one half of each 16×16 icon; the game mirrors it.
const base = 'https://raw.githubusercontent.com/pret/pokeemerald/c925b8482d05fb882d6b64e523653cae599e025f/graphics/pokenav/ribbons/'
const target = fileURLToPath(new URL('../public/resources/pokemon-card/ribbons/', import.meta.url))
const ballRevision = 'fb3512817b9c3f46952b3f89e82645e77bdcaf49'
const ballBase = `https://raw.githubusercontent.com/PokeAPI/sprites/${ballRevision}/sprites/items/`
const ballTarget = fileURLToPath(new URL('../public/resources/pokeballs/', import.meta.url))
const legacyBallTarget = fileURLToPath(new URL('../public/resources/pokemon-card/balls/', import.meta.url))
const required = process.argv.includes('--required')
const typeBase = `https://raw.githubusercontent.com/PokeAPI/sprites/${ballRevision}/sprites/types/generation-viii/legends-arceus/small/`
const typeTarget = fileURLToPath(new URL('../public/resources/pokemon-card/types/', import.meta.url))
const typeIconSlugs = gen3MoveTypeSlugs.filter(type => type !== 'mystery')
const ribbonArt = [
  [0, 1], ...Array.from({ length: 20 }, (_, index) => [1 + index % 4, 1 + Math.floor(index / 4)]),
  [5, 1], [6, 1], [7, 2], [8, 3], [9, 2], [9, 4], [9, 5], [10, 4], [10, 5], [11, 1], [11, 2],
]

async function download(path) {
  const response = await fetch(base + path)
  if (!response.ok) throw new Error(`Ribbon asset unavailable: ${path} (${response.status})`)
  return Buffer.from(await response.arrayBuffer())
}

function paletteColors(source) {
  const lines = source.toString('utf8').trim().split(/\r?\n/)
  if (lines[0] !== 'JASC-PAL' || lines[2] !== '16') throw new Error('Unexpected Emerald ribbon palette')
  return lines.slice(3, 19).map(line => line.split(' ').map(Number))
}

function pngPalette(source) {
  let position = 8
  while (position < source.length) {
    const length = source.readUInt32BE(position)
    const type = source.toString('ascii', position + 4, position + 8)
    if (type === 'PLTE') return Array.from({ length: length / 3 }, (_, index) => [...source.subarray(position + 8 + index * 3, position + 11 + index * 3)])
    position += 12 + length
  }
  throw new Error('Emerald ribbon atlas has no indexed palette')
}

async function sync() {
  if (!process.argv.includes('--refresh')) {
    try {
      const manifest = JSON.parse(await readFile(`${target}manifest.json`, 'utf8'))
      if (manifest.schemaVersion === 1 && manifest.source === base && manifest.icons.length === 32) {
        await Promise.all(manifest.icons.map(icon => readFile(`${target}${icon.file}`)))
        console.log('Pokemon card ribbons: complete (32 icons)')
        return
      }
    } catch { /* An incomplete catalog is resynchronized. */ }
  }
  const [atlas, ...paletteFiles] = await Promise.all(['icons.png', ...Array.from({ length: 5 }, (_, index) => `icons${index + 1}.pal`)].map(download))
  const sourceColors = pngPalette(atlas)
  const palettes = paletteFiles.map(paletteColors)
  const { data, info } = await sharp(atlas).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== 8 || info.height !== 192 || info.channels !== 3) throw new Error('Unexpected Emerald ribbon atlas dimensions')
  const sourceIndex = new Map(sourceColors.map((color, index) => [color.join(','), index]))
  await mkdir(target, { recursive: true })
  const icons = []
  for (const [ribbonId, [row, paletteNumber]] of ribbonArt.entries()) {
    const rgba = Buffer.alloc(16 * 16 * 4)
    for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
      const atlasOffset = ((row * 16 + y) * 8 + Math.min(x, 15 - x)) * 3
      const colorIndex = sourceIndex.get([...data.subarray(atlasOffset, atlasOffset + 3)].join(','))
      if (colorIndex === undefined) throw new Error('Unexpected Emerald ribbon palette index')
      const outputOffset = (y * 16 + x) * 4
      const color = palettes[paletteNumber - 1][colorIndex]
      rgba[outputOffset] = color[0]; rgba[outputOffset + 1] = color[1]; rgba[outputOffset + 2] = color[2]; rgba[outputOffset + 3] = colorIndex === 0 ? 0 : 255
    }
    const file = `gen3-ribbon-${ribbonId}.png`
    await writeFile(`${target}${file}`, await sharp(rgba, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer())
    icons.push({ ribbonId, file, row, palette: paletteNumber })
  }
  await writeFile(`${target}manifest.json`, JSON.stringify({ schemaVersion: 1, source: base, atlasSha256: createHash('sha256').update(atlas).digest('hex'), icons }, null, 2))
  console.log('Pokemon card ribbons: synchronized (32 icons)')
}

try { await sync() } catch (error) { console.warn(`Pokemon card ribbons: ${error.message}; text labels remain available`) }

async function syncBalls() {
  let reusableSources = null
  if (!process.argv.includes('--refresh')) {
    try {
      const manifest = JSON.parse(await readFile(`${ballTarget}manifest.json`, 'utf8'))
      if ([1, 2].includes(manifest.schemaVersion) && manifest.source === ballBase && Array.isArray(manifest.icons) && manifest.icons.length === preferredBallIconSources.length && manifest.icons.every((icon, index) => icon.slug === preferredBallIconSources[index].slug && icon.variant === preferredBallIconSources[index].source && icon.file === `${icon.slug}.png`)) {
        const stored = await Promise.all(manifest.icons.map(async icon => {
          const bytes = await readFile(`${ballTarget}${icon.file}`)
          if (createHash('sha256').update(bytes).digest('hex') !== icon.sha256) throw new Error(`Ball icon checksum mismatch: ${icon.file}`)
          return [icon.slug, bytes]
        }))
        if (manifest.schemaVersion === 2) {
          await cleanBallFiles()
          console.log(`Pokemon card balls: complete (${manifest.icons.length} normalized icons)`)
          return
        }
        reusableSources = new Map(stored)
      }
    } catch { /* An incomplete catalog is resynchronized. */ }
  }
  const icons = await Promise.all(preferredBallIconSources.map(async ({ slug, source: variant }) => {
    let sourceBytes = reusableSources?.get(slug)
    if (!sourceBytes) {
      const response = await fetch(`${ballBase}${variant === 'default' ? '' : `${variant}/`}${slug}.png`)
      if (!response.ok) throw new Error(`Ball asset unavailable: ${slug} (${variant}, ${response.status})`)
      sourceBytes = Buffer.from(await response.arrayBuffer())
    }
    const { format, width, height } = await sharp(sourceBytes).metadata()
    if (format !== 'png' || width < 16 || width > 100 || height < 16 || height > 100) throw new Error(`Unexpected PokéAPI ball icon: ${slug}`)
    const bytes = await normalizeBallIcon(sourceBytes)
    return { slug, variant, file: `${slug}.png`, sourceWidth: width, sourceHeight: height, sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'), bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
  }))
  await mkdir(ballTarget, { recursive: true })
  for (const icon of icons) await writeFile(`${ballTarget}${icon.file}`, icon.bytes)
  await writeFile(`${ballTarget}manifest.json`, JSON.stringify({ schemaVersion: 2, source: ballBase, canvasSize: 96, artworkSize: 72, icons: icons.map(({ slug, variant, file, sourceWidth, sourceHeight, sourceSha256, sha256 }) => ({ slug, variant, file, sourceWidth, sourceHeight, sourceSha256, sha256 })) }, null, 2))
  await cleanBallFiles()
  console.log(`Pokemon card balls: synchronized (${icons.length} normalized icons)`)
}

async function cleanBallFiles() {
  const expected = new Set(['manifest.json', ...preferredBallIconSources.map(({ slug }) => `${slug}.png`)])
  for (const file of await readdir(ballTarget)) {
    if (!expected.has(file)) await rm(`${ballTarget}${file}`, { recursive: true, force: true })
  }
  await rm(legacyBallTarget, { recursive: true, force: true })
}

try { await syncBalls() } catch (error) {
  if (required) throw error
  console.warn(`Pokemon card balls: ${error.message}; card details remain available`)
}

async function syncTypes() {
  if (!process.argv.includes('--refresh')) {
    try {
      const manifest = JSON.parse(await readFile(`${typeTarget}manifest.json`, 'utf8'))
      if (manifest.schemaVersion === 1 && manifest.source === typeBase && Array.isArray(manifest.icons) && manifest.icons.length === typeIconSlugs.length && manifest.icons.every((icon, index) => icon.type === typeIconSlugs[index] && icon.file === `${icon.type}.png`)) {
        await Promise.all(manifest.icons.map(async icon => {
          const bytes = await readFile(`${typeTarget}${icon.file}`)
          if (createHash('sha256').update(bytes).digest('hex') !== icon.sha256) throw new Error(`Type icon checksum mismatch: ${icon.file}`)
        }))
        console.log(`Pokemon card types: complete (${manifest.icons.length} icons)`)
        return
      }
    } catch { /* An incomplete catalog is resynchronized. */ }
  }
  const icons = await Promise.all(typeIconSlugs.map(async (type, index) => {
    const response = await fetch(`${typeBase}${index + 1}.png`)
    if (!response.ok) throw new Error(`Type asset unavailable: ${type} (${response.status})`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const { format, width, height } = await sharp(bytes).metadata()
    if (format !== 'png' || width !== 60 || height !== 60) throw new Error(`Unexpected Legends: Arceus type icon: ${type}`)
    return { type, file: `${type}.png`, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
  }))
  await mkdir(typeTarget, { recursive: true })
  for (const icon of icons) await writeFile(`${typeTarget}${icon.file}`, icon.bytes)
  await writeFile(`${typeTarget}manifest.json`, JSON.stringify({ schemaVersion: 1, source: typeBase, icons: icons.map(({ type, file, sha256 }) => ({ type, file, sha256 })) }, null, 2))
  console.log(`Pokemon card types: synchronized (${icons.length} icons)`)
}

try { await syncTypes() } catch (error) { console.warn(`Pokemon card types: ${error.message}; type labels remain available`) }
