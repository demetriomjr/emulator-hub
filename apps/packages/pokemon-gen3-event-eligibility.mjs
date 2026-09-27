import { pokemonGen3Adapter } from './pokemon-gen3-adapter.mjs'
import { selectUnambiguousPokemonGen3SaveCopy } from './pokemon-gen3-save-validation.mjs'
import transferCapabilityProfiles from './pokemon-gen3-save-capabilities.json' with { type: 'json' }

// Reads progression only; event flags and items are edited by separate tools.
export function inspectPokemonGen3EventEligibility(saveBytes, pokemonSaveTitle) {
  if (!transferCapabilityProfiles.titles[pokemonSaveTitle]) throw invalidTitle()
  selectUnambiguousPokemonGen3SaveCopy(saveBytes)

  const { transferCapabilities } = pokemonGen3Adapter.inspect(saveBytes, { pokemonSaveTitle })
  const { gameClear, nationalDexUnlocked, networkMachineRestored } = transferCapabilities
  return {
    gameClear,
    nationalDexUnlocked,
    networkMachineRestored,
    eligible: gameClear && (pokemonSaveTitle === 'pokemon-ruby' || pokemonSaveTitle === 'pokemon-sapphire' || nationalDexUnlocked) && networkMachineRestored !== false,
  }
}

function invalidTitle() {
  const error = new TypeError('Unsupported Gen III event title.')
  error.code = 'SAVE_UNSUPPORTED'
  return error
}
