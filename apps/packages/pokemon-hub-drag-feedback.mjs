import { createPokemonHubTransferPlacementPolicy } from './pokemon-hub-transfer-placement-policy.mjs'

const validatePlacementChange = createPokemonHubTransferPlacementPolicy()

export function getPokemonHubDragFeedback({ panes, source, slot, saveLayoutsBySource = {} }) {
  if (!slot?.occupied || !isCompleteSource(source) || !hasRulePokemon(slot)) return { dragDisabled: false, destinations: [] }
  const destinations = (panes ?? [])
    .filter(candidate => isCompleteSource(candidate) && !sameSource(candidate, source))
    .map(candidate => ({ source: candidate, ...evaluateDestination({ source, destination: candidate, slot, saveLayoutsBySource }) }))
  const rejected = destinations.filter(destination => !destination.allowed)
  const singleReason = rejected.length === destinations.length && rejected.length > 0 && rejected.every(destination => destination.reason?.code === rejected[0].reason?.code)
  return { dragDisabled: singleReason, reason: singleReason ? rejected[0].reason : undefined, destinations }
}

function evaluateDestination({ source, destination, slot, saveLayoutsBySource }) {
  const sourceLayout = source.kind === 'game' ? saveLayoutsBySource[saveKey(source)] : null
  const destinationLayout = destination.kind === 'game' ? saveLayoutsBySource[saveKey(destination)] : null
  if ((source.kind === 'game' && !sourceLayout?.transferCapabilities) || (destination.kind === 'game' && !destinationLayout?.transferCapabilities)) return { allowed: true }
  return validatePlacementChange({
    origin: { location: sampleLocation(source) },
    destination: { location: sampleLocation(destination) },
    record: { display: { species: slot.species, isEgg: slot.isEgg === true }, ...(slot.hubPassport ? { hubPassport: slot.hubPassport } : {}) },
    source: source.kind === 'game' ? { sourceKey: sourceKey(source), transferCapability: sourceLayout.transferCapabilities } : { sourceKey: sourceKey(source) },
    destinationSource: destination.kind === 'game' ? { sourceKey: sourceKey(destination), transferCapability: destinationLayout.transferCapabilities } : { sourceKey: sourceKey(destination) },
    sourcePokemonCount: source.kind === 'game' ? countOccupiedPokemon(sourceLayout) : null,
  })
}

function sampleLocation(source) { return source.kind === 'hub' ? { kind: 'hub', hubProfileId: source.hubProfileId, slot: 0 } : { kind: 'game', area: 'box', box: 0, slot: 0 } }
function hasRulePokemon(slot) { return Number.isInteger(slot.species) }
function isCompleteSource(source) { return source?.kind === 'hub' ? Boolean(source.hubProfileId) : source?.kind === 'game' && Boolean(source.gameId && source.profileId) }
function sameSource(left, right) { return left.kind === right.kind && (left.kind === 'hub' ? left.hubProfileId === right.hubProfileId : left.gameId === right.gameId && left.profileId === right.profileId) }
function saveKey(source) { return `${source.gameId}:${source.profileId}` }
function sourceKey(source) { return source.kind === 'hub' ? `hub:${source.hubProfileId}` : `save:${source.profileId}:${source.gameId}` }
function countOccupiedPokemon(layout) { return (layout.party ?? []).filter(slot => slot?.occupied).length + (layout.boxes ?? []).flatMap(box => box.slots ?? []).filter(slot => slot?.occupied).length }
