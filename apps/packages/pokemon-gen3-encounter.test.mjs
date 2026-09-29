import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectGen3BattlePhase, inspectGen3Encounter, findGen3EncounterLayout } from './pokemon-gen3-encounter.mjs'

const playerAddress = 0x03004360
const enemyAddress = 0x030045c0

function stateOffset(address) {
  return address >= 0x03000000
    ? 0x10 + 0x19000 + (address - 0x03000000)
    : 0x10 + 0x21000 + (address - 0x02000000)
}

function makeState(gameCode = 'AXVE') {
  const state = new Uint8Array(528472)
  state.set([82, 65, 83, 84, 65, 84, 69, 1], 0)
  new DataView(state.buffer).setUint32(0x10, 0x01000007, true)
  state.set(Buffer.from(gameCode), 0x2c)
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
  assert.deepEqual(findGen3EncounterLayout({ romSha256: '0fdd36e92b75bed65d09df4635ab0b707b288c2bf1dc4c6e7a4a4f0eebe9d64c', core: 'gba', runtimeId: 'emulatorjs-4.2.3' }), { ...layout, battleFlag: { main: 0x03001770, inBattleOffset: 0x43d } })
  assert.equal(findGen3EncounterLayout({ romSha256: 'unknown', core: 'gba', runtimeId: 'emulatorjs-4.2.3' }), null)
})

const kantoRevisions = [
  ['FireRed rev1', '729041b940afe031302d630fdbe57c0c145f3f7b6d9b8eca5e98678d0ca4d059', 'BPRE'],
  ['LeafGreen rev1', '2f978f635b9593f6ca26ec42481c53a6b39f6cddd894ad5c062c1419fac58825', 'BPGE'],
]

for (const [title, romSha256, gameCode] of kantoRevisions) {
  test(`${title} uses its verified ROM identity and reads the enemy in battle`, () => {
    const identity = { romSha256, core: 'gba', runtimeId: 'emulatorjs-4.2.3' }
    const selected = findGen3EncounterLayout(identity)
    const expected = { playerAddress: 0x02024284, enemyAddress: 0x0202402c, gameCode, battleFlag: { main: 0x030030f0, inBattleOffset: 0x439 } }
    assert.deepEqual(selected, expected)
    assert.equal(findGen3EncounterLayout({ ...identity, patchSha256: 'a'.repeat(64) }), null)
    assert.equal(findGen3EncounterLayout({ ...identity, runtimeId: 'another-runtime' }), null)

    const state = makeState(gameCode)
    writeMon(state, selected.playerAddress, { pid: 1, species: 25 })
    writeMon(state, selected.enemyAddress, { pid: 8, species: 145 })
    assert.deepEqual(inspectGen3Encounter(state, selected), { status: 'pending' })
    assert.deepEqual(inspectGen3BattlePhase(state, selected), { status: 'map' })

    state[stateOffset(selected.battleFlag.main + selected.battleFlag.inBattleOffset)] = 2
    assert.deepEqual(inspectGen3BattlePhase(state, selected), { status: 'battle' })
    assert.deepEqual(inspectGen3Encounter(state, selected), { status: 'normal', species: 145, pid: 8, otid: 0 })
    writeMon(state, selected.enemyAddress, { pid: 1, species: 145 })
    assert.deepEqual(inspectGen3Encounter(state, selected), { status: 'shiny', species: 145, pid: 1, otid: 0 })
    state.set(Buffer.from(gameCode === 'BPRE' ? 'BPGE' : 'BPRE'), 0x2c)
    assert.deepEqual(inspectGen3Encounter(state, selected), { status: 'error', reason: 'state-mismatch' })
  })
}

test('Ruby waits for a battle even if an enemy record changes on the map', () => {
  const ruby = findGen3EncounterLayout({ romSha256: '0fdd36e92b75bed65d09df4635ab0b707b288c2bf1dc4c6e7a4a4f0eebe9d64c', core: 'gba', runtimeId: 'emulatorjs-4.2.3' })
  const state = makeState()
  writeMon(state, ruby.enemyAddress, { pid: 1 })
  assert.deepEqual(inspectGen3Encounter(state, ruby), { status: 'pending' })
  state[stateOffset(ruby.battleFlag.main + ruby.battleFlag.inBattleOffset)] = 2
  assert.equal(inspectGen3Encounter(state, ruby).status, 'shiny')
})

test('Ruby battle reader distinguishes an active battle from the map', () => {
  const ruby = findGen3EncounterLayout({ romSha256: '0fdd36e92b75bed65d09df4635ab0b707b288c2bf1dc4c6e7a4a4f0eebe9d64c', core: 'gba', runtimeId: 'emulatorjs-4.2.3' })
  const state = makeState()
  assert.deepEqual(inspectGen3BattlePhase(state, ruby), { status: 'map' })
  state[stateOffset(ruby.battleFlag.main + ruby.battleFlag.inBattleOffset)] = 2
  assert.deepEqual(inspectGen3BattlePhase(state, ruby), { status: 'battle' })
})

test('Emerald battle reader distinguishes action menu, run cursor and returned map', () => {
  const emerald = findGen3EncounterLayout({ romSha256: 'a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af', core: 'gba', runtimeId: 'emulatorjs-4.2.3' })
  const state = makeState()
  state.set([66, 80, 69, 69], 0x2c)
  const memory = new DataView(state.buffer)
  const { battle } = emerald
  state[stateOffset(battle.main + 0x439)] = 2
  state[stateOffset(battle.positions)] = 0
  memory.setUint32(stateOffset(battle.controllers), battle.chooseAction + 1, true)
  state[stateOffset(battle.cursor)] = 3
  assert.deepEqual(inspectGen3BattlePhase(state, emerald), { status: 'menu', cursor: 3 })
  state[stateOffset(battle.main + 0x439)] = 0
  state[stateOffset(battle.outcome)] = 4
  memory.setUint32(stateOffset(battle.main + 4), battle.overworld + 1, true)
  assert.deepEqual(inspectGen3BattlePhase(state, emerald), { status: 'map' })
})

test('Emerald ignores a residual enemy record while back on the map', () => {
  const emerald = findGen3EncounterLayout({ romSha256: 'a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af', core: 'gba', runtimeId: 'emulatorjs-4.2.3' })
  const state = makeState()
  state.set([66, 80, 69, 69], 0x2c)
  writeMon(state, emerald.enemyAddress, { pid: 1, species: 25 })
  assert.deepEqual(inspectGen3Encounter(state, emerald), { status: 'pending' })
})
