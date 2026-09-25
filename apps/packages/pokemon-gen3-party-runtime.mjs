const BOX_CORE_BYTES = 80
const PARTY_RECORD_BYTES = 100
const PARTY_RUNTIME_BYTES = PARTY_RECORD_BYTES - BOX_CORE_BYTES
const MAX_LEVEL = 100

const substructureOrders = Object.freeze([
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA',
  'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG',
  'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG',
])

const statKeys = Object.freeze(['attack', 'defense', 'speed', 'specialAttack', 'specialDefense'])

// Nature index = personality % 25. Each row selects the increased stat and
// each column selects the decreased stat; matching row/column pairs are
// neutral natures.
const increasedByNatureRow = Object.freeze(['attack', 'defense', 'speed', 'specialAttack', 'specialDefense'])
const decreasedByNatureColumn = Object.freeze(['attack', 'defense', 'speed', 'specialAttack', 'specialDefense'])

export const GEN3_BOX_CORE_BYTES = BOX_CORE_BYTES
export const GEN3_PARTY_RECORD_BYTES = PARTY_RECORD_BYTES
export const GEN3_PARTY_RUNTIME_BYTES = PARTY_RUNTIME_BYTES

/**
 * Decode the encrypted substructures of a Gen III BoxPokemon record.
 *
 * The returned fields are intentionally limited to the data required to
 * derive the Party-only runtime tail. The original 80-byte representation is
 * retained so callers can prepend it byte-for-byte to the generated tail.
 */
export function parseGen3BoxCore(boxCore, { validateChecksum = true } = {}) {
  const bytes = normalizeBoxCore(boxCore)
  const personality = bytes.readUInt32LE(0)
  const originalTrainerId = bytes.readUInt32LE(4)
  const key = (personality ^ originalTrainerId) >>> 0
  const decrypted = Buffer.from(bytes.subarray(0x20, 0x50))
  for (let offset = 0; offset < decrypted.length; offset += 4) {
    decrypted.writeUInt32LE((decrypted.readUInt32LE(offset) ^ key) >>> 0, offset)
  }

  const checksum = checksum16(decrypted)
  const storedChecksum = bytes.readUInt16LE(0x1c)
  if (validateChecksum && checksum !== storedChecksum) throw runtimeError('GEN3_PARTY_CORE_CHECKSUM', 'Gen III Box core checksum is invalid.')

  const order = substructureOrders[personality % substructureOrders.length]
  const structures = Object.fromEntries([...order].map((name, index) => [name, decrypted.subarray(index * 12, index * 12 + 12)]))
  const growth = structures.G
  const effort = structures.E
  const misc = structures.M
  const ivEggAbility = misc.readUInt32LE(4)

  return Object.freeze({
    bytes,
    personality,
    originalTrainerId,
    nature: personality % 25,
    checksum: storedChecksum,
    species: growth.readUInt16LE(0),
    heldItem: growth.readUInt16LE(2),
    experience: growth.readUInt32LE(4),
    ppBonuses: growth[8],
    friendship: growth[9],
    evs: Object.freeze({
      hp: effort[0],
      attack: effort[1],
      defense: effort[2],
      speed: effort[3],
      specialAttack: effort[4],
      specialDefense: effort[5],
    }),
    ivs: Object.freeze({
      hp: ivEggAbility & 0x1f,
      attack: (ivEggAbility >>> 5) & 0x1f,
      defense: (ivEggAbility >>> 10) & 0x1f,
      speed: (ivEggAbility >>> 15) & 0x1f,
      specialAttack: (ivEggAbility >>> 20) & 0x1f,
      specialDefense: (ivEggAbility >>> 25) & 0x1f,
    }),
  })
}

