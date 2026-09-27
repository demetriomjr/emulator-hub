import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectGen3Encounter, findGen3EncounterLayout } from './pokemon-gen3-encounter.mjs'

const playerAddress = 0x03004360
const enemyAddress = 0x030045c0

function stateOffset(address) {
  return address >= 0x03000000
    ? 0x10 + 0x19000 + (address - 0x03000000)
    : 0x10 + 0x21000 + (address - 0x02000000)
}

function makeState() {
  const state = new Uint8Array(528472)
  state.set([82, 65, 83, 84, 65, 84, 69, 1], 0)
  new DataView(state.buffer).setUint32(0x10, 0x01000007, true)
  state.set([65, 88, 86, 69], 0x2c)
  return state
}

function writeMon(state, address, { pid, otid = 0, species = 25, validChecksum = true }) {
  const start = stateOffset(address)
  const view = new DataView(state.buffer)
  view.setUint32(start, pid, true)
  view.setUint32(start + 4, otid, true)
  const order = [
    'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA',
    'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
    'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG',
    'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG',
  ][pid % 24]
  const plain = new Uint8Array(48)
  new DataView(plain.buffer).setUint16(order.indexOf('G') * 12, species, true)
  let checksum = 0
  const plainView = new DataView(plain.buffer)
  for (let offset = 0; offset < 48; offset += 2) checksum = (checksum + plainView.getUint16(offset, true)) & 0xffff
  view.setUint16(start + 28, validChecksum ? checksum : checksum ^ 1, true)
  const key = pid ^ otid
  for (let offset = 0; offset < 48; offset += 4) view.setUint32(start + 32 + offset, (plainView.getUint32(offset, true) ^ key) >>> 0, true)
}

const layout = { enemyAddress, playerAddress, gameCode: 'AXVE' }

test('reads the enemy party and ignores a shiny in the player party', () => {
  const state = makeState()
  writeMon(state, playerAddress, { pid: 1 })
  writeMon(state, enemyAddress, { pid: 8, species: 150 })
  assert.deepEqual(inspectGen3Encounter(state, layout), { status: 'normal', species: 150, pid: 8, otid: 0 })
})

test('reports a shiny from the enemy party without requiring Rayquaza species', () => {
  const state = makeState()
  writeMon(state, playerAddress, { pid: 8 })
  writeMon(state, enemyAddress, { pid: 1, species: 25 })
  assert.deepEqual(inspectGen3Encounter(state, layout), { status: 'shiny', species: 25, pid: 1, otid: 0 })
})

test('decodes a growth block outside the first slot', () => {
  const state = makeState()
  writeMon(state, enemyAddress, { pid: 15, species: 25 })
  assert.deepEqual(inspectGen3Encounter(state, layout), { status: 'normal', species: 25, pid: 15, otid: 0 })
})

test('waits for an enemy created after this cycle begins', () => {
  const state = makeState()
  assert.deepEqual(inspectGen3Encounter(state, layout), { status: 'pending' })
  writeMon(state, enemyAddress, { pid: 1 })
  const baselineEnemy = state.slice(stateOffset(enemyAddress), stateOffset(enemyAddress) + 80)
  assert.deepEqual(inspectGen3Encounter(state, { ...layout, baselineEnemy }), { status: 'pending' })
})

test('rejects an invalid enemy record instead of resetting as normal', () => {
  const state = makeState()
  writeMon(state, enemyAddress, { pid: 8, validChecksum: false })
  assert.deepEqual(inspectGen3Encounter(state, layout), { status: 'error', reason: 'invalid-enemy-record' })
})

test('rejects a state from another game code', () => {
  const state = makeState()
  writeMon(state, enemyAddress, { pid: 1 })
  assert.deepEqual(inspectGen3Encounter(state, { ...layout, gameCode: 'BPEE' }), { status: 'error', reason: 'state-mismatch' })
})

test('finds enemy and player addresses by the verified ROM identity', () => {
  assert.deepEqual(findGen3EncounterLayout({ romSha256: '0fdd36e92b75bed65d09df4635ab0b707b288c2bf1dc4c6e7a4a4f0eebe9d64c', core: 'gba', runtimeId: 'emulatorjs-4.2.3' }), layout)
  assert.equal(findGen3EncounterLayout({ romSha256: 'unknown', core: 'gba', runtimeId: 'emulatorjs-4.2.3' }), null)
})
