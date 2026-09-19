import { evaluateGenerationIIITransfer, getGenerationIIITitlePolicy } from './pokemon-gen3-transfer-rules.mjs'

export function validatePokemonHubTransferPlacement({ origin, destination, sourceAdapter, destinationAdapter }) {
  const sourceLocation = origin?.location
  const destinationLocation = destination?.location
  if (!sourceLocation || !destinationLocation) throw materializationError()
}

export function createPokemonHubTransferPlacementPolicy() {
  return function validatePlacementChange({ origin, destination, record, source, destinationSource, sourcePokemonCount, sourceAdapter, destinationAdapter }) {
    validatePokemonHubTransferPlacement({ origin, destination, sourceAdapter, destinationAdapter })
    const sourceLocation = origin.location
    const destinationLocation = destination.location
    if (source?.sourceKey && source.sourceKey === destinationSource?.sourceKey) return { allowed: true }
    if (sourceLocation.kind === 'hub' && destinationLocation.kind === 'hub') return { allowed: true }
    const pokemon = pokemonForRules(record)
    if (!pokemon) return { allowed: true }

    if (sourceLocation.kind === 'game' && destinationLocation.kind === 'hub') {
      const sourceCapability = ruleCapability(source?.transferCapability)
      if (!sourceCapability) return { allowed: true }
      const decision = evaluateGenerationIIITransfer({ operation: 'hub-export', source: sourceCapability, pokemon, sourcePokemonCount })
      if (!decision.allowed) return decision
      return { ...decision, ...(record?.hubPassport ? {} : { hubPassport: passportFor(sourceCapability) }) }
    }

    if (sourceLocation.kind === 'hub' && destinationLocation.kind === 'game') {
      const destinationCapability = ruleCapability(destinationSource?.transferCapability)
      if (!destinationCapability || !record?.hubPassport) return { allowed: true }
      return evaluateGenerationIIITransfer({ operation: 'hub-import', destination: destinationCapability, pokemon, hubPassport: record.hubPassport })
    }

    const sourceCapability = ruleCapability(source?.transferCapability)
    const destinationCapability = ruleCapability(destinationSource?.transferCapability)
    if (!sourceCapability || !destinationCapability) return { allowed: true }
    return evaluateGenerationIIITransfer({ operation: 'direct', source: sourceCapability, destination: destinationCapability, pokemon, sourcePokemonCount })
  }
}

function ruleCapability(capability) {
  return capability?.game && !capability.title ? { ...capability, title: capability.game } : capability
}

function pokemonForRules(record) {
  const display = record?.display
  return Number.isInteger(display?.species) && typeof display?.isEgg === 'boolean'
    ? { nationalDexNumber: display.species, isEgg: display.isEgg }
    : null
}

function passportFor(source) {
  return { sourceTitle: source.title, sourceFamily: getGenerationIIITitlePolicy(source.title).family }
}
function materializationError() {
  const error = new Error('Pokemon Hub can currently persist only compatible Box and grid changes.')
  error.code = 'SAVE_MATERIALIZATION_UNSUPPORTED'
  return error
}
