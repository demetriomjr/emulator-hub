import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'

import { normalizeBallIcon } from './pokemon-ball-icon-normalizer.mjs'

async function paintedBounds(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width, top = info.height, right = -1, bottom = -1
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    if (data[(y * info.width + x) * info.channels + 3] === 0) continue
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
  }
  return { width: right - left + 1, height: bottom - top + 1 }
}

test('normalizes small and large Poké Ball artwork to the same visible size', async () => {
  for (const [canvas, art] of [[24, 18], [32, 20], [90, 90]]) {
    const source = await sharp({ create: { width: canvas, height: canvas, channels: 4, background: '#00000000' } })
      .composite([{ input: await sharp({ create: { width: art, height: art, channels: 4, background: '#ff0000ff' } }).png().toBuffer(), left: Math.floor((canvas - art) / 2), top: Math.floor((canvas - art) / 2) }])
      .png().toBuffer()
    const output = await normalizeBallIcon(source)
    assert.deepEqual(await paintedBounds(output), { width: 72, height: 72 })
    const metadata = await sharp(output).metadata()
    assert.equal(metadata.width, 96)
    assert.equal(metadata.height, 96)
  }
})
