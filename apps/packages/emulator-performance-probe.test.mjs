import assert from 'node:assert/strict'
import test from 'node:test'
import { createHubPerformanceRecorder, createPerformanceSampleStore, createPerformanceTimingCollector, measureSynchronousOperation, performanceSampleMatchesFrame, summarizePerformanceReport } from './emulator-performance-probe.mjs'

test('timing collector drains counts and durations without retaining earlier intervals', () => {
  const timings = createPerformanceTimingCollector()
  timings.record('getState.local', 8)
  timings.record('getState.local', 2)
  timings.record('getState.local', -1)
  timings.record('saveSaveFiles', 3)
  assert.equal(timings.snapshot()['getState.local'].totalMs, 10)
  assert.deepEqual(timings.drain(), {
    'getState.local': { count: 2, totalMs: 10, maxMs: 8 },
    saveSaveFiles: { count: 1, totalMs: 3, maxMs: 3 },
  })
  assert.deepEqual(timings.drain(), {})
  timings.record('gamepad', 2)
  timings.reset()
  assert.deepEqual(timings.snapshot(), {})
})

test('synchronous measurement preserves result and thrown error', () => {
  const timings = createPerformanceTimingCollector()
  let clock = 0
  const now = () => clock
  assert.equal(measureSynchronousOperation(timings, 'capture', () => { clock += 4; return 'state' }, now), 'state')
  const failure = new Error('capture failed')
  assert.throws(() => measureSynchronousOperation(timings, 'capture', () => { clock += 3; throw failure }, now), error => error === failure)
  assert.deepEqual(timings.drain(), { capture: { count: 2, totalMs: 7, maxMs: 4 } })
})

test('sample store records only during a trial and bounds memory', () => {
  const store = createPerformanceSampleStore({ maxSamples: 2, now: () => 100 })
  store.record({ sessionId: 's1', fps: 60, speed: 1, timestamp: 1 })
  assert.equal(store.export().samples.length, 0)
  store.start('six players')
  store.record({ sessionId: 's1', fps: 60, speed: 1, timestamp: 1 })
  store.record({ sessionId: 's2', fps: 120, speed: 2, timestamp: 2 })
  store.record({ sessionId: 's3', fps: 180, speed: 3, timestamp: 3 })
  const report = store.stop()
  assert.equal(report.label, 'six players')
  assert.equal(report.samples.length, 2)
  assert.deepEqual(report.samples.map(sample => sample.sessionId), ['s2', 's3'])
  store.record({ sessionId: 's4', fps: 240, speed: 4, timestamp: 4 })
  assert.equal(store.export().samples.length, 2)
  store.start('new trial')
  assert.equal(store.export().samples.length, 0)
})

test('sample store ignores malformed samples and exports detached copies', () => {
  const store = createPerformanceSampleStore()
  store.start('test')
  assert.equal(store.record({ sessionId: '', fps: 60, speed: 1, timestamp: 1 }), false)
  assert.equal(store.record({ sessionId: 's1', fps: 60, speed: Infinity, timestamp: 1 }), false)
  assert.equal(store.record({ sessionId: 's1', fps: 60, speed: 1, timestamp: 1, timings: { save: { count: 1, totalMs: 5, maxMs: 5 } } }), true)
  const exported = store.export()
  exported.samples[0].timings.save.totalMs = 999
  assert.equal(store.export().samples[0].timings.save.totalMs, 5)
})

test('parent accepts samples only from the matching live same-origin player iframe', () => {
  const source = {}
  const frame = { contentWindow: source, closest: () => ({ dataset: { sessionId: 's1' } }) }
  const event = { origin: 'https://hub.example', source, data: { type: 'emulator-hub:performance-sample', sessionId: 's1' } }
  assert.equal(performanceSampleMatchesFrame(event, [frame], 'https://hub.example'), true)
  assert.equal(performanceSampleMatchesFrame({ ...event, origin: 'https://evil.example' }, [frame], 'https://hub.example'), false)
  assert.equal(performanceSampleMatchesFrame({ ...event, data: { ...event.data, sessionId: 'other' } }, [frame], 'https://hub.example'), false)
  assert.equal(performanceSampleMatchesFrame({ ...event, source: {} }, [frame], 'https://hub.example'), false)
})

function automaticHarness() {
  let clock = 100_000
  let nextTimer = 1
  let receive
  const timers = new Map()
  const logs = []
  let frames = Array.from({ length: 6 }, (_, index) => {
    const contentWindow = {}
    const sessionId = `s${index}`
    return { contentWindow, closest: () => ({ dataset: { sessionId } }) }
  })
  const browser = {
    location: { origin: 'https://hub.example' },
    console: { log(...args) { logs.push(args) } },
    addEventListener(name, listener) { assert.equal(name, 'message'); receive = listener },
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { at: clock + delay, callback }); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  const recorder = createHubPerformanceRecorder({ browser, getFrames: () => frames, now: () => clock, warmupMs: 20_000, durationMs: 60_000 })
  const sample = (index, overrides = {}) => {
    const frame = frames[index]
    receive({ origin: browser.location.origin, source: frame.contentWindow, data: { type: 'emulator-hub:performance-sample', sessionId: frame.closest().dataset.sessionId, timestamp: clock, fps: 120, speed: 2, target: 5, threaded: true, isolated: true, ...overrides } })
  }
  const advance = milliseconds => {
    const end = clock + milliseconds
    while (true) {
      const due = [...timers.entries()].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= end)
      if (!due) break
      clock = due[1].at
      timers.delete(due[0])
      due[1].callback()
    }
    clock = end
  }
  return { sample, advance, recorder, logs, setFrames(value) { frames = value }, getFrames: () => frames }
}

