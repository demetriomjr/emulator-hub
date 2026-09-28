import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { projectPokemonHubDetailSource } from './pokemon-hub-card-hydration.mjs'

const location = slot => ({ kind: 'game', area: 'box', box: 0, slot })

test('hydrates every occupied source ID and marks only a corrupt record unavailable', () => {
  const good = Buffer.alloc(80)
  good.writeUInt16LE(25, 0x20)
  good.writeUInt16LE(25, 0x1c)
  const source = { profileId: 'p', sourceKey: 'save:p:g', sourceRevision: 4, saveRevision: 3, needsSaveFlush: false, placements: [
    { location: location(0), pokemonInstanceId: 'good' },
    { location: location(1), pokemonInstanceId: null },
    { location: location(2), pokemonInstanceId: 'bad' },
  ] }
  const records = new Map([
    ['good', record('good', location(0), good)],
    ['bad', record('bad', location(2), Buffer.alloc(80, 4))],
  ])
  const details = projectPokemonHubDetailSource({ source, records, title: 'pokemon-emerald' })
  assert.deepEqual(Object.keys(details).sort(), ['bad', 'good'])
  assert.equal(details.good.availability, 'ready')
  assert.equal(details.good.identity.species, 25)
  assert.equal(details.bad.availability, 'unavailable')
  assert.equal(details.bad.errorCode, 'GEN3_PARTY_CORE_CHECKSUM')
  assert.equal(JSON.stringify(details).includes('bytesBase64'), false)
})

test('rejects a record whose placement or SHA-256 differs from the source without hiding the other IDs', () => {
  const bytes = Buffer.alloc(80)
  bytes.writeUInt16LE(25, 0x20)
  bytes.writeUInt16LE(25, 0x1c)
  const source = { profileId: 'p', sourceKey: 'hub:h', sourceRevision: 2, placements: [
    { location: { kind: 'hub', hubProfileId: 'h', slot: 0 }, pokemonInstanceId: 'wrong' },
  ] }
  const wrong = record('wrong', { kind: 'hub', hubProfileId: 'h', slot: 1 }, bytes)
  const details = projectPokemonHubDetailSource({ source, records: new Map([['wrong', wrong]]) })
  assert.equal(details.wrong.errorCode, 'POKEMON_DETAIL_PLACEMENT_MISMATCH')
  wrong.placement.location.slot = 0
  wrong.representations[0].sha256 = 'bad'
  assert.equal(projectPokemonHubDetailSource({ source, records: new Map([['wrong', wrong]]) }).wrong.errorCode, 'POKEMON_DETAIL_HASH_MISMATCH')
})

test('uses physical Party HP only when core, location and save revision match a clean source', () => {
  const core = Buffer.alloc(80)
  core.writeUInt16LE(25, 0x20)
  core.writeUInt16LE(25, 0x1c)
  const partyBytes = Buffer.concat([core, Buffer.alloc(20)])
  partyBytes[84] = 20
  partyBytes.writeUInt16LE(30, 86)
  partyBytes.writeUInt16LE(40, 88)
  const partyLocation = { kind: 'game', area: 'party', slot: 0 }
  const source = { profileId: 'p', sourceKey: 'save:p:g', sourceRevision: 1, saveRevision: 4, needsSaveFlush: false, placements: [{ location: partyLocation, pokemonInstanceId: 'one' }] }
  const records = new Map([['one', record('one', partyLocation, core)]])
  const physicalSlots = new Map([['game:party:0', { record: { representation: { kind: 'party-record', bytes: partyBytes } } }]])
  const input = { source, records, title: 'pokemon-emerald', physicalSlots, physicalSaveRevision: 4 }
  assert.equal(projectPokemonHubDetailSource(input).one.training.partyRuntime.currentHp, 30)
  assert.equal(projectPokemonHubDetailSource({ ...input, physicalSaveRevision: 3 }).one.training.partyRuntime, null)
  assert.equal(projectPokemonHubDetailSource({ ...input, source: { ...source, needsSaveFlush: true } }).one.training.partyRuntime, null)
  const mismatched = Buffer.from(partyBytes)
  mismatched[0] = 9
  assert.equal(projectPokemonHubDetailSource({ ...input, physicalSlots: new Map([['game:party:0', { record: { representation: { kind: 'party-record', bytes: mismatched } } }]]) }).one.training.partyRuntime, null)
})

function record(id, location, bytes) {
  return { profileId: 'p', pokemonInstanceId: id, revision: 1, placement: { sourceKey: location.kind === 'hub' ? 'hub:h' : 'save:p:g', location }, representations: [{ adapter: 'gen3-gba-v1', kind: 'pc-record', bytesBase64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }] }
}
