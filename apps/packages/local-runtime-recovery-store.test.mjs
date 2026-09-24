import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalRuntimeRecoveryStore, createMemoryRecoveryStorage } from './local-runtime-recovery-store.mjs'

const bundle = () => ({
  profileId: 'may', gameId: 'emerald', core: 'gba', romSha256: 'a'.repeat(64), runtimeId: 'emulatorjs-4.2.3',
  state: new Uint8Array([1, 2, 3]), save: new Uint8Array([4, 5]),
})

test('persists copied recovery state per profile and game, ignoring legacy paired save bytes', async () => {
  const store = createLocalRuntimeRecoveryStore({ storage: createMemoryRecoveryStorage() })
  const source = bundle()
  await store.put(source)
  source.state[0] = 9
  const loaded = await store.get('may', 'emerald')
  assert.deepEqual([...loaded.state], [1, 2, 3])
  assert.equal('save' in loaded, false)
  assert.equal('save' in (await store.get('may', 'emerald')), false)
  assert.equal(await store.get('leaf', 'emerald'), null)
})

test('marks interruptions and clears only the matching recovery record', async () => {
  const store = createLocalRuntimeRecoveryStore({ storage: createMemoryRecoveryStorage() })
  await store.put(bundle())
  await store.put({ ...bundle(), profileId: 'leaf' })
  await store.markRuntimeBreak('may', 'emerald')
  assert.equal((await store.get('may', 'emerald')).reason, 'runtime-break')
  await store.clear('may', 'emerald')
  assert.equal(await store.get('may', 'emerald'), null)
  assert.equal((await store.get('leaf', 'emerald')).reason, 'active')
})

test('deletes only the selected local candidate and preserves a replacement', async () => {
  const store = createLocalRuntimeRecoveryStore({ storage: createMemoryRecoveryStorage() })
  await store.put(bundle())
  const first = await store.get('may', 'emerald')
  assert.equal(typeof first.candidateId, 'string')
  await store.put({ ...bundle(), state: new Uint8Array([9]) })
  const replacement = await store.get('may', 'emerald')
  assert.notEqual(replacement.candidateId, first.candidateId)
  assert.equal(await store.deleteIfMatches('may', 'emerald', first.candidateId), false)
  assert.deepEqual([...((await store.get('may', 'emerald')).state)], [9])
  assert.equal(await store.deleteIfMatches('may', 'emerald', replacement.candidateId), true)
  assert.equal(await store.get('may', 'emerald'), null)
})

test('assigns an identity to a legacy local record before conditional deletion', async () => {
  const storage = createMemoryRecoveryStorage()
  const store = createLocalRuntimeRecoveryStore({ storage })
  await storage.put('may\u0000emerald', bundle())
  const migrated = await store.get('may', 'emerald')
  assert.equal(typeof migrated.candidateId, 'string')
  assert.equal((await store.get('may', 'emerald')).candidateId, migrated.candidateId)
  assert.equal(await store.deleteIfMatches('may', 'emerald', migrated.candidateId), true)
  assert.equal(await store.get('may', 'emerald'), null)
})

test('records capture time for new local recovery without inventing one for legacy data', async () => {
  const storage = createMemoryRecoveryStorage()
  const store = createLocalRuntimeRecoveryStore({ storage })
  const bundle = { profileId: 'p', gameId: 'g', core: 'gba', romSha256: 'a'.repeat(64), runtimeId: 'emulatorjs-4.2.3', state: new Uint8Array([1]) }
  await store.put(bundle)
  const current = await store.get('p', 'g')
  assert.ok(Number.isFinite(Date.parse(current.capturedAt)))
  await storage.put('p\u0000g', { ...bundle, reason: 'active' })
  const legacy = await store.get('p', 'g')
  assert.equal(legacy.capturedAt, undefined)
})
