import { pokemonGen3Adapter } from './pokemon-gen3-adapter.mjs'
import { editPokemonGen3Flags } from './pokemon-gen3-event-flags.mjs'
import { pokemonGen3SaveByteOffset, refreshPokemonGen3SaveSectionChecksums, selectUnambiguousPokemonGen3SaveCopy } from './pokemon-gen3-save-validation.mjs'

const supportedTitles = new Set(['pokemon-ruby', 'pokemon-sapphire'])
const nationalDexFlag = 0x836

// Mirrors the persistent Ruby/Sapphire fields written by EnableNationalPokedex.
// The game owns Pokédex scroll positions; their save layout is not assumed here.
export function enableRubySapphireNationalDex(saveBytes, title) {
  if (!supportedTitles.has(title)) throw dexError('National Dex auto-upgrade only supports Ruby and Sapphire.')
  const save = selectUnambiguousPokemonGen3SaveCopy(saveBytes)
  const { transferCapabilities } = pokemonGen3Adapter.inspect(saveBytes, { pokemonSaveTitle: title })
  if (!transferCapabilities.gameClear) throw dexError('Ruby/Sapphire League completion is required.')
  if (transferCapabilities.nationalDexUnlocked) return Buffer.from(saveBytes)

  const candidate = Buffer.from(saveBytes)
  candidate[pokemonGen3SaveByteOffset(save, 'small', 0x18)] = 0
  candidate[pokemonGen3SaveByteOffset(save, 'small', 0x19)] = 1
  candidate[pokemonGen3SaveByteOffset(save, 'small', 0x1a)] = 0xda
  candidate.writeUInt16LE(0x0302, pokemonGen3SaveByteOffset(save, 'large', 0x13cc))
  refreshPokemonGen3SaveSectionChecksums(candidate, save, new Set([0, 1 + Math.floor(0x13cc / 0xf80)]))
  const withFlag = editPokemonGen3Flags(candidate, title, [{ flagId: nationalDexFlag, value: true }])
  if (!pokemonGen3Adapter.inspect(withFlag, { pokemonSaveTitle: title }).transferCapabilities.nationalDexUnlocked) throw dexError('Ruby/Sapphire National Dex upgrade could not be verified.')
  return withFlag
}

function dexError(message) {
  const error = new Error(message)
  error.code = 'SAVE_EVENT_INELIGIBLE'
  return error
}
