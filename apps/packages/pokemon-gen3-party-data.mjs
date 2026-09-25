import speciesRows from './pokemon-gen3-party-species.json' with { type: 'json' }

const supportedTitles = new Set(['pokemon-ruby', 'pokemon-sapphire', 'pokemon-emerald', 'pokemon-firered', 'pokemon-leafgreen'])

const deoxysStats = Object.freeze({
  'pokemon-emerald': [50, 95, 90, 180, 95, 90],
  'pokemon-firered': [50, 180, 20, 150, 180, 20],
  'pokemon-leafgreen': [50, 70, 160, 90, 70, 160],
})

export function getGen3PartySpeciesData(nativeSpecies, title) {
  if (!supportedTitles.has(title)) throw dataError('GEN3_PARTY_TITLE_UNSUPPORTED', 'Gen III Party title is unsupported.')
  const row = speciesRows[nativeSpecies]
  if (!Number.isInteger(nativeSpecies) || !row) throw dataError('GEN3_PARTY_SPECIES_DATA_MISSING', `No Gen III Party data exists for native species ${nativeSpecies}.`)
  const [hp, attack, defense, speed, specialAttack, specialDefense, growthRate] = nativeSpecies === 410
    ? [...(deoxysStats[title] ?? row.slice(0, 6)), row[6]]
    : row
  return {
    speciesId: nativeSpecies,
    baseStats: { hp, attack, defense, speed, specialAttack, specialDefense },
    growthRate,
    ...(nativeSpecies === 303 ? { fixedHp: 1 } : {}),
  }
}

export function getGen3LevelFromExperience(growthRate, experience) {
  if (!Number.isInteger(experience) || experience < 0 || experience > 0xffff_ffff) throw dataError('GEN3_PARTY_EXPERIENCE_INVALID', 'Gen III experience is invalid.')
  let level = 1
  for (let candidate = 2; candidate <= 100; candidate += 1) {
    if (experience < experienceForLevel(growthRate, candidate)) break
    level = candidate
  }
  return level
}

function experienceForLevel(growthRate, level) {
  const cube = level ** 3
  switch (growthRate) {
    case 'SLOW': return Math.floor(5 * cube / 4)
    case 'FAST': return Math.floor(4 * cube / 5)
    case 'MEDIUM_FAST': return cube
    case 'MEDIUM_SLOW': return Math.floor(6 * cube / 5) - 15 * level ** 2 + 100 * level - 140
    case 'ERRATIC':
      if (level <= 50) return Math.floor((100 - level) * cube / 50)
      if (level <= 68) return Math.floor((150 - level) * cube / 100)
      if (level <= 98) return Math.floor(Math.floor((1911 - 10 * level) / 3) * cube / 500)
      return Math.floor((160 - level) * cube / 100)
    case 'FLUCTUATING':
      if (level <= 15) return Math.floor((Math.floor((level + 1) / 3) + 24) * cube / 50)
      if (level <= 36) return Math.floor((level + 14) * cube / 50)
      return Math.floor((Math.floor(level / 2) + 32) * cube / 50)
    default: throw dataError('GEN3_PARTY_GROWTH_DATA_MISSING', `Gen III growth rate ${growthRate} is unsupported.`)
  }
}

function dataError(code, message) { const error = new Error(message); error.code = code; return error }