/**
 * Build a PartyPokemon from a complete 80-byte BoxPokemon core.
 *
 * `speciesData` and `growthData` are deliberately injected. This module does
 * not carry a species table or growth-rate table, and it never accepts a
 * caller-provided 20-byte runtime buffer. A Box-to-Party conversion therefore
 * cannot silently manufacture a zero-filled or stale runtime tail.
 *
 * `speciesData` may be one species object, a Map keyed by native species ID,
 * an object keyed by native species ID, or a resolver function. A species
 * object contains `baseStats` with hp, attack, defense, speed,
 * specialAttack, and specialDefense values.
 *
 * `growthData` may provide `levelFromExperience(experience)`,
 * `levelForExperience(experience)`, or `experienceForLevel(level)`. The last
 * form is searched across levels 1..100 and is useful for injected tables.
 */
export function materializeGen3PartyRecord({ boxCore, speciesData, growthData, runtime = {} } = {}) {
  const parsed = parseGen3BoxCore(boxCore)
  const species = resolveSpeciesData(speciesData, parsed.species)
  const baseStats = normalizeBaseStats(species, parsed.species)
  const level = resolveLevel(growthData, parsed.experience)
  const nature = parsed.nature

  const maxHp = species.fixedHp === 1 ? 1 : calculateHp(baseStats.hp, parsed.ivs.hp, parsed.evs.hp, level)
  const stats = {
    attack: calculateBattleStat(baseStats.attack, parsed.ivs.attack, parsed.evs.attack, level, nature, 'attack'),
    defense: calculateBattleStat(baseStats.defense, parsed.ivs.defense, parsed.evs.defense, level, nature, 'defense'),
    speed: calculateBattleStat(baseStats.speed, parsed.ivs.speed, parsed.evs.speed, level, nature, 'speed'),
    specialAttack: calculateBattleStat(baseStats.specialAttack, parsed.ivs.specialAttack, parsed.evs.specialAttack, level, nature, 'specialAttack'),
    specialDefense: calculateBattleStat(baseStats.specialDefense, parsed.ivs.specialDefense, parsed.evs.specialDefense, level, nature, 'specialDefense'),
  }

  const status = uint32(runtime.status ?? 0, 'Party status')
  const mail = uint8(runtime.mail ?? 0xff, 'Party mail')
  const currentHp = uint16(runtime.currentHp ?? maxHp, 'Party current HP')
  if (currentHp > maxHp) throw runtimeError('GEN3_PARTY_RUNTIME_INVALID', 'Party current HP cannot exceed max HP.')

  const record = Buffer.alloc(PARTY_RECORD_BYTES)
  parsed.bytes.copy(record, 0)
  record.writeUInt32LE(status, 80)
  record[84] = level
  record[85] = mail
  record.writeUInt16LE(currentHp, 86)
  record.writeUInt16LE(maxHp, 88)
  record.writeUInt16LE(stats.attack, 90)
  record.writeUInt16LE(stats.defense, 92)
  record.writeUInt16LE(stats.speed, 94)
  record.writeUInt16LE(stats.specialAttack, 96)
  record.writeUInt16LE(stats.specialDefense, 98)
  return record
}

function normalizeBoxCore(input) {
  if (!(Buffer.isBuffer(input) || input instanceof Uint8Array) || input.length !== BOX_CORE_BYTES) throw runtimeError('GEN3_PARTY_CORE_INVALID', 'A Gen III Box core must be exactly 80 bytes.')
  return Buffer.from(input)
}

function resolveSpeciesData(input, speciesId) {
  if (!input) throw runtimeError('GEN3_PARTY_SPECIES_DATA_MISSING', 'Gen III Party materialization requires species data.')
  let value
  if (typeof input === 'function') value = input(speciesId)
  else if (input instanceof Map) value = input.get(speciesId)
  else if (input.baseStats) value = input
  else value = input[speciesId] ?? input[String(speciesId)]
  if (!value || typeof value !== 'object') throw runtimeError('GEN3_PARTY_SPECIES_DATA_MISSING', `No species data was supplied for native species ${speciesId}.`)
  if (value.speciesId !== undefined && value.speciesId !== speciesId) throw runtimeError('GEN3_PARTY_SPECIES_MISMATCH', 'Injected species data does not match the Box core species.')
  return value
}

