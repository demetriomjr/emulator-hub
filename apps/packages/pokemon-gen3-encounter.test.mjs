import assert from 'node:assert/strict'
import test from 'node:test'

import { captureGen3EnemyBaseline, inspectGen3BattlePhase, inspectGen3Encounter, findGen3EncounterLayout } from './pokemon-gen3-encounter.mjs'
import { createShinyHuntPlayer } from './shiny-hunt-player.mjs'
import { createShinyHuntController } from './shiny-hunt-controller.mjs'

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

for (const gameCode of ['AXVE', 'AXPE', 'BPEE', 'BPRE', 'BPGE']) {
  test(`${gameCode}: Fossil reads only the newly appended last party member`, () => {
    const selected = { gameCode, fossil: true, playerAddress: gameCode.startsWith('AX') ? playerAddress : gameCode === 'BPEE' ? 0x020244ec : 0x02024284, enemyAddress }
    for (let count = 1; count <= 5; count++) {
      const state = makeState(gameCode)
      for (let slot = 0; slot < count; slot++) writeMon(state, selected.playerAddress + slot * 100, { pid: 1, species: 25 })
      const baselineEnemy = captureGen3EnemyBaseline(state, selected)
      assert.equal(baselineEnemy.length, 600)
      writeMon(state, enemyAddress, { pid: 1, species: 142 })
      assert.equal(inspectGen3Encounter(state, { ...selected, baselineEnemy }).status, 'pending')
      writeMon(state, selected.playerAddress + (count - 1) * 100, { pid: 2, species: 25 })
      assert.equal(inspectGen3Encounter(state, { ...selected, baselineEnemy }).status, 'pending')
      const address = selected.playerAddress + count * 100
      writeMon(state, address, { pid: 8, species: 138 })
      assert.deepEqual(inspectGen3Encounter(state, { ...selected, baselineEnemy }), { status: 'normal', species: 138, pid: 8, otid: 0 })
      writeMon(state, address, { pid: 1, species: 138 })
      assert.equal(inspectGen3Encounter(state, { ...selected, baselineEnemy }).status, 'shiny')
      writeMon(state, address, { pid: 1, species: 138, validChecksum: false })
      assert.deepEqual(inspectGen3Encounter(state, { ...selected, baselineEnemy }), { status: 'error', reason: 'invalid-party-record' })
    }
  })
}

test('Fossil rejects a full baseline party and a mismatched state', () => {
  const state = makeState()
  const selected = { ...layout, fossil: true }
  for (let slot = 0; slot < 6; slot++) writeMon(state, playerAddress + slot * 100, { pid: 1 })
  assert.deepEqual(inspectGen3Encounter(state, selected), { status: 'error', reason: 'fossil-party-full' })
  assert.equal(inspectGen3Encounter(state, { ...selected, gameCode: 'BPRE' }).reason, 'state-mismatch')
})

test('Fossil player finishes five A and two B before reading a new shiny and re-arms each cycle', async () => {
  const state = makeState()
  writeMon(state, playerAddress, { pid: 1 })
  const buttons = []
  const reports = []
  const player = createShinyHuntPlayer({
    getLayout: () => layout, getState: () => state,
    configureOdds: () => true, softReset: async () => { state.fill(0, stateOffset(playerAddress) + 100, stateOffset(playerAddress) + 600); return true },
    setA() {}, setButton: (button, down) => buttons.push([button, down]), saveState: async () => true,
    reportEncounter: result => reports.push(result),
  })
  const request = { huntId: 'fossil', cycleId: 1 }
  assert.deepEqual(await player.handle({ ...request, type: 'prepare', startMode: 'fossil', resetMode: 'soft-reset' }), { ok: true })
  for (const cycleId of [1, 2]) {
    request.cycleId = cycleId
    assert.deepEqual(await player.handle({ ...request, type: 'reset', oddsResetCount: cycleId }), { ok: true })
    assert.deepEqual(await player.handle({ ...request, type: 'begin', afterReset: true }), { ok: true })
    assert.deepEqual(await player.handle({ ...request, type: 'input', button: 'B', down: true, stage: 'encounter' }), { ok: false, error: 'invalid-input-order' })
    for (const [index, button] of ['A', 'A', 'A', 'A', 'A', 'B', 'B'].entries()) {
      for (const down of [true, false]) assert.deepEqual(await player.handle({ ...request, type: 'input', button, down, stage: 'encounter' }), { ok: true })
      if (index === 0) writeMon(state, playerAddress + 100, { pid: 1, species: 138 })
      if (index < 6) assert.deepEqual(await player.handle({ ...request, type: 'inspect', configured: true }), { ok: true, status: 'pending' })
    }
    assert.equal((await player.handle({ ...request, type: 'inspect', configured: true })).status, 'shiny')
  }
  assert.equal(buttons.length, 28)
  assert.equal(reports.length, 2)
  await player.handle({ ...request, type: 'reset', cycleId: 3, oddsResetCount: 3 })
  await player.handle({ ...request, type: 'begin', cycleId: 3, afterReset: true })
  await player.handle({ ...request, type: 'input', cycleId: 3, button: 'A', down: true, stage: 'encounter' })
  await player.handle({ ...request, type: 'cancel' })
  assert.deepEqual(buttons.slice(-2), [['A', true], ['A', false]])
  assert.equal((await player.handle({ ...request, type: 'input', cycleId: 3, button: 'A', down: false, stage: 'encounter' })).ok, false)
})

