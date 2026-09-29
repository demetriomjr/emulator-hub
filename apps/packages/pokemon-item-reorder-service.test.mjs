import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonItemReorderService } from './pokemon-item-reorder-service.mjs'

const request = { profileId: 'workspace', sessionId: 'session-a', gameId: 'pokemon-emerald', sourceProfileId: 'may', area: 'items', fromSlot: 0, toSlot: 2, expectedSaveRevision: 4 }

function harness({ flushChangesSave = false, noChange = false, concurrentSaveChange = false } = {}) {
  const calls = []
  let stored = { bytes: Buffer.from([1]), revision: 4, fenceGeneration: 7 }
  const service = createPokemonItemReorderService({
    sessions: { async withLoadedSource(input) { calls.push('session'); assert.equal(input.sourceKey, 'save:may:pokemon-emerald'); return input.run({ sourceKey: input.sourceKey }) } },
    gameSaveLeases: { async assertHub(input) { calls.push('lease'); assert.deepEqual(input, { profileId: 'may', gameId: 'pokemon-emerald', workspaceId: 'session-a' }) } },
    saveStore: {
      async get() { calls.push(`read:${stored.revision}`); return stored },
      async put(_profileId, _gameId, bytes, revision, options) {
        calls.push(`put:${revision}:${bytes[0]}`)
        assert.equal(revision, stored.revision)
        assert.equal(options.fenceGeneration, 7)
        assert.equal(options.invalidateRuntimeStates, true)
        await options.beforeCommit()
        stored = { ...stored, bytes, revision: revision + 1 }
        return stored
      },
    },
    saveFlush: { async flushSource() { calls.push('flush'); if (flushChangesSave || concurrentSaveChange) stored = { ...stored, bytes: Buffer.from([2]), revision: stored.revision + 1 }; return { status: flushChangesSave ? 'flushed' : 'clean' } } },
    snapshotCoordinator: {
      async getSaveFlushPlan() { calls.push('plan'); return { source: { sourceRevision: 8 } } },
      async markSaveFlushed(input) { calls.push(`mark:${input.saveRevision}`); assert.equal(input.sourceRevision, 8) },
    },
    snapshotStore: { async delete() { calls.push('snapshot-delete') } },
    resolveSaveSource: async () => ({ gameId: 'pokemon-emerald', sourceProfileId: 'may', layout: { pokemonSaveTitle: 'pokemon-emerald' } }),
    reorder: (bytes, _title, move) => { calls.push(`reorder:${bytes[0]}`); assert.deepEqual(move, { area: 'items', fromSlot: 0, toSlot: 2 }); return { saveBytes: Buffer.from([bytes[0] + 1]), changed: !noChange, area: 'items', fromSlot: 0, toSlot: 2 } },
    readInventory: bytes => ({ title: 'pokemon-emerald', areas: { items: { marker: bytes[0] } } }),
  })
  return { service, calls, getStored: () => stored }
}

test('flushes pending Pokémon first, then reorders the current save and advances the canonical revision', async () => {
  const { service, calls, getStored } = harness({ flushChangesSave: true })
  const result = await service.reorder(request)
  assert.deepEqual(result, { changed: true, area: 'items', fromSlot: 0, toSlot: 2,
    itemInventory: { status: 'ready', saveRevision: 6, title: 'pokemon-emerald', areas: { items: { marker: 3 } } } })
  assert.equal(getStored().bytes[0], 3)
  assert.deepEqual(calls, ['session', 'lease', 'read:4', 'reorder:1', 'flush', 'lease', 'read:5', 'reorder:2', 'put:5:3', 'lease', 'plan', 'mark:6', 'snapshot-delete'])
})

test('rejects an old save revision before flushing or writing, so replay cannot undo a swap', async () => {
  const { service, calls } = harness()
  await assert.rejects(() => service.reorder({ ...request, expectedSaveRevision: 3 }), { code: 'SAVE_ITEM_REVISION_CONFLICT' })
  assert.deepEqual(calls, ['session', 'lease', 'read:4'])
})

