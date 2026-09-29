import regionalDexes from './rules/pokemon-gen3-regional-dexes.json' with { type: 'json' }
import transferRules from './rules/pokemon-gen3-transfer-rules.json' with { type: 'json' }

const regionalDexMembers = new Map(Object.entries(regionalDexes.regionalDexes).map(([name, definition]) => [name, expandRegionalDex(definition.nationalDex)]))

export function evaluateGenerationIIITransfer({ operation, source = null, destination = null, pokemon, sourcePokemonCount = null, hubPassport = null }) {
  if (operation === 'hub-export') {
    if (!verifiedHubExportInput(source, pokemon, sourcePokemonCount)) return rejected('TRANSFER_EXPORT_UNVERIFIED')
    return evaluateHubExport({ source, sourcePokemonCount })
  }
  assertPokemon(pokemon)
  if (operation === 'direct') return evaluateDirect({ source, destination, pokemon, sourcePokemonCount })
  if (operation === 'hub-import') return evaluateHubImport({ destination, pokemon, hubPassport })
  throw new TypeError('Generation III transfer operation is invalid')
}

export function getGenerationIIITitlePolicy(title) {
  const policy = transferRules.titles[title]
  if (!policy) throw new TypeError('Generation III title is invalid')
  return structuredClone(policy)
}

export function evaluateGenerationIIIItemTrade({ source, destination }) {
  assertSave(source); assertSave(destination)
  return evaluateDirectPair(source, destination).decision
}

function evaluateDirect({ source, destination, pokemon, sourcePokemonCount }) {
  assertSave(source); assertSave(destination)
  if (!retainsSourcePokemon(sourcePokemonCount, transferRules.directTrade.sameTitle.minimumPokemonAfterTransaction)) return rejected('TRANSFER_SOURCE_EMPTY_AFTER_MOVE')
  const { decision, pair } = evaluateDirectPair(source, destination)
  if (!decision.allowed || !pair) return decision
  if (!regionalGateAllows(source, pokemon, { directRegionalGate: pair.sourceRegionalGate }) || !regionalGateAllows(destination, pokemon, { directRegionalGate: pair.destinationRegionalGate })) return rejected('TRANSFER_NATIONAL_DEX_REQUIRED')
  return allowed()
}

function evaluateDirectPair(source, destination) {
  if (source.title === destination.title) return { decision: allowed(), pair: null }
  if (!source.ordinaryTradeReady || !destination.ordinaryTradeReady) return { decision: rejected('TRANSFER_TRADE_NOT_READY'), pair: null }
  const pair = resolvePair(source.title, destination.title)
  if (!pair) return { decision: rejected('TRANSFER_GAME_PAIR_UNSUPPORTED'), pair: null }
  if (!requirementsMet(source, pair.sourceRequires) || !requirementsMet(destination, pair.destinationRequires)) return { decision: rejected(requirementReason(pair, source, destination)), pair: null }
  return { decision: allowed(), pair }
}

function evaluateHubExport({ source, sourcePokemonCount }) {
  if (!retainsSourcePokemon(sourcePokemonCount, transferRules.hubBoundary.export.minimumPokemonAfterMove)) return rejected('TRANSFER_SOURCE_EMPTY_AFTER_MOVE')
  const requirements = transferRules.hubBoundary.export
  if (requirements.requiresNationalDexUnlocked && !source.nationalDexUnlocked) return rejected('TRANSFER_NATIONAL_DEX_REQUIRED')
  if (requirements.requiresGameClear && !source.gameClear) return rejected('TRANSFER_LEAGUE_REQUIRED')
  if (requirements.requiresNetworkMachineWhenApplicable && transferRules.titles[source.title].networkMachineGate && !source.networkMachineRestored) return rejected('TRANSFER_NETWORK_MACHINE_REQUIRED')
  return allowed()
}