test('Fossil player rejects battle-exit reset and a full party before NPC inputs', async () => {
  const state = makeState()
  const player = createShinyHuntPlayer({ getLayout: () => layout, getState: () => state, configureOdds: () => true, softReset: async () => true, setA() {}, setButton() {} })
  const request = { huntId: 'fossil', cycleId: 1 }
  assert.deepEqual(await player.handle({ ...request, type: 'prepare', startMode: 'fossil', resetMode: 'exit-encounter' }), { ok: false, error: 'invalid-fossil-reset' })
  await player.handle({ ...request, type: 'prepare', startMode: 'fossil', resetMode: 'soft-reset' })
  await player.handle({ ...request, type: 'reset', oddsResetCount: 1 })
  for (let slot = 0; slot < 6; slot++) writeMon(state, playerAddress + slot * 100, { pid: 1 })
  assert.deepEqual(await player.handle({ ...request, type: 'begin', afterReset: true }), { ok: false, error: 'fossil-party-full' })
})

for (const stopMode of ['first-shiny', 'all-shiny']) test(`Fossil controller/player integration preserves ${stopMode} across nine players`, async () => {
  let time = 0
  const config = { startMode: 'fossil', resetMode: 'soft-reset', stopMode }
  const sessions = Array.from({ length: 9 }, (_, index) => ({ sessionId: `fossil-${index}`, index }))
  const games = ['AXVE', 'AXPE', 'BPEE', 'BPRE', 'BPGE']
  const players = new Map()
  const counts = new Map()
  const saved = []
  for (const session of sessions) {
    const gameCode = games[session.index % games.length]
    const selected = { gameCode, playerAddress: gameCode.startsWith('AX') ? playerAddress : gameCode === 'BPEE' ? 0x020244ec : 0x02024284, enemyAddress }
    const state = makeState(gameCode)
    let cycle = 0
    let inputCount = 0
    counts.set(session.sessionId, [])
    const player = createShinyHuntPlayer({
      getLayout: () => selected, getState: () => state, configureOdds: () => true,
      softReset: async () => { cycle++; inputCount = 0; state.fill(0, stateOffset(selected.playerAddress), stateOffset(selected.playerAddress) + 600); return true },
      setA() {},
      setButton: (button, down) => {
        if (!down && stage === 'encounter') { inputCount++; counts.get(session.sessionId).push([cycle, button]) }
        if (down && stage === 'encounter' && inputCount === 0) writeMon(state, selected.playerAddress + 100, { pid: cycle >= (session.index % 2) + 1 ? 1 : 8, species: 138 })
      },
      saveState: async () => { saved.push(session.sessionId); return true },
    })
    let stage = null
    players.set(session.sessionId, {
      async send(type, cycleId, details = {}) {
        stage = details.stage ?? null
        const reply = await player.handle({ type, huntId: 'integration', cycleId, ...details })
        if (!reply.ok) throw new Error(reply.error)
        return reply
      },
      // Boot loads an existing shiny before begin. It must not end the hunt.
      ready() { writeMon(state, selected.playerAddress, { pid: 1, species: 25 }) },
    })
  }
  const send = (session, type, cycleId, details) => players.get(session.sessionId).send(type, cycleId, details)
  const controller = createShinyHuntController({
    now: () => time, sleep: async ms => { time += ms },
    prepare: async sessions => { for (const session of sessions) await send(session, 'prepare', null, config) },
    reset: (session, _signal, cycleId) => send(session, 'reset', cycleId, { oddsResetCount: cycleId }),
    begin: (session, _signal, cycleId, details) => { players.get(session.sessionId).ready(); return send(session, 'begin', cycleId, details) },
    input: (session, button, down, _signal, cycleId, stage) => send(session, 'input', cycleId, { button, down, stage }),
    inspect: (session, _signal, cycleId) => send(session, 'inspect', cycleId, { configured: true }),
    saveState: (session, _signal, cycleId) => send(session, 'save', cycleId, { complete: true }),
    release: async sessions => { for (const session of sessions) await send(session, 'cancel') },
  })
  const result = await controller.start(sessions, config)
  assert.equal(result.phase, 'found')
  assert.equal(saved.length, 9)
  if (stopMode === 'all-shiny') {
    assert.equal(result.attemptCount, 13)
    assert.equal(result.completedSessionIds.length, 9)
    for (const session of sessions) {
      const rounds = (session.index % 2) + 1
      assert.equal(counts.get(session.sessionId).length, rounds * 7)
      for (let cycle = 1; cycle <= rounds; cycle++) assert.deepEqual(counts.get(session.sessionId).filter(([round]) => round === cycle).map(([, button]) => button), ['A', 'A', 'A', 'A', 'A', 'B', 'B'])
    }
  } else {
    assert.ok(result.foundSessionId)
    assert.ok(result.attemptCount >= 1)
  }
})