test('a no-op does not flush or write the save', async () => {
  const { service, calls } = harness({ noChange: true })
  const result = await service.reorder(request)
  assert.equal(result.changed, false)
  assert.equal(result.itemInventory.saveRevision, 4)
  assert.deepEqual(calls, ['session', 'lease', 'read:4', 'reorder:1'])
})

test('rejects an unrelated save change during the Pokémon flush window', async () => {
  const { service, calls } = harness({ concurrentSaveChange: true })
  await assert.rejects(() => service.reorder(request), { code: 'SAVE_ITEM_REVISION_CONFLICT' })
  assert.equal(calls.some(call => call.startsWith('put:')), false)
})

test('transfers an item between two loaded trade-compatible saves in one pair write', async () => {
  const calls = []
  const sources = {
    'save:may:ruby': { bytes: Buffer.from([10]), revision: 3, fenceGeneration: 0 },
    'save:brendan:sapphire': { bytes: Buffer.from([20]), revision: 5, fenceGeneration: 0 },
  }
  const service = createPokemonItemReorderService({
    sessions: {
      async withLoadedSource() {},
      async withLoadedSources({ sourceKeys, run }) { calls.push('session'); assert.deepEqual(sourceKeys, Object.keys(sources)); return run(sourceKeys.map(sourceKey => ({ sourceKey }))) },
    },
    gameSaveLeases: { async assertHub({ profileId }) { calls.push(`lease:${profileId}`) } },
    saveStore: {
      async get(profileId, gameId) { return sources[`save:${profileId}:${gameId}`] },
      async put() {},
      async putPair(entries, { beforeCommit }) {
        calls.push('pair-write')
        await beforeCommit()
        return entries.map(entry => {
          const key = `save:${entry.profileId}:${entry.gameId}`
          sources[key] = { ...sources[key], bytes: entry.bytes, revision: sources[key].revision + 1 }
          return sources[key]
        })
      },
    },
    saveFlush: { async flushSource() { calls.push('flush'); return { status: 'clean' } } },
    snapshotCoordinator: { async getSaveFlushPlan() { return { source: { needsSaveFlush: false, sourceRevision: 2 } } }, async markSaveFlushed() {} },
    snapshotStore: { async delete() {} },
    resolveSaveSource: async ({ sourceKey }) => {
      const [, sourceProfileId, gameId] = sourceKey.split(':')
      return { sourceProfileId, gameId, layout: { pokemonSaveTitle: gameId === 'ruby' ? 'pokemon-ruby' : 'pokemon-sapphire' },
        adapter: { inspect() { return { transferCapabilities: { ordinaryTradeReady: true, nationalDexUnlocked: false } } } } }
    },
    transferItems: (_source, _sourceTitle, _destination, _destinationTitle, move) => {
      assert.deepEqual(move, { area: 'items', fromSlot: 0, quantity: 1 })
      return { sourceSaveBytes: Buffer.from([9]), destinationSaveBytes: Buffer.from([21]), itemKey: 'potion', quantity: 1, maxQuantity: 5 }
    },
    readInventory: bytes => ({ title: 'test', areas: { items: { count: bytes[0] } } }),
  })
  const result = await service.transfer({ profileId: 'workspace', sessionId: 'session-a',
    source: { gameId: 'ruby', profileId: 'may', expectedSaveRevision: 3 },
    destination: { gameId: 'sapphire', profileId: 'brendan', expectedSaveRevision: 5 }, area: 'items', fromSlot: 0, quantity: 1 })
  assert.equal(result.itemKey, 'potion')
  assert.equal(result.sourceItemInventory.saveRevision, 4)
  assert.equal(result.destinationItemInventory.saveRevision, 6)
  assert.equal(calls.filter(call => call === 'pair-write').length, 1)
})