test('six ready players automatically warm up, capture and log one report', () => {
  const runtime = automaticHarness()
  runtime.recorder.recordGamepad(1)
  for (let index = 0; index < 5; index++) runtime.sample(index)
  runtime.advance(20_000)
  assert.equal(runtime.logs.length, 0)
  for (let index = 0; index < 6; index++) runtime.sample(index)
  runtime.advance(19_000)
  for (let index = 0; index < 6; index++) runtime.sample(index)
  runtime.advance(1_000)
  runtime.recorder.recordGamepad(2)
  for (let index = 0; index < 6; index++) runtime.sample(index, index === 0 ? { timings: { 'getState.local': { count: 1, totalMs: 7, maxMs: 7 } } } : {})
  runtime.advance(59_000)
  for (let index = 0; index < 6; index++) runtime.sample(index)
  runtime.advance(1_000)
  assert.equal(runtime.logs.length, 1)
  assert.match(runtime.logs[0][0], /^\[emulator-performance\] \{/)
  const consoleSummary = JSON.parse(runtime.logs[0][0].slice('[emulator-performance] '.length))
  assert.equal(consoleSummary.summary.players.s0.medianSpeed, 2)
  assert.equal(consoleSummary.summary.players.s0.threaded, true)
  assert.equal(consoleSummary.summary.players.s0.isolated, true)
  assert.equal(consoleSummary.summary.players.s0.target, 5)
  assert.equal(consoleSummary.summary.players.s0.timings['getState.local'].totalMs, 7)
  assert.equal(runtime.logs[0][1].samples.length, 12)
  assert.equal(runtime.logs[0][1].parentTimings.gamepad.totalMs, 2)
  runtime.advance(60_000)
  assert.equal(runtime.logs.length, 1)
  assert.equal(runtime.recorder.recordGamepad(10), undefined)
})

test('a frame reload invalidates an in-progress six-player run', () => {
  const runtime = automaticHarness()
  for (let index = 0; index < 6; index++) runtime.sample(index)
  runtime.advance(19_000)
  runtime.recorder.frameLoaded('s1')
  runtime.advance(80_000)
  assert.equal(runtime.logs.length, 0)
  for (let index = 0; index < 6; index++) runtime.sample(index)
  runtime.advance(19_000)
  for (let index = 0; index < 6; index++) runtime.sample(index)
  runtime.advance(1_000)
  for (let index = 0; index < 6; index++) runtime.sample(index)
  runtime.advance(59_000)
  for (let index = 0; index < 6; index++) runtime.sample(index)
  runtime.advance(1_000)
  assert.equal(runtime.logs.length, 1)
})

test('replaced frame does not leave stale readiness blocking the next six-player run', () => {
  const runtime = automaticHarness()
  for (let index = 0; index < 5; index++) runtime.sample(index)
  const frames = runtime.getFrames()
  runtime.setFrames([{ contentWindow: {}, closest: () => ({ dataset: { sessionId: 'new' } }) }, ...frames.slice(1)])
  for (let index = 0; index < 6; index++) runtime.sample(index)
  runtime.advance(19_000)
  for (let index = 0; index < 6; index++) runtime.sample(index)
  runtime.advance(1_000)
  for (let index = 0; index < 6; index++) runtime.sample(index)
  runtime.advance(59_000)
  for (let index = 0; index < 6; index++) runtime.sample(index)
  runtime.advance(1_000)
  assert.equal(runtime.logs.length, 1)
})

test('a stalled ready player still produces a report with incomplete coverage', () => {
  const runtime = automaticHarness()
  for (let index = 0; index < 6; index++) runtime.sample(index)
  runtime.advance(20_000)
  for (let index = 0; index < 5; index++) runtime.sample(index)
  runtime.advance(60_000)
  assert.equal(runtime.logs.length, 1)
  assert.equal(runtime.logs[0][1].summary.aggregate.completeSeconds, 0)
})

test('trial summary reports per-player median and aligned aggregate coverage', () => {
  const report = {
    startedAt: 0, stoppedAt: 4000,
    samples: [
      { sessionId: 'a', timestamp: 1000, fps: 60, speed: 1 },
      { sessionId: 'b', timestamp: 1200, fps: 120, speed: 2 },
      { sessionId: 'a', timestamp: 2000, fps: 120, speed: 2 },
      { sessionId: 'b', timestamp: 2200, fps: 180, speed: 3 },
      { sessionId: 'a', timestamp: 3000, fps: 180, speed: 3 },
      { sessionId: 'b', timestamp: 3200, fps: 240, speed: 4 },
    ],
  }
  const summary = summarizePerformanceReport(report)
  assert.equal(summary.players.a.medianSpeed, 2)
  assert.equal(summary.players.b.medianSpeed, 3)
  assert.equal(summary.aggregate.medianSpeed, 5)
  assert.equal(summary.aggregate.completeSeconds, 3)
  assert.equal(summary.aggregate.expectedSeconds, 3)
})

test('one delayed sample cannot count as two complete aggregate seconds', () => {
  const summary = summarizePerformanceReport({
    startedAt: 0, stoppedAt: 3000,
    samples: [
      { sessionId: 'a', timestamp: 1500, speed: 2 },
      { sessionId: 'b', timestamp: 1000, speed: 2 },
      { sessionId: 'b', timestamp: 2000, speed: 2 },
    ],
  })
  assert.equal(summary.aggregate.completeSeconds, 1)
  assert.equal(summary.aggregate.expectedSeconds, 2)
})
