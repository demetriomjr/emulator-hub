import assert from 'node:assert/strict'
import test from 'node:test'

import { materializePokemonHubSave } from './pokemon-hub-save-materializer.mjs'

const party = slot => ({ kind: 'game', area: 'party', slot })
const box = slot => ({ kind: 'game', area: 'box', box: 0, slot })

function record(id, kind, bytes) {
  return [id, { pokemonInstanceId: id, representations: [{ adapter: 'gen3-gba-v1', kind, bytesBase64: Buffer.from(bytes).toString('base64') }] }]
}

test('materializes an authoritative Box-to-Box move using backend-native bytes', () => {
  const writes = []
  const adapter = {
    id: 'gen3-gba-v1',
    readAllSlots: () => [
      { location: party(0), record: { representation: { kind: 'party-record', bytes: Buffer.alloc(100, 1) } } },
      { location: box(0), record: { representation: { kind: 'pc-record', bytes: Buffer.alloc(80, 7) } } },
      { location: box(1), record: null },
    ],
    writeSlot(bytes, boxIndex, slot, replacement) {
      writes.push({ boxIndex, slot, bytes: replacement?.bytes ?? null })
      return Buffer.from(bytes)
    },
  }
  const source = {
    adapter: 'gen3-gba-v1',
    placements: [
      { location: party(0), pokemonInstanceId: 'party-1' },
      { location: box(0), pokemonInstanceId: null },
      { location: box(1), pokemonInstanceId: 'box-1' },
    ],
  }
  const records = new Map([
    record('party-1', 'party-record', Buffer.alloc(100, 1)),
    record('box-1', 'pc-record', Buffer.alloc(80, 7)),
  ])

  const result = materializePokemonHubSave({ adapter, layout: {}, bytes: Buffer.alloc(0x20000), source, records })

  assert.equal(result.changed, true)
  assert.deepEqual(writes, [
    { boxIndex: 0, slot: 0, bytes: null },
    { boxIndex: 0, slot: 1, bytes: Buffer.alloc(80, 7) },
  ])
})

test('refuses a Party placement change rather than writing an unverified Party representation', () => {
  const adapter = {
    id: 'gen3-gba-v1',
    readAllSlots: () => [{ location: party(0), record: { representation: { kind: 'party-record', bytes: Buffer.alloc(100, 1) } } }],
    writeSlot: () => { throw new Error('must not write') },
  }
  const source = { adapter: 'gen3-gba-v1', placements: [{ location: party(0), pokemonInstanceId: null }] }

  assert.throws(() => materializePokemonHubSave({ adapter, layout: {}, bytes: Buffer.alloc(0x20000), source, records: new Map() }), error => error.code === 'SAVE_MATERIALIZATION_UNSUPPORTED')
})
