import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Emerald PokéNav: src/pokenav_ribbons_summary.c, sRibbonGfxData.
// The 8×192 indexed atlas stores one half of each 16×16 icon; the game mirrors it.
const base = 'https://raw.githubusercontent.com/pret/pokeemerald/c925b8482d05fb882d6b64e523653cae599e025f/graphics/pokenav/ribbons/'
const target = fileURLToPath(new URL('../public/resources/pokemon-card/ribbons/', import.meta.url))
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
