import sharp from 'sharp'

const canvasSize = 96
const artworkSize = 72

export async function normalizeBallIcon(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width, top = info.height, right = -1, bottom = -1
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    if (data[(y * info.width + x) * info.channels + 3] === 0) continue
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
  }
  if (right < left) throw new Error('Poké Ball icon has no visible artwork')
  const crop = { left, top, width: right - left + 1, height: bottom - top + 1 }
  const { data: artwork, info: resized } = await sharp(bytes).extract(crop).resize(artworkSize, artworkSize, {
    fit: 'inside',
    kernel: Math.max(crop.width, crop.height) < artworkSize ? sharp.kernel.nearest : sharp.kernel.lanczos3,
  }).png().toBuffer({ resolveWithObject: true })
  return sharp({ create: { width: canvasSize, height: canvasSize, channels: 4, background: '#00000000' } })
    .composite([{ input: artwork, left: Math.floor((canvasSize - resized.width) / 2), top: Math.floor((canvasSize - resized.height) / 2) }])
    .png().toBuffer()
}
