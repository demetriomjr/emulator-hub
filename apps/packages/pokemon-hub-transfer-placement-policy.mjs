export function validatePokemonHubTransferPlacement({ origin, destination, sourceAdapter, destinationAdapter }) {
  const sourceLocation = origin?.location
  const destinationLocation = destination?.location
  if (!sourceLocation || !destinationLocation) throw materializationError()

  if (isHubLocation(sourceLocation) && isGameBoxLocation(destinationLocation)) return
  if (isGameBoxLocation(sourceLocation) && isHubLocation(destinationLocation)) return
  if (isGameBoxLocation(sourceLocation) && isGameBoxLocation(destinationLocation) && sourceAdapter && sourceAdapter === destinationAdapter) return
  throw materializationError()
}

function isHubLocation(location) { return location.kind === 'hub' }
function isGameBoxLocation(location) { return location.kind === 'game' && location.area === 'box' }
function materializationError() {
  const error = new Error('Pokemon Hub can currently persist only compatible Box and grid changes.')
  error.code = 'SAVE_MATERIALIZATION_UNSUPPORTED'
  return error
}