test('Hoenn starter hunts inspect the selected player starter and ignore a shiny opponent', () => {
  const state = makeState()
  writeMon(state, playerAddress, { pid: 8, species: 277 })
  writeMon(state, enemyAddress, { pid: 1, species: 25 })
  assert.deepEqual(inspectGen3Encounter(state, { ...layout, starterSpecies: 252 }), { status: 'normal', species: 252, pid: 8, otid: 0 })
  writeMon(state, playerAddress, { pid: 1, species: 277 })
  assert.equal(inspectGen3Encounter(state, { ...layout, starterSpecies: 252 }).status, 'shiny')
})

test('a starter must be newly created, valid, and match the selected ball', () => {
  const state = makeState()
  const selected = { ...layout, starterSpecies: 255 }
  assert.deepEqual(inspectGen3Encounter(state, selected), { status: 'pending' })
  writeMon(state, playerAddress, { pid: 1, species: 280 })
  const baselineEnemy = state.slice(stateOffset(playerAddress), stateOffset(playerAddress) + 80)
  assert.deepEqual(inspectGen3Encounter(state, { ...selected, baselineEnemy }), { status: 'pending' })
  assert.deepEqual(inspectGen3Encounter(state, { ...layout, starterSpecies: 258 }), { status: 'error', reason: 'unexpected-starter' })
  writeMon(state, playerAddress, { pid: 1, species: 280, validChecksum: false })
  assert.deepEqual(inspectGen3Encounter(state, selected), { status: 'error', reason: 'invalid-starter-record' })
})

for (const gameCode of ['BPRE', 'BPGE']) test(`${gameCode} reads any newly obtained Kanto starter and ignores the enemy or a Hoenn choice`, () => {
  const selected = { gameCode, playerAddress: 0x02024284, enemyAddress: 0x0202402c, starterSpecies: [1, 4, 7] }
  for (const species of [1, 4, 7]) {
    const state = makeState(gameCode)
    const baselineEnemy = state.slice(stateOffset(selected.playerAddress), stateOffset(selected.playerAddress) + 80)
    writeMon(state, selected.enemyAddress, { pid: 1, species: 25 })
    assert.equal(inspectGen3Encounter(state, { ...selected, baselineEnemy }).status, 'pending')
    writeMon(state, selected.playerAddress, { pid: 8, species })
    assert.equal(inspectGen3Encounter(state, { ...selected, baselineEnemy }).status, 'normal')
    writeMon(state, selected.playerAddress, { pid: 1, species })
    assert.equal(inspectGen3Encounter(state, { ...selected, baselineEnemy }).status, 'shiny')
    assert.equal(inspectGen3Encounter(state, { ...selected, starterSpecies: 252 }).reason, 'unsupported-starter')
    writeMon(state, selected.playerAddress, { pid: 1, species: 25 })
    assert.equal(inspectGen3Encounter(state, selected).reason, 'unexpected-starter')
  }
})

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
