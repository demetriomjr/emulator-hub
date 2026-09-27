const gen3SaveBytes = 0x20000

// This validator is shared by the browser and backend. Keep it independent of
// Node APIs so the player can reject incomplete EmulatorJS reads before upload.
export function selectNewestPokemonGen3SaveCopy(saveBytes) {
  if (!(saveBytes instanceof Uint8Array)) throw invalidSave('A Gen III save is required.')
  if (saveBytes.byteLength !== gen3SaveBytes) throw invalidSave('A Gen III save must be exactly 128 KiB.')
  if (saveBytes.every(byte => byte === 0xff)) throw invalidSave('A Gen III save must be initialized.')

  const view = new DataView(saveBytes.buffer, saveBytes.byteOffset, saveBytes.byteLength)
  const copies = [readSaveCopy(view, 0), readSaveCopy(view, 0xe000)].filter(copy => copy !== null)
  if (!copies.length) throw invalidSave('A valid initialized Gen III save is required.')
  return copies.reduce((current, candidate) => candidate.saveIndex > current.saveIndex ? candidate : current)
}

// Save-editing callers must not choose arbitrarily between two equally recent
// but different valid copies. Read-only consumers retain the existing selector.
export function selectUnambiguousPokemonGen3SaveCopy(saveBytes) {
  const selected = selectNewestPokemonGen3SaveCopy(saveBytes)
  const view = new DataView(saveBytes.buffer, saveBytes.byteOffset, saveBytes.byteLength)
  const other = readSaveCopy(view, selected.copyOffset === 0 ? 0xe000 : 0)
  if (other?.saveIndex === selected.saveIndex) {
    for (let sectionId = 0; sectionId < 14; sectionId += 1) {
      const length = sectionLength(sectionId)
      const left = selected.sectors.get(sectionId).offset
      const right = other.sectors.get(sectionId).offset
      for (let index = 0; index < length; index += 1) {
        if (saveBytes[left + index] !== saveBytes[right + index]) {
          const error = invalidSave('Gen III save copies are ambiguous.')
          error.code = 'SAVE_AMBIGUOUS'
          throw error
        }
      }
    }
  }
  return selected
}

export function pokemonGen3SaveByteOffset(save, block, offset) {
  if (!Number.isInteger(offset) || offset < 0 || !['small', 'large'].includes(block)) throw invalidSave('Gen III save block offset is invalid.')
  const sectionId = block === 'small' ? 0 : 1 + Math.floor(offset / 0xf80)
  const localOffset = block === 'small' ? offset : offset % 0xf80
  if (sectionId > 4 || localOffset >= sectionLength(sectionId)) throw invalidSave('Gen III save block offset is invalid.')
  const section = save?.sectors?.get(sectionId)
  if (!section) throw invalidSave('Gen III save section is missing.')
  return section.offset + localOffset
}

export function refreshPokemonGen3SaveSectionChecksums(saveBytes, save, sectionIds) {
  if (!(saveBytes instanceof Uint8Array) || !(sectionIds instanceof Set)) throw invalidSave('Gen III save edit is invalid.')
  const view = new DataView(saveBytes.buffer, saveBytes.byteOffset, saveBytes.byteLength)
  for (const sectionId of sectionIds) {
    const section = save?.sectors?.get(sectionId)
    if (!section) throw invalidSave('Gen III save section is missing.')
    view.setUint16(section.offset + 0xff6, sectorChecksum(view, section.offset, sectionId), true)
  }
  const verified = selectUnambiguousPokemonGen3SaveCopy(saveBytes)
  if (verified.copyOffset !== save.copyOffset || verified.saveIndex !== save.saveIndex) throw invalidSave('Gen III save edit changed active copy.')
  return saveBytes
}

function readSaveCopy(view, copyOffset) {
  const sectors = new Map()
  let saveIndex
  for (let physicalIndex = 0; physicalIndex < 14; physicalIndex += 1) {
    const offset = copyOffset + physicalIndex * 0x1000
    const sectionId = view.getUint16(offset + 0xff4, true)
    const checksum = view.getUint16(offset + 0xff6, true)
    const signature = view.getUint32(offset + 0xff8, true)
    const sectorSaveIndex = view.getUint32(offset + 0xffc, true)
    if (sectionId > 13 || signature !== 0x08012025 || sectors.has(sectionId) || checksum !== sectorChecksum(view, offset, sectionId)) return null
    if (saveIndex !== undefined && saveIndex !== sectorSaveIndex) return null
    saveIndex = sectorSaveIndex
    sectors.set(sectionId, { offset, sectionId })
  }
  return sectors.size === 14 ? { copyOffset, saveIndex, sectors } : null
}

function sectorChecksum(view, offset, sectionId) {
  const length = sectionLength(sectionId)
  let sum = 0
  for (let index = 0; index < length; index += 4) sum = (sum + view.getUint32(offset + index, true)) >>> 0
  return ((sum & 0xffff) + (sum >>> 16)) & 0xffff
}

function sectionLength(sectionId) { return sectionId === 0 ? 3884 : sectionId === 13 ? 2000 : 3968 }

function invalidSave(message) {
  const error = new Error(message)
  error.code = 'SAVE_UNSUPPORTED'
  return error
}
