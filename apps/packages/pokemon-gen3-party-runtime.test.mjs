import assert from 'node:assert/strict'
import test from 'node:test'

import {
  materializeGen3PartyRecord,
  parseGen3BoxCore,
} from './pokemon-gen3-party-runtime.mjs'

const speciesData = {
  speciesId: 25,
  baseStats: {
    hp: 50,
    attack: 60,
    defense: 70,
    speed: 80,
    specialAttack: 90,
    specialDefense: 100,
  },
}

const growthData = {
  experienceForLevel: level => (level - 1) * 1_000,
}

test('parses the encrypted Box core and exposes the inputs needed for Party runtime calculation', () => {
  const boxCore = buildBoxCore({
    personality: 0,
    originalTrainerId: 0x0002_0001,
    species: 25,
    experience: 9_500,
    evs: { hp: 252, attack: 100, defense: 64, speed: 0, specialAttack: 0, specialDefense: 0 },
    ivs: { hp: 31, attack: 20, defense: 10, speed: 5, specialAttack: 15, specialDefense: 25 },
  })

  const parsed = parseGen3BoxCore(boxCore)

  assert.equal(parsed.personality, 0)
  assert.equal(parsed.originalTrainerId, 0x0002_0001)
  assert.equal(parsed.species, 25)
  assert.equal(parsed.experience, 9_500)
  assert.deepEqual(parsed.evs, { hp: 252, attack: 100, defense: 64, speed: 0, specialAttack: 0, specialDefense: 0 })
  assert.deepEqual(parsed.ivs, { hp: 31, attack: 20, defense: 10, speed: 5, specialAttack: 15, specialDefense: 25 })
})

test('materializes a complete 100-byte Party record with calculated runtime data', () => {
  const boxCore = buildBoxCore({
    personality: 0,
    originalTrainerId: 0x0002_0001,
    species: 25,
    experience: 9_500,
    evs: { hp: 252, attack: 100, defense: 64, speed: 0, specialAttack: 0, specialDefense: 0 },
    ivs: { hp: 31, attack: 20, defense: 10, speed: 5, specialAttack: 15, specialDefense: 25 },
  })

  const record = materializeGen3PartyRecord({ boxCore, speciesData, growthData })

  assert.equal(record.length, 100)
  assert.deepEqual(record.subarray(0, 80), boxCore)
  assert.equal(record.readUInt32LE(80), 0)
  assert.equal(record[84], 10)
  assert.equal(record[85], 0)
  assert.equal(record.readUInt16LE(86), 39)
  assert.equal(record.readUInt16LE(88), 39)
  assert.equal(record.readUInt16LE(90), 21)
  assert.equal(record.readUInt16LE(92), 21)
  assert.equal(record.readUInt16LE(94), 21)
  assert.equal(record.readUInt16LE(96), 24)
  assert.equal(record.readUInt16LE(98), 27)
})

test('applies the personality nature modifier and explicit semantic status/mail values', () => {
  const boxCore = buildBoxCore({
    personality: 3,
    originalTrainerId: 0x0002_0001,
    species: 25,
    experience: 9_500,
    evs: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    ivs: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
  })

  const record = materializeGen3PartyRecord({
    boxCore,
    speciesData,
    growthData,
    runtime: { status: 0x0000_0008, mail: 2, currentHp: 1 },
  })

  assert.equal(record.readUInt32LE(80), 8)
  assert.equal(record[84], 10)
  assert.equal(record[85], 2)
  assert.equal(record.readUInt16LE(86), 1)
  assert.equal(record.readUInt16LE(88), 30)
  assert.equal(record.readUInt16LE(90), 18)
  assert.equal(record.readUInt16LE(92), 19)
  assert.equal(record.readUInt16LE(94), 21)
  assert.equal(record.readUInt16LE(96), 20)
  assert.equal(record.readUInt16LE(98), 25)
})

test('rejects malformed or incomplete Box-to-Party inputs', () => {
  const boxCore = buildBoxCore({ personality: 0, originalTrainerId: 1, species: 25, experience: 0 })

  assert.throws(() => parseGen3BoxCore(Buffer.alloc(79)), /80 bytes/i)
  assert.throws(() => parseGen3BoxCore(Buffer.concat([boxCore.subarray(0, 0x20), Buffer.from([0xff]), boxCore.subarray(0x21)])), /checksum/i)
  assert.throws(() => materializeGen3PartyRecord({ boxCore, speciesData: null, growthData }), /species/i)
  assert.throws(() => materializeGen3PartyRecord({ boxCore, speciesData, growthData: null }), /growth/i)
})

function buildBoxCore({ personality, originalTrainerId, species, experience, evs = {}, ivs = {} }) {
  const order = substructureOrders[personality % 24]
  const plain = Buffer.alloc(48)
  const growth = substructure(plain, order, 'G')
  growth.writeUInt16LE(species, 0)
  growth.writeUInt32LE(experience, 4)

  const effort = substructure(plain, order, 'E')
  effort[0] = evs.hp ?? 0
  effort[1] = evs.attack ?? 0
  effort[2] = evs.defense ?? 0
  effort[3] = evs.speed ?? 0
  effort[4] = evs.specialAttack ?? 0
  effort[5] = evs.specialDefense ?? 0

  const misc = substructure(plain, order, 'M')
  misc.writeUInt32LE(
    ((ivs.hp ?? 0)
      | ((ivs.attack ?? 0) << 5)
      | ((ivs.defense ?? 0) << 10)
      | ((ivs.speed ?? 0) << 15)
      | ((ivs.specialAttack ?? 0) << 20)
      | ((ivs.specialDefense ?? 0) << 25)) >>> 0,
    4,
  )

  const checksum = checksum16(plain)
  const encrypted = Buffer.from(plain)
  const key = (personality ^ originalTrainerId) >>> 0
  for (let offset = 0; offset < encrypted.length; offset += 4) encrypted.writeUInt32LE((encrypted.readUInt32LE(offset) ^ key) >>> 0, offset)

  const core = Buffer.alloc(80)
  core.writeUInt32LE(personality >>> 0, 0)
  core.writeUInt32LE(originalTrainerId >>> 0, 4)
  core.writeUInt16LE(checksum, 0x1c)
  encrypted.copy(core, 0x20)
  return core
}

function substructure(plain, order, name) {
  return plain.subarray(order.indexOf(name) * 12, order.indexOf(name) * 12 + 12)
}

function checksum16(bytes) {
  let result = 0
  for (let offset = 0; offset < bytes.length; offset += 2) result = (result + bytes.readUInt16LE(offset)) & 0xffff
  return result
}

const substructureOrders = [
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA',
  'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG',
  'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG',
]
