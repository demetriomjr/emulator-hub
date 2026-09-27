import { pokemonGen3Adapter } from './pokemon-gen3-adapter.mjs'
import { readPokemonGen3Flags } from './pokemon-gen3-event-flags.mjs'
import { selectUnambiguousPokemonGen3SaveCopy } from './pokemon-gen3-save-validation.mjs'

const gameClearFlagByTitle = Object.freeze({
  'pokemon-ruby': 0x804,
  'pokemon-sapphire': 0x804,
  'pokemon-emerald': 0x864,
  'pokemon-firered': 0x82c,
  'pokemon-leafgreen': 0x82c,
})

// Reads progression only; event flags and items are edited by separate tools.
export function inspectPokemonGen3EventEligibility(saveBytes, pokemonSaveTitle) {
  const gameClearFlag = gameClearFlagByTitle[pokemonSaveTitle]
  if (gameClearFlag === undefined) throw invalidTitle()
  selectUnambiguousPokemonGen3SaveCopy(saveBytes)

  const { transferCapabilities } = pokemonGen3Adapter.inspect(saveBytes, { pokemonSaveTitle })
  const [gameClear] = readPokemonGen3Flags(saveBytes, pokemonSaveTitle, [gameClearFlag])
  const { nationalDexUnlocked, networkMachineRestored } = transferCapabilities
  return {
    gameClear,
    nationalDexUnlocked,
    networkMachineRestored,
    eligible: gameClear && nationalDexUnlocked && networkMachineRestored !== false,
  }
}

function invalidTitle() {
  const error = new TypeError('Unsupported Gen III event title.')
  error.code = 'SAVE_UNSUPPORTED'
  return error
}
