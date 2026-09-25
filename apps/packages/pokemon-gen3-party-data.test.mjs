import assert from 'node:assert/strict'
import test from 'node:test'

import { getGen3PartySpeciesData, getGen3LevelFromExperience } from './pokemon-gen3-party-data.mjs'

test('provides native Gen III species stats and growth for all supported GBA titles', () => {
  for (const title of ['pokemon-ruby', 'pokemon-sapphire', 'pokemon-emerald', 'pokemon-firered', 'pokemon-leafgreen']) {
    const pikachu = getGen3PartySpeciesData(25, title)
    assert.deepEqual(pikachu.baseStats, { hp: 35, attack: 55, defense: 30, speed: 90, specialAttack: 50, specialDefense: 40 })
    assert.equal(getGen3LevelFromExperience(pikachu.growthRate, 1_000_000), 100)
  }
})

test('covers every native species accepted by the Gen III adapter', () => {
  for (let nativeSpecies = 1; nativeSpecies <= 411; nativeSpecies += 1) {
    if (nativeSpecies >= 252 && nativeSpecies <= 276) continue // Unused old Unown identifiers.
    assert.ok(getGen3PartySpeciesData(nativeSpecies, 'pokemon-emerald'))
  }
})

test('applies title specific Deoxys stats and the one HP Shedinja rule', () => {
  assert.equal(getGen3PartySpeciesData(410, 'pokemon-ruby').baseStats.attack, 150)
  assert.equal(getGen3PartySpeciesData(410, 'pokemon-emerald').baseStats.speed, 180)
  assert.equal(getGen3PartySpeciesData(410, 'pokemon-firered').baseStats.attack, 180)
  assert.equal(getGen3PartySpeciesData(410, 'pokemon-leafgreen').baseStats.defense, 160)
  assert.equal(getGen3PartySpeciesData(303, 'pokemon-sapphire').fixedHp, 1)
})

test('uses Gen III growth thresholds at level boundaries', () => {
  assert.equal(getGen3LevelFromExperience('MEDIUM_FAST', 7), 1)
  assert.equal(getGen3LevelFromExperience('MEDIUM_FAST', 8), 2)
  assert.equal(getGen3LevelFromExperience('MEDIUM_SLOW', 8), 1)
  assert.equal(getGen3LevelFromExperience('MEDIUM_SLOW', 9), 2)
  assert.equal(getGen3LevelFromExperience('ERRATIC', 10_000_000), 100)
  assert.equal(getGen3LevelFromExperience('FLUCTUATING', 0), 1)
})
