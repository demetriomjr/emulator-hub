import { findGen3EncounterLayout, gen3StateOffset, stateMatches } from './pokemon-gen3-encounter.mjs'
export const nextRng = value => (Math.imul(value, 0x41c64e6d) + 0x6073) >>> 0
export function readRngSnapshot(manager, descriptor) {
  const layout = findGen3EncounterLayout(descriptor)
  if (layout?.gameCode !== 'BPEE') throw new Error('unsupported-rng-layout')
  const frame = manager?.getFrameNum?.()
  const bytes = manager?.getState?.()
  if (!Number.isSafeInteger(frame) || frame < 0 || !stateMatches(bytes, layout)) throw new Error('rng-state-unavailable')
  const offset = gen3StateOffset(0x03005d80)
  return { frame, rngValue: new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true) }
}
export function createRngResetObserver({ getManager, getDescriptor, emit, now = () => performance.now(), timeoutMs = 2000, maxFrames = 120, pollMs = 8, enabled = true } = {}) {
  let active = null
  let sequence = 0
  function publish(event) { try { emit(event) } catch {} }
  function detach(record) {
    clearTimeout(record.timer); clearInterval(record.poll)
    try { if (record.hook && record.module?.postMainLoop === record.hook) record.module.postMainLoop = record.previousHook } catch {}
  }
  function cancel() {
    if (!active) return
    detach(active); active = null
  }
  function finish() {
    if (!active) return
    const record = active
    active = null; detach(record)
    const seed = record.candidate?.confirmed ? record.candidate.value : null
    publish({ ...record.context, kind: 'rng-reset', message: 'hunt.rng-reset', method: 'main-loop-and-frame-poll',
      before: record.before, after: record.samples.at(-1) ?? null, rngValue: record.samples.at(-1)?.rngValue ?? null,
      samples: seed === null ? record.samples : [...record.candidate.samples, ...record.samples.filter(item => !record.candidate.samples.some(proof => proof.frame === item.frame)).slice(-12)], seed, seedFrame: seed === null ? null : record.candidate.frame,
      seedEvidence: seed === null ? 'not-observed' : 'observed-reseed-lcg',
      status: seed !== null ? 'observed' : record.samples.length ? 'missed-window' : 'unavailable',
      reason: seed !== null ? '16-bit-reseed-followed-by-three-consecutive-lcg-frames' : record.reason ?? 'initial-seed-window-not-observed',
      framesSkipped: record.skipped, commandFrame: record.before?.frame ?? null, releasedFrame: record.releasedFrame ?? null,
      durationMs: Math.max(0, now() - record.start),
      sampleCount: record.sampleCount, readDurationMs: record.readDurationMs, maxReadDurationMs: record.maxReadDurationMs,
    })
  }
  function sample(record) {
    if (active !== record) return
    try {
      // Avoid serializing a state twice at the same frame.
      const currentFrame = record.manager.getFrameNum()
      if (currentFrame === record.last?.frame) return
      const readStart = now()
      const current = readRngSnapshot(record.manager, record.descriptor)
      const readDuration = Math.max(0, now() - readStart)
      record.sampleCount += 1
      record.readDurationMs += readDuration
      record.maxReadDurationMs = Math.max(record.maxReadDurationMs, readDuration)
      const previous = record.last
      const gap = previous ? current.frame - previous.frame : 0
      if (gap > 1) record.skipped += gap - 1
      let expected = previous?.rngValue
      if (gap > 0 && gap <= maxFrames) for (let i = 0; i < gap; i++) expected = nextRng(expected)
      const continuesLcg = gap > 0 && gap <= maxFrames && current.rngValue === expected
      // RAM initialization can expose zero before the RTC patch runs. A later
      // discontinuity invalidates that proof, including when its seed frame was missed.
      if (record.candidate?.confirmed && !continuesLcg) {
        record.candidate = null
        record.reason = 'later-rng-discontinuity'
      }
      if (previous && gap === 1 && current.rngValue !== nextRng(previous.rngValue) && current.rngValue <= 0xffff) {
        record.candidate = { value: current.rngValue, frame: current.frame, consecutive: 0, confirmed: false, samples: [current] }
      } else if (record.candidate && !record.candidate.confirmed) {
        if (gap === 1 && current.rngValue === nextRng(previous.rngValue)) {
          record.candidate.consecutive += 1
          record.candidate.samples.push(current)
          if (record.candidate.consecutive >= 3) record.candidate.confirmed = true
        } else record.candidate = null
      }
      record.last = current
      record.samples.push(current)
      if (record.samples.length > 16) record.samples.shift()
      if (record.before && current.frame - record.before.frame >= maxFrames) finish()
    } catch (error) { record.reason = String(error.message ?? 'rng-read-failed').slice(0, 256) }
  }
  return {
    arm(context) {
      cancel()
      if (!enabled) return
      context = { ...context, eventId: globalThis.crypto?.randomUUID?.() ?? String(++sequence) }
      let descriptor; let manager
      try { descriptor = getDescriptor(); manager = getManager() }
      catch {
        publish({ ...context, kind: 'rng-reset', message: 'hunt.rng-reset', status: 'unavailable', seed: null, samples: [], reason: 'runtime-context-unavailable' })
        return
      }
      if (findGen3EncounterLayout(descriptor)?.gameCode !== 'BPEE') {
        publish({ ...context, kind: 'rng-reset', message: 'hunt.rng-reset', status: 'unsupported', seed: null, samples: [], reason: 'unsupported-rng-layout' })
        return
      }
      const record = { context, manager, descriptor, start: now(), before: null, last: null, samples: [], sampleCount: 0, readDurationMs: 0, maxReadDurationMs: 0, skipped: 0, candidate: null, reason: null, module: manager?.Module }
      try { record.before = record.last = readRngSnapshot(manager, descriptor) } catch { record.reason = 'baseline-unavailable' }
      active = record
      if (record.module) {
        record.previousHook = record.module.postMainLoop
        record.hook = function (...args) {
          try { return record.previousHook?.apply(this, args) }
          finally { sample(record) }
        }
        try { record.module.postMainLoop = record.hook } catch { record.hook = null }
      }
      record.poll = setInterval(() => sample(record), pollMs)
      record.timer = setTimeout(finish, timeoutMs)
    },
    released() { if (active) { try { active.releasedFrame = active.manager.getFrameNum() } catch {} } },
    finish, cancel,
    setEnabled(value) { enabled = value === true; if (!enabled) cancel() },
    get active() { return active !== null },
  }
}
