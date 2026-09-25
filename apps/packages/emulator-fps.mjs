export const gbaNominalFps = 16_777_216 / 280_896

export function sampleEmulatedFps(previous, frame, timestamp) {
  const current = frame
  if (typeof current !== 'number' || !Number.isFinite(current) || current < 0 || !Number.isFinite(timestamp)) {
    return { baseline: null, fps: null, speed: null }
  }
  const baseline = { frame: current, timestamp }
  if (!previous || current < previous.frame || timestamp <= previous.timestamp) {
    return { baseline, fps: null, speed: null }
  }
  const fps = (current - previous.frame) * 1000 / (timestamp - previous.timestamp)
  return { baseline, fps, speed: fps / gbaNominalFps }
}
