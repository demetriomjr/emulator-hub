import assert from 'node:assert/strict'
import test from 'node:test'

import { getGen3GenderRatio, projectGen3PokemonCard } from './pokemon-gen3-card-data.mjs'
import { getGen3MoveTypeIconUrl } from './pokemon-card-move-type-icon.mjs'

test('uses modern type badges only for available Gen III types', () => {
  assert.equal(getGen3MoveTypeIconUrl('ghost'), '/resources/pokemon-card/types/ghost.png')
  assert.equal(getGen3MoveTypeIconUrl('mystery'), null)
  assert.equal(getGen3MoveTypeIconUrl('fairy'), null)
})

test('gender catalog covers known native species and all supported records', () => {
  assert.equal(getGen3GenderRatio(25), 127)
  assert.equal(getGen3GenderRatio(29), 254)
  assert.equal(getGen3GenderRatio(32), 0)
  assert.equal(getGen3GenderRatio(81), 255)
  for (let nativeSpecies = 1; nativeSpecies <= 411; nativeSpecies += 1) {
    if (nativeSpecies >= 252 && nativeSpecies <= 276) continue
    assert.ok(Number.isInteger(getGen3GenderRatio(nativeSpecies)), `missing gender ratio ${nativeSpecies}`)
  }
})

test('projects stable card facts and preserves four move slots from native bytes', () => {
  const card = projectGen3PokemonCard({
    bytes: buildCore({ personality: 200, originalTrainerId: 200, species: 25, heldItem: 13, experience: 8_000, moves: [85, 98, 0, 237], pp: [15, 30, 0, 15], metGame: 3, pokeball: 4, ribbonFlags: (2 | (1 << 15) | (1 << 16)) >>> 0, ivs: { hp: 31, attack: 25 }, evs: { hp: 252, attack: 252, speed: 6 } }),
    kind: 'pc-record',
    title: 'pokemon-emerald',
    provenance: { originSourceKey: 'save:profile-a:game-a' },
  })
  assert.equal(card.identity.species, 25)
  assert.equal(card.identity.speciesLabel, 'PIKACHU')
  assert.equal(card.identity.gender, 'male')
  assert.equal(card.identity.shiny, true)
  assert.equal(card.training.level, 20)
  assert.equal(card.training.ivs.hp, 31)
  assert.deepEqual(card.training.evs, { hp: 252, attack: 252, defense: 0, speed: 6, specialAttack: 0, specialDefense: 0 })
  assert.equal(card.training.partyRuntime, null)
  assert.deepEqual(card.moves.map(move => move.moveId), [85, 98, 0, 237])
  assert.equal(card.moves[0].label, 'THUNDERBOLT')
  assert.deepEqual(card.moves.map(move => move.type), ['electric', 'normal', null, 'fighting'])
  assert.equal(card.heldItem.itemLabel, 'POTION')
  assert.equal(card.origin.trainerId, 200)
  assert.equal(card.origin.metGameId, 3)
  assert.equal(card.origin.originSaveProfileId, 'profile-a')
  assert.equal(card.capture.ballId, 4)
  assert.equal(card.heldItem.itemId, 13)
  assert.deepEqual(card.ribbons.map(ribbon => ribbon.ribbonId), [0, 1, 2, 21])
  const hubCard = projectGen3PokemonCard({ bytes: buildCore({ personality: 200, originalTrainerId: 200, species: 25, experience: 8_000 }), kind: 'pc-record' })
  assert.equal(hubCard.training.level, 20)
  const curseCard = projectGen3PokemonCard({ bytes: buildCore({ personality: 200, originalTrainerId: 200, species: 25, experience: 8_000, moves: [174] }), kind: 'pc-record' })
  assert.equal(curseCard.moves[0].type, 'mystery')
})

