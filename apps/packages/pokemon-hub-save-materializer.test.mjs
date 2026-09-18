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

test('materializes a Party reorder with the complete backend-native Party records', () => {
  const partyWrites = []
  const adapter = {
    id: 'gen3-gba-v1',
    readAllSlots: () => [
      { location: party(0), record: { representation: { kind: 'party-record', bytes: Buffer.alloc(100, 1) } } },
      { location: party(1), record: { representation: { kind: 'party-record', bytes: Buffer.alloc(100, 2) } } },
    ],
    writeSlot: () => { throw new Error('must not write') },
    writeParty(bytes, layout, records) {
      partyWrites.push({ layout, records })
      return Buffer.from(bytes)
    },
  }
  const source = {
    adapter: 'gen3-gba-v1',
    placements: [
      { location: party(0), pokemonInstanceId: 'party-2' },
      { location: party(1), pokemonInstanceId: 'party-1' },
    ],
  }
  const records = new Map([
    record('party-1', 'party-record', Buffer.alloc(100, 1)),
    record('party-2', 'party-record', Buffer.alloc(100, 2)),
  ])

  const result = materializePokemonHubSave({ adapter, layout: { party: { slots: 6 } }, bytes: Buffer.alloc(0x20000), source, records })

  assert.equal(result.changed, true)
  assert.deepEqual(partyWrites, [{ layout: { slots: 6 }, records: [Buffer.alloc(100, 2), Buffer.alloc(100, 1)] }])
})

test('writes the persistent Party core when a Party Pokemon moves into a Box', () => {
  const boxWrites = []
  const adapter = {
    id: 'gen3-gba-v1',
    readAllSlots: () => [
      { location: party(0), record: { representation: { kind: 'party-record', bytes: Buffer.alloc(100, 1) } } },
      { location: party(1), record: { representation: { kind: 'party-record', bytes: Buffer.alloc(100, 2) } } },
      { location: box(0), record: null },
    ],
    writeParty: bytes => Buffer.from(bytes),
    writeSlot(bytes, boxIndex, slot, replacement) {
      boxWrites.push({ boxIndex, slot, bytes: replacement?.bytes ?? null })
      return Buffer.from(bytes)
    },
  }
  const moved = Buffer.alloc(100, 3)
  const survivor = Buffer.alloc(100, 4)
  const source = {
    adapter: 'gen3-gba-v1',
    placements: [
      { location: party(0), pokemonInstanceId: 'party-survivor' },
      { location: box(0), pokemonInstanceId: 'party-moved' },
    ],
  }
  const records = new Map([
    record('party-moved', 'party-record', moved),
    record('party-survivor', 'party-record', survivor),
  ])

  const result = materializePokemonHubSave({ adapter, layout: { party: { slots: 6 } }, bytes: Buffer.alloc(0x20000), source, records })

  assert.equal(result.changed, true)
  assert.deepEqual(boxWrites, [{ boxIndex: 0, slot: 0, bytes: Buffer.alloc(80, 3) }])
})

test('materializes a complete Party record from an authoritative Box core without browser runtime bytes', () => {
  const partyWrites = []
  const boxWrites = []
  const core = Buffer.alloc(80, 8)
  const adapter = {
    id: 'gen3-gba-v1',
    readAllSlots: () => [
      { location: party(0), record: { representation: { kind: 'party-record', bytes: Buffer.alloc(100, 1) } } },
      { location: box(0), record: { representation: { kind: 'pc-record', bytes: core } } },
    ],
    writeSlot(bytes, boxIndex, slot, replacement) { boxWrites.push({ boxIndex, slot, replacement }); return Buffer.from(bytes) },
    writeParty(bytes, layout, records) { partyWrites.push(records); return Buffer.from(bytes) },
  }
  const source = {
    adapter: 'gen3-gba-v1',
    placements: [
      { location: party(0), pokemonInstanceId: 'box-1' },
      { location: box(0), pokemonInstanceId: null },
    ],
  }
  const records = new Map([record('box-1', 'pc-record', core)])

  const result = materializePokemonHubSave({
    adapter, layout: { party: { slots: 6 } }, bytes: Buffer.alloc(0x20000), source, records,
    materializePartyRecord: ({ boxCore }) => Buffer.concat([boxCore, Buffer.alloc(20, 9)]),
  })

  assert.equal(result.changed, true)
  assert.deepEqual(partyWrites, [[Buffer.concat([core, Buffer.alloc(20, 9)])]])
  assert.deepEqual(boxWrites, [{ boxIndex: 0, slot: 0, replacement: null }])
})
