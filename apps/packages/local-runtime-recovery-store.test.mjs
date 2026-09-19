import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalRuntimeRecoveryStore, createMemoryRecoveryStorage } from './local-runtime-recovery-store.mjs'

const bundle = () => ({
  profileId: 'may', gameId: 'emerald', core: 'gba', romSha256: 'a'.repeat(64), runtimeId: 'emulatorjs-4.2.3',
  state: new Uint8Array([1, 2, 3]), save: new Uint8Array([4, 5]),
})

test('persists a copied recovery bundle per profile and game', async () => {
  const store = createLocalRuntimeRecoveryStore({ storage: createMemoryRecoveryStorage() })
  const source = bundle()
  await store.put(source)
  source.state[0] = 9
  const loaded = await store.get('may', 'emerald')
  loaded.save[0] = 8
  assert.deepEqual([...loaded.state], [1, 2, 3])
  assert.deepEqual([...(await store.get('may', 'emerald')).save], [4, 5])
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
