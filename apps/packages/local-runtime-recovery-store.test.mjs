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
