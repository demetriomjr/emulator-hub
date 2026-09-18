export function validatePokemonHubTransferPlacement({ origin, destination, sourceAdapter, destinationAdapter }) {
  const sourceLocation = origin?.location
  const destinationLocation = destination?.location
  if (!sourceLocation || !destinationLocation) throw materializationError()
}
function materializationError() {
  const error = new Error('Pokemon Hub can currently persist only compatible Box and grid changes.')
  error.code = 'SAVE_MATERIALIZATION_UNSUPPORTED'
  return error
}
