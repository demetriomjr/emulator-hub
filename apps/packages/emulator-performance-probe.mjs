import { findTrustedPlayerFrame } from './player-origin-topology.mjs'

export function performanceSampleMatchesFrame(event, frames, origin) {
  if (event?.data?.type !== 'emulator-hub:performance-sample' || typeof event.data.sessionId !== 'string') return false
  const frame = findTrustedPlayerFrame(event, frames, origin)
  return frame?.closest('.player-cell')?.dataset.sessionId === event.data.sessionId
}

export function createPerformanceTimingCollector() {
  let measurements = Object.create(null)
  return {
    record(name, durationMs) {
      if (typeof name !== 'string' || !name || !Number.isFinite(durationMs) || durationMs < 0) return
      const entry = measurements[name] ??= { count: 0, totalMs: 0, maxMs: 0 }
      entry.count += 1
      entry.totalMs += durationMs
      entry.maxMs = Math.max(entry.maxMs, durationMs)
    },
    drain() {
      const completed = { ...measurements }
      measurements = Object.create(null)
      return completed
    },
    snapshot() { return structuredClone({ ...measurements }) },
    reset() { measurements = Object.create(null) },
  }
}

export function measureSynchronousOperation(timings, name, operation, now = () => performance.now()) {
  if (!timings) return operation()
  const startedAt = now()
  try { return operation() }
  finally { timings.record(name, now() - startedAt) }
}

export function createPerformanceSampleStore({ maxSamples = 3_600, now = () => Date.now() } = {}) {
  let active = false
  let label = ''
  let startedAt = null
  let stoppedAt = null
  let samples = []
  const exportReport = () => ({ label, startedAt, stoppedAt, active, samples: structuredClone(samples) })
  return {
    start(nextLabel = '') {
      label = String(nextLabel)
      startedAt = now()
      stoppedAt = null
      samples = []
      active = true
      return exportReport()
    },
    stop() {
      if (active) stoppedAt = now()
      active = false
      return exportReport()
    },
    record(sample) {
      if (!active || typeof sample?.sessionId !== 'string' || !sample.sessionId || !Number.isFinite(sample.timestamp) || !Number.isFinite(sample.fps) || !Number.isFinite(sample.speed)) return false
      samples.push(structuredClone(sample))
      if (samples.length > maxSamples) samples.splice(0, samples.length - maxSamples)
      return true
    },
    export: exportReport,
    isActive() { return active },
  }
}

function percentile(values, fraction) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

export function summarizePerformanceReport(report) {
  const bySession = new Map()
  for (const sample of report.samples ?? []) {
    if (!bySession.has(sample.sessionId)) bySession.set(sample.sessionId, [])
    bySession.get(sample.sessionId).push(sample)
  }
  const players = {}
  for (const [sessionId, samples] of bySession) {
    const speeds = samples.map(sample => sample.speed)
    const timings = {}
    for (const sample of samples) {
      for (const [kind, value] of Object.entries(sample.timings ?? {})) {
        const entry = timings[kind] ??= { count: 0, totalMs: 0, maxMs: 0 }
        entry.count += value.count
        entry.totalMs += value.totalMs
        entry.maxMs = Math.max(entry.maxMs, value.maxMs)
      }
    }
    const latest = samples.at(-1)
    players[sessionId] = { samples: samples.length, medianSpeed: percentile(speeds, 0.5), p10Speed: percentile(speeds, 0.1), target: latest.target ?? null, threaded: latest.threaded ?? null, isolated: latest.isolated ?? null, timings }
  }
  const aggregateSpeeds = []
  let expectedSeconds = 0
  if (Number.isFinite(report.startedAt) && Number.isFinite(report.stoppedAt)) {
    const buckets = [...bySession.values()].map(samples => {
      const bySecond = new Map()
      for (const sample of samples) {
        const second = Math.round(sample.timestamp / 1000)
        const previous = bySecond.get(second)
        if (!previous || Math.abs(sample.timestamp - second * 1000) < Math.abs(previous.timestamp - second * 1000)) bySecond.set(second, sample)
      }
      return bySecond
    })
    for (let timestamp = (Math.floor(report.startedAt / 1000) + 1) * 1000; timestamp < report.stoppedAt; timestamp += 1000) {
      expectedSeconds += 1
      const aligned = buckets.map(bySecond => bySecond.get(timestamp / 1000))
      if (aligned.length && aligned.every(Boolean)) aggregateSpeeds.push(aligned.reduce((sum, sample) => sum + sample.speed, 0))
    }
  }
  return { players, aggregate: { medianSpeed: percentile(aggregateSpeeds, 0.5), p10Speed: percentile(aggregateSpeeds, 0.1), completeSeconds: aggregateSpeeds.length, expectedSeconds } }
}

export function createHubPerformanceRecorder({ browser, getFrames, now = () => Date.now(), warmupMs = 20_000, durationMs = 60_000 }) {
  const samples = createPerformanceSampleStore({ now })
  const parentTimings = createPerformanceTimingCollector()
  const ready = new Map()
  let expected = null
  let phase = 'waiting'
  let timer = null
  const membership = () => {
    const frames = [...getFrames()]
    if (frames.length !== 6) return null
    const members = new Map(frames.map(frame => [frame.closest('.player-cell')?.dataset.sessionId, frame.contentWindow]))
    return members.size === 6 && !members.has(undefined) ? members : null
  }
  const stable = () => {
    const live = membership()
    return live && expected && [...expected].every(([sessionId, source]) => live.get(sessionId) === source)
  }
  const reset = () => {
    if (timer !== null) browser.clearTimeout(timer)
    timer = null
    samples.stop()
    parentTimings.reset()
    ready.clear()
    expected = null
    phase = 'waiting'
  }
  const beginCapture = () => {
    timer = null
    if (!stable()) { reset(); return }
    parentTimings.reset()
    samples.start('automatic six-player run')
    phase = 'recording'
    timer = browser.setTimeout(() => {
      timer = null
      if (!stable()) { reset(); return }
      const result = samples.stop()
      phase = 'finished'
      const report = { ...result, parentTimings: parentTimings.snapshot(), summary: summarizePerformanceReport(result) }
      browser.console.log(`[emulator-performance] ${JSON.stringify({ startedAt: report.startedAt, stoppedAt: report.stoppedAt, sampleCount: report.samples.length, parentTimings: report.parentTimings, summary: report.summary })}`, report)
    }, durationMs)
  }
  browser.addEventListener('message', event => {
    const frames = [...getFrames()]
    if (!performanceSampleMatchesFrame(event, frames, browser.location.origin)) return
    const live = membership()
    if (!live) { if (phase !== 'waiting') reset(); return }
    if (expected && [...expected].some(([sessionId, source]) => live.get(sessionId) !== source)) reset()
    ready.set(event.data.sessionId, event.source)
    if (phase === 'recording') { samples.record(event.data); return }
    if (phase !== 'waiting' || ready.size !== 6) return
    expected = live
    phase = 'warming'
    timer = browser.setTimeout(beginCapture, warmupMs)
  })
  return {
    recordGamepad(durationMs) { if (samples.isActive()) parentTimings.record('gamepad', durationMs) },
    frameLoaded(sessionId) { if (ready.has(sessionId) || expected?.has(sessionId)) reset() },
  }
}