function normalizeBaseStats(species, speciesId) {
  const source = species.baseStats ?? species
  const stats = {
    hp: source.hp,
    attack: source.attack,
    defense: source.defense,
    speed: source.speed,
    specialAttack: source.specialAttack ?? source.spAttack,
    specialDefense: source.specialDefense ?? source.spDefense,
  }
  for (const key of ['hp', ...statKeys]) {
    if (!Number.isInteger(stats[key]) || stats[key] < 1 || stats[key] > 255) throw runtimeError('GEN3_PARTY_SPECIES_DATA_INVALID', `Injected base stat ${key} is invalid for native species ${speciesId}.`)
  }
  return stats
}

function resolveLevel(input, experience) {
  if (!input) throw runtimeError('GEN3_PARTY_GROWTH_DATA_MISSING', 'Gen III Party materialization requires growth data.')
  let level
  if (typeof input === 'function') level = input(experience)
  else if (typeof input.levelFromExperience === 'function') level = input.levelFromExperience(experience)
  else if (typeof input.levelForExperience === 'function') level = input.levelForExperience(experience)
  else if (typeof input.experienceForLevel === 'function') level = levelFromThresholds(experience, input.experienceForLevel)
  else if (Array.isArray(input.experienceByLevel)) level = levelFromThresholds(experience, index => input.experienceByLevel[index])
  else throw runtimeError('GEN3_PARTY_GROWTH_DATA_INVALID', 'Injected growth data must resolve experience to a level.')
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw runtimeError('GEN3_PARTY_GROWTH_DATA_INVALID', 'Injected growth data returned an invalid level.')
  return level
}

function levelFromThresholds(experience, thresholdForLevel) {
  let level = 1
  let previousThreshold = -1
  for (let candidate = 1; candidate <= MAX_LEVEL; candidate += 1) {
    const threshold = thresholdForLevel(candidate)
    if (!Number.isInteger(threshold) || threshold < 0 || threshold < previousThreshold) throw runtimeError('GEN3_PARTY_GROWTH_DATA_INVALID', 'Injected growth thresholds must be non-decreasing non-negative integers.')
    previousThreshold = threshold
    if (experience >= threshold) level = candidate
  }
  return level
}

function calculateHp(base, iv, ev, level) {
  return Math.floor((((2 * base + iv + evTerm(ev) + 100) * level) / 100) + 10)
}

function calculateBattleStat(base, iv, ev, level, nature, key) {
  const unmodified = Math.floor((((2 * base + iv + evTerm(ev)) * level) / 100) + 5)
  const modifier = natureModifier(nature, key)
  return Math.floor((unmodified * modifier) / 100)
}

function evTerm(ev) {
  return Math.floor(ev / 4)
}

function natureModifier(nature, stat) {
  const row = Math.floor(nature / 5)
  const column = nature % 5
  const increased = increasedByNatureRow[row]
  const decreased = decreasedByNatureColumn[column]
  if (increased === stat && decreased !== stat) return 110
  if (decreased === stat && increased !== stat) return 90
  return 100
}

function checksum16(bytes) {
  let checksum = 0
  for (let offset = 0; offset < bytes.length; offset += 2) checksum = (checksum + bytes.readUInt16LE(offset)) & 0xffff
  return checksum
}

function uint8(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw runtimeError('GEN3_PARTY_RUNTIME_INVALID', `${label} is invalid.`)
  return value
}

function uint16(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw runtimeError('GEN3_PARTY_RUNTIME_INVALID', `${label} is invalid.`)
  return value
}

function uint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw runtimeError('GEN3_PARTY_RUNTIME_INVALID', `${label} is invalid.`)
  return value >>> 0
}

function runtimeError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