function verifiedHubExportInput(source, pokemon, sourcePokemonCount) {
  const titlePolicy = transferRules.titles[source?.title]
  return Boolean(titlePolicy)
    && typeof source.nationalDexUnlocked === 'boolean'
    && typeof source.gameClear === 'boolean'
    && (!titlePolicy.networkMachineGate || typeof source.networkMachineRestored === 'boolean')
    && Number.isInteger(pokemon?.nationalDexNumber) && pokemon.nationalDexNumber >= 1 && typeof pokemon.isEgg === 'boolean'
    && Number.isInteger(sourcePokemonCount) && sourcePokemonCount >= 0
}

function evaluateHubImport({ destination, pokemon, hubPassport }) {
  assertSave(destination)
  if (!regionalGateAllows(destination, pokemon)) return rejected('TRANSFER_NATIONAL_DEX_REQUIRED')
  if (requiresNetworkMachineForPassport(destination, hubPassport) && !destination.networkMachineRestored) return rejected('TRANSFER_NETWORK_MACHINE_REQUIRED')
  return allowed()
}

function resolvePair(sourceTitle, destinationTitle) {
  for (const group of transferRules.directTrade.directionalPairGroups) {
    if (group.sourceTitles.includes(sourceTitle) && group.destinationTitles.includes(destinationTitle)) return group
    if (group.reverseAlso && group.sourceTitles.includes(destinationTitle) && group.destinationTitles.includes(sourceTitle)) {
      return {
        ...group,
        sourceRequires: group.destinationRequires,
        destinationRequires: group.sourceRequires,
        sourceRegionalGate: group.destinationRegionalGate,
        destinationRegionalGate: group.sourceRegionalGate,
      }
    }
  }
  return null
}

function regionalGateAllows(save, pokemon, { directRegionalGate = null } = {}) {
  const titlePolicy = transferRules.titles[save.title]
  if (titlePolicy.nationalDexGate === 'none' || save.nationalDexUnlocked) return true
  if (directRegionalGate !== null && directRegionalGate !== titlePolicy.regionalDex) return true
  if (pokemon.isEgg) return false
  return regionalDexMembers.get(titlePolicy.regionalDex).has(pokemon.nationalDexNumber)
}

function requiresNetworkMachineForPassport(destination, hubPassport) {
  const destinationPolicy = transferRules.titles[destination.title]
  if (destinationPolicy.networkMachineGate !== 'hoenn-links') return false
  return transferRules.hubBoundary.import.networkMachineWhenPassportSourceFamilies.includes(hubPassport?.sourceFamily)
}

function requirementsMet(save, requirements = []) {
  return requirements.every(requirement => Boolean(save[requirement]))
}

function requirementReason(pair, source, destination) {
  return [...(pair.sourceRequires ?? []), ...(pair.destinationRequires ?? [])].includes('networkMachineRestored') && (!source.networkMachineRestored || !destination.networkMachineRestored)
    ? 'TRANSFER_NETWORK_MACHINE_REQUIRED'
    : 'TRANSFER_NATIONAL_DEX_REQUIRED'
}

function retainsSourcePokemon(sourcePokemonCount, minimumAfterMove) {
  return Number.isInteger(sourcePokemonCount) && sourcePokemonCount - 1 >= minimumAfterMove
}

function expandRegionalDex(definition) {
  if (definition.kind === 'inclusive-range') return new Set(Array.from({ length: definition.end - definition.start + 1 }, (_, index) => definition.start + index))
  if (definition.kind === 'explicit-set') return new Set(definition.members)
  throw new TypeError('Generation III regional Dex rule is invalid')
}

function assertSave(save) {
  if (!save || typeof save !== 'object' || !transferRules.titles[save.title]) throw new TypeError('Generation III save capability is invalid')
}

function assertPokemon(pokemon) {
  if (!pokemon || !Number.isInteger(pokemon.nationalDexNumber) || pokemon.nationalDexNumber < 1 || typeof pokemon.isEgg !== 'boolean') throw new TypeError('Generation III Pokemon is invalid')
}

function allowed() { return { allowed: true } }
function rejected(code) { return { allowed: false, reason: { code, message: transferRules.reasonMessages[code] } } }
