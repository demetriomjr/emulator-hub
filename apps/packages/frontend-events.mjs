export const frontendEventEndpoint = '/_frontend/events'
const kinds = new Set(['uncaught-error', 'unhandled-rejection', 'network-error', 'emulator-failure', 'emulator-frame-stall', 'emulator-lifecycle', 'odds-manipulator', 'snapshot-flow', 'shiny-hunt', 'rng-reset', 'rng-encounter', 'game-asset'])
const strings = {
  message: 512, name: 128, stack: 2048, page: 512, userAgent: 512, gameId: 256, profileId: 128,
  eventId: 128, huntId: 128, runtimeId: 128, romSha256: 64, patchSha256: 64, resetType: 32,
  level: 8, reason: 256, method: 64, seedEvidence: 64,
  snapshotKind: 32, candidateId: 128, phase: 64, code: 128, error: 512,
  effectiveRomSha256: 64, assetSha256: 64, assetSource: 16,
}
const integers = ['cycleId', 'oddsResetCount', 'virtualTimestamp', 'dateNow', 'frame', 'commandFrame', 'releasedFrame', 'seedFrame', 'framesSkipped', 'droppedEvents', 'attemptCount', 'revision', 'saveRevision', 'candidateCount', 'sampleCount', 'assetBytes']
const booleans = ['enabled', 'managerReady', 'pending', 'threaded', 'fastForward', 'patchApplied', 'shiny']
const uint32 = ['rngValue', 'pid']

export function normalizeFrontendEvent(input, now = () => new Date().toISOString()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('invalid-event')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.sessionId ?? '') || !['hub', 'player'].includes(input.source) || !kinds.has(input.kind)) throw new TypeError('invalid-event')
  const result = { schemaVersion: 1, receivedAt: now(), source: input.source, sessionId: input.sessionId, kind: input.kind }
  for (const [key, max] of Object.entries(strings)) {
    if (input[key] === undefined || input[key] === null) continue
    if (typeof input[key] !== 'string' || input[key].length > max) throw new TypeError(`invalid-${key}`)
    result[key] = key === 'page' ? input[key].split(/[?#]/)[0] : input[key]
  }
  for (const key of integers) if (input[key] !== undefined && input[key] !== null) result[key] = integer(input[key])
  for (const key of booleans) if (input[key] !== undefined) {
    if (typeof input[key] !== 'boolean') throw new TypeError(`invalid-${key}`)
    result[key] = input[key]
  }
  for (const key of uint32) if (input[key] !== undefined && input[key] !== null) result[key] = integer(input[key], 0xffffffff)
  if (input.status !== undefined) {
    if (typeof input.status === 'number') result.status = integer(input.status, 599)
    else if (['observed', 'unavailable', 'missed-window', 'unsupported'].includes(input.status)) result.status = input.status
    else throw new TypeError('invalid-status')
  }
  if (input.kind === 'rng-reset') {
    result.seed = input.seed === undefined || input.seed === null ? null : integer(input.seed, 0xffff)
    if (input.samples !== undefined) {
      if (!Array.isArray(input.samples) || input.samples.length > 16) throw new TypeError('invalid-samples')
      result.samples = input.samples.map(sample)
    }
    for (const key of ['before', 'after']) if (input[key] !== undefined && input[key] !== null) result[key] = sample(input[key])
  }
  for (const key of ['durationMs', 'readDurationMs', 'maxReadDurationMs']) if (input[key] !== undefined) {
    if (!Number.isFinite(input[key]) || input[key] < 0) throw new TypeError('invalid-duration')
    result[key] = Math.round(input[key] * 100) / 100
  }
  if (input.request) {
    if (typeof input.request.path !== 'string' || input.request.path.length > 512 || !/^[A-Z]{3,10}$/.test(input.request.method)) throw new TypeError('invalid-request')
    result.request = { path: input.request.path.split(/[?#]/)[0], method: input.request.method }
    if (input.request.status !== undefined) result.request.status = integer(input.request.status, 599)
  }
  if (input.viewport) result.viewport = { width: integer(input.viewport.width), height: integer(input.viewport.height) }
  return result
}
function integer(value, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new TypeError('invalid-integer')
  return value
}
function sample(value) { return { frame: integer(value.frame), rngValue: integer(value.rngValue, 0xffffffff) } }

export function handleFrontendEventRequest({ method, contentType, origin, host, body, bodyBytes }, now) {
  const reject = status => ({ status, json: null })
  if (method !== 'POST') return reject(405)
  if (!/^application\/json(?:\s*;|$)/i.test(contentType ?? '')) return reject(415)
  if (origin && (!/^https?:\/\/[^/?#]+$/i.test(origin) || origin.replace(/^https?:\/\//i, '').toLowerCase() !== String(host).toLowerCase())) return reject(403)
  try {
    if ((bodyBytes ?? encodeURIComponent(body ?? '').replace(/%[A-Fa-f0-9]{2}/g, 'x').length) > 16384) return reject(413)
    return { status: 204, json: JSON.stringify(normalizeFrontendEvent(JSON.parse(body), now)) }
  } catch { return reject(400) }
}
