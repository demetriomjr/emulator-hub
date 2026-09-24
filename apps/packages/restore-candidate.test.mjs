import assert from 'node:assert/strict'
import test from 'node:test'
import { getInstallationId, getInstallationIdentity, localCandidateSummary, remoteCandidateSummary, snapshotMatchesLaunch, snapshotUrlForKind, sortRestoreCandidates } from './restore-candidate.mjs'

const launch = { core: 'gba', romSha256: 'a'.repeat(64), runtimeId: 'emulatorjs-4.2.3' }

test('labels remote manual and recovery states without guessing the origin of legacy data', () => {
  const user = remoteCandidateSummary({ revision: 3, metadata: { ...launch, kind: 'user-state', reasonCode: 'user-request', capturedAt: '2026-09-24T12:00:00.000Z', saveRevision: 2, originInstallationId: 'installation-a' } }, { currentSaveRevision: 4, installationId: 'installation-a' })
  const legacy = remoteCandidateSummary({ revision: 2, metadata: { ...launch, kind: 'cloud-recovery', reasonCode: 'legacy-unknown', capturedAt: '2026-09-24T11:00:00.000Z', saveRevision: 1 } }, { currentSaveRevision: 4, installationId: 'installation-a' })
  assert.equal(user.candidateId, 'user:3')
  assert.equal(user.origin, 'this-installation')
  assert.equal(user.currentSaveRevision, 4)
  assert.equal(legacy.kind, 'cloud-recovery')
  assert.equal(legacy.origin, 'unknown')
  assert.equal(legacy.reasonCode, 'legacy-unknown')
  assert.equal('state' in user, false)
})

test('describes legacy local time as unknown and preserves compatibility checks', () => {
  const record = { ...launch, profileId: 'p', gameId: 'g', candidateId: 'local-1', reason: 'active', state: new Uint8Array([1]) }
  const summary = localCandidateSummary(record, { currentSaveRevision: 2 })
  assert.equal(summary.capturedAt, null)
  assert.equal(summary.reasonCode, 'possible-recovery')
  assert.equal('state' in summary, false)
  assert.equal(snapshotMatchesLaunch({ metadata: { ...launch } }, launch), true)
  assert.equal(snapshotMatchesLaunch({ metadata: { ...launch, patchSha256: 'b'.repeat(64) } }, launch), false)
})

test('sorts remote candidates by server time and uses separate typed URLs', () => {
  const candidates = sortRestoreCandidates([
    { candidateId: 'cloud:1', kind: 'cloud-recovery', capturedAt: '2026-09-24T10:00:00.000Z' },
    { candidateId: 'local-1', kind: 'local-recovery', capturedAt: null },
    { candidateId: 'user:1', kind: 'user-state', capturedAt: '2026-09-24T11:00:00.000Z' },
  ])
  assert.deepEqual(candidates.map(value => value.candidateId), ['user:1', 'cloud:1', 'local-1'])
  assert.equal(snapshotUrlForKind('/api/x/snapshot', 'cloud-recovery'), '/api/x/snapshot')
  assert.equal(snapshotUrlForKind('/api/x/snapshot', 'user-state'), '/api/x/snapshot?kind=user-state')
})

test('orders local and cloud recovery by their UTC capture time', () => {
  const local = { candidateId: 'local-2', kind: 'local-recovery', capturedAt: '2026-09-24T12:05:00.000Z' }
  const cloud = { candidateId: 'remote:4', kind: 'cloud-recovery', capturedAt: '2026-09-24T12:03:00.000Z' }
  assert.deepEqual(sortRestoreCandidates([cloud, local]).map(candidate => candidate.candidateId), ['local-2', 'remote:4'])
  assert.deepEqual(sortRestoreCandidates([{ ...cloud, capturedAt: '2026-09-24T12:08:00.000Z' }, local]).map(candidate => candidate.candidateId), ['remote:4', 'local-2'])
})

test('continues without an installation label when browser storage access is denied', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
  try { assert.equal(getInstallationId(), null) }
  finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  }
})

test('does not infer another device from a newly created installation ID', () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const first = getInstallationIdentity(storage)
  assert.equal(typeof first.id, 'string')
  assert.equal(first.comparisonId, null)
  const later = getInstallationIdentity(storage)
  assert.equal(later.id, first.id)
  assert.equal(later.comparisonId, first.id)
})
