import genderRatios from './pokemon-gen3-gender-ratios.json' with { type: 'json' }
import nameCatalog from './pokemon-gen3-name-catalog.json' with { type: 'json' }
import { getGen3PartySpeciesData, getGen3LevelFromExperience } from './pokemon-gen3-party-data.mjs'
import { calculateGen3BattleStats, parseGen3BoxCore } from './pokemon-gen3-party-runtime.mjs'
import { getGen3NationalDex } from './pokemon-gen3-species.mjs'

const gameNames = Object.freeze({ 1: 'Pokémon Sapphire', 2: 'Pokémon Ruby', 3: 'Pokémon Emerald', 4: 'Pokémon FireRed', 5: 'Pokémon LeafGreen', 15: 'Pokémon Colosseum/XD' })
const ballNames = Object.freeze(['', 'Master Ball', 'Ultra Ball', 'Great Ball', 'Poké Ball', 'Safari Ball', 'Net Ball', 'Dive Ball', 'Nest Ball', 'Repeat Ball', 'Timer Ball', 'Luxury Ball', 'Premier Ball'])
const contestNames = Object.freeze(['Cool', 'Beauty', 'Cute', 'Smart', 'Tough'])
const rankNames = Object.freeze(['Normal', 'Super', 'Hyper', 'Master'])
const otherRibbonNames = Object.freeze(['Champion', 'Winning', 'Victory', 'Artist', 'Effort', 'Marine', 'Land', 'Sky', 'Country', 'National', 'Earth', 'World'])

export function getGen3GenderRatio(nativeSpeciesId) {
  const ratio = genderRatios[nativeSpeciesId]
  return Number.isInteger(ratio) ? ratio : null
}

export function projectGen3PokemonCard({ bytes, kind, title = null, provenance = null, partyRuntimeValid = false } = {}) {
  const expectedLength = kind === 'pc-record' ? 80 : kind === 'party-record' ? 100 : null
  if (!expectedLength || !(bytes instanceof Uint8Array) || bytes.length !== expectedLength) throw cardError('GEN3_CARD_RECORD_INVALID', 'Gen III card record is invalid.')
  const data = Buffer.from(bytes)
  const parsed = parseGen3BoxCore(data.subarray(0, 80))
  const species = getGen3NationalDex(parsed.species)
  if (species === null) throw cardError('GEN3_CARD_SPECIES_UNKNOWN', 'Gen III card species is unknown.')
  const unavailableFields = []
  const ratio = getGen3GenderRatio(parsed.species)
  if (ratio === null) unavailableFields.push('identity.gender')
  const gender = parsed.isEgg || ratio === null ? null : ratio === 255 ? 'genderless' : ratio === 254 ? 'female' : ratio === 0 ? 'male' : (parsed.personality & 0xff) < ratio ? 'female' : 'male'
  const trainerId = parsed.originalTrainerId & 0xffff
  const secretId = parsed.originalTrainerId >>> 16
  const shiny = ((trainerId ^ secretId ^ (parsed.personality & 0xffff) ^ (parsed.personality >>> 16)) & 0xffff) < 8
  const runtime = kind === 'party-record' && partyRuntimeValid ? parsePartyRuntime(data) : null

  let level = runtime?.level ?? null
  let stats = runtime?.stats ?? null
  if (title || parsed.species !== 410) {
    try {
      const speciesData = getGen3PartySpeciesData(parsed.species, title ?? 'pokemon-emerald')
      level ??= getGen3LevelFromExperience(speciesData.growthRate, parsed.experience)
      stats ??= calculateGen3BattleStats({ parsed, speciesData, level })
    } catch (error) {
      if (!error.code?.startsWith('GEN3_PARTY_')) throw error
    }
  }
  if (parsed.species === 410 && !title) {
    const speciesData = getGen3PartySpeciesData(parsed.species, 'pokemon-emerald')
    level ??= getGen3LevelFromExperience(speciesData.growthRate, parsed.experience)
  }
  if (level === null) unavailableFields.push('training.level')
  if (stats === null) unavailableFields.push('training.stats')
  const sourceMatch = /^save:([^:]+):([^:]+)$/.exec(provenance?.originSourceKey ?? '')

  return {
    identity: { species, speciesLabel: nameCatalog.species[parsed.species] ?? null, nativeSpeciesId: parsed.species, shiny, gender, isEgg: parsed.isEgg },
    training: { level, stats, ivs: parsed.ivs, partyRuntime: runtime ? { currentHp: runtime.currentHp, maxHp: runtime.maxHp, condition: runtime.condition } : null },
    moves: parsed.moves.map((moveId, slot) => ({ slot, moveId, label: moveId === 0 ? null : nameCatalog.moves[moveId] ?? `Move #${moveId}`, pp: moveId === 0 ? null : parsed.pp[slot], maxPp: null })),
    ribbons: decodeGen3Ribbons(parsed.ribbonFlags),
    origin: { trainerId, metGameId: parsed.metGame, metGameLabel: gameNames[parsed.metGame] ?? null, originSaveProfileId: sourceMatch?.[1] ?? null, originGameId: sourceMatch?.[2] ?? null },
    capture: { ballId: parsed.pokeball, ballLabel: ballNames[parsed.pokeball] ?? null },
    heldItem: { itemId: parsed.heldItem, itemLabel: parsed.heldItem === 0 ? null : nameCatalog.items[parsed.heldItem] ?? `Item #${parsed.heldItem}` },
    unavailableFields,
  }
}

function parsePartyRuntime(bytes) {
  const level = bytes[84]
  const currentHp = bytes.readUInt16LE(86)
  const maxHp = bytes.readUInt16LE(88)
  if (level < 1 || level > 100 || currentHp > maxHp || maxHp === 0) return null
  return {
    level,
    currentHp,
    maxHp,
    condition: bytes.readUInt32LE(80),
    stats: { hp: maxHp, attack: bytes.readUInt16LE(90), defense: bytes.readUInt16LE(92), speed: bytes.readUInt16LE(94), specialAttack: bytes.readUInt16LE(96), specialDefense: bytes.readUInt16LE(98) },
  }
}

export function decodeGen3Ribbons(flags) {
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xffff_ffff) throw cardError('GEN3_CARD_RIBBONS_INVALID', 'Gen III ribbon flags are invalid.')
  const ribbons = []
  for (let category = 0; category < 5; category += 1) {
    const highestRank = (flags >>> (category * 3)) & 7
    for (let rank = 1; rank <= Math.min(highestRank, 4); rank += 1) {
      const ribbonId = 1 + category * 4 + rank - 1
      ribbons.push({ ribbonId, rank, label: `${contestNames[category]} ${rankNames[rank - 1]}`, iconKey: `gen3-ribbon-${ribbonId}` })
    }
  }
  for (let index = 0; index < otherRibbonNames.length; index += 1) {
    if (((flags >>> (15 + index)) & 1) === 0) continue
    const ribbonId = index === 0 ? 0 : 20 + index
    ribbons.push({ ribbonId, rank: null, label: otherRibbonNames[index], iconKey: `gen3-ribbon-${ribbonId}` })
  }
  return ribbons.sort((left, right) => left.ribbonId - right.ribbonId)
}

function cardError(code, message) { const error = new Error(message); error.code = code; return error }