test('does not claim current Party HP for a box core or a dirty Party placement', () => {
  const core = buildCore({ personality: 1, originalTrainerId: 2, species: 81, experience: 8_000 })
  const party = Buffer.concat([core, Buffer.alloc(20)])
  party[84] = 20
  party.writeUInt16LE(30, 86)
  party.writeUInt16LE(40, 88)
  const clean = projectGen3PokemonCard({ bytes: party, kind: 'party-record', title: 'pokemon-emerald', partyRuntimeValid: true })
  const dirty = projectGen3PokemonCard({ bytes: party, kind: 'party-record', title: 'pokemon-emerald', partyRuntimeValid: false })
  assert.equal(clean.identity.gender, 'genderless')
  assert.deepEqual(clean.training.partyRuntime, { currentHp: 30, maxHp: 40, condition: 0 })
  assert.equal(dirty.training.partyRuntime, null)
  assert.equal(projectGen3PokemonCard({ bytes: core, kind: 'pc-record', title: 'pokemon-emerald' }).training.partyRuntime, null)
})

test('keeps Deoxys stats unknown in a Hub without a current game form', () => {
  const card = projectGen3PokemonCard({ bytes: buildCore({ personality: 1, originalTrainerId: 2, species: 410, experience: 8_000 }), kind: 'pc-record' })
  assert.equal(card.training.level, 18)
  assert.equal(card.training.stats, null)
  assert.ok(card.unavailableFields.includes('training.stats'))
})

test('projects the egg incubation counter from the stored core without inventing exact steps', () => {
  const egg = projectGen3PokemonCard({ bytes: buildCore({ personality: 200, originalTrainerId: 200, species: 25, experience: 8_000, isEgg: true, eggCyclesRemaining: 7 }), kind: 'pc-record', title: 'pokemon-emerald' })
  assert.equal(egg.identity.isEgg, true)
  assert.deepEqual(egg.incubation, { eggCyclesRemaining: 7 })
  assert.equal('stepsRemaining' in egg.incubation, false)
})

function buildCore({ personality, originalTrainerId, species, heldItem = 0, experience, moves = [], pp = [], metGame = 0, pokeball = 0, ribbonFlags = 0, ivs = {}, evs = {}, isEgg = false, eggCyclesRemaining = 0 }) {
  const orders = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG', 'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG']
  const order = orders[personality % 24]
  const plain = Buffer.alloc(48)
  const part = key => plain.subarray(order.indexOf(key) * 12, order.indexOf(key) * 12 + 12)
  part('G').writeUInt16LE(species, 0)
  part('G').writeUInt16LE(heldItem, 2)
  part('G').writeUInt32LE(experience, 4)
  part('G')[9] = eggCyclesRemaining
  for (let index = 0; index < 4; index += 1) { part('A').writeUInt16LE(moves[index] ?? 0, index * 2); part('A')[8 + index] = pp[index] ?? 0 }
  for (const [index, stat] of ['hp', 'attack', 'defense', 'speed', 'specialAttack', 'specialDefense'].entries()) part('E')[index] = evs[stat] ?? 0
  part('M').writeUInt16LE((metGame << 7) | (pokeball << 11), 2)
  part('M').writeUInt32LE(((ivs.hp ?? 0) | ((ivs.attack ?? 0) << 5) | (isEgg ? 0x4000_0000 : 0)) >>> 0, 4)
  part('M').writeUInt32LE(ribbonFlags, 8)
  let checksum = 0
  for (let offset = 0; offset < 48; offset += 2) checksum = (checksum + plain.readUInt16LE(offset)) & 0xffff
  const encrypted = Buffer.from(plain)
  const key = (personality ^ originalTrainerId) >>> 0
  for (let offset = 0; offset < 48; offset += 4) encrypted.writeUInt32LE((encrypted.readUInt32LE(offset) ^ key) >>> 0, offset)
  const core = Buffer.alloc(80)
  core.writeUInt32LE(personality, 0)
  core.writeUInt32LE(originalTrainerId, 4)
  core.writeUInt16LE(checksum, 0x1c)
  encrypted.copy(core, 0x20)
  return core
}
