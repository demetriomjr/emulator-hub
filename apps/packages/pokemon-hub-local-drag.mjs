export function applyPokemonHubLocalDrop(state, sourceLocation, targetLocation) {
  const unchanged = { action: 'none', hubProfiles: state?.hubProfiles, saveLayoutsBySource: state?.saveLayoutsBySource }
  if (!state || sameLocation(sourceLocation, targetLocation)) return unchanged
  if (sourceLocation?.kind !== targetLocation?.kind) return unchanged

  const sourceSlot = readSlot(state, sourceLocation)
  const targetSlot = readSlot(state, targetLocation)
  if (!sourceSlot?.occupied || !targetSlot) return unchanged

  const action = targetSlot.occupied
    ? (canSwap(sourceLocation, targetLocation) ? 'swap' : 'none')
    : 'move'
  if (action === 'none') return unchanged

  let hubProfiles = state.hubProfiles
  let saveLayoutsBySource = state.saveLayoutsBySource
  ;({ hubProfiles, saveLayoutsBySource } = writeSlot({ hubProfiles, saveLayoutsBySource }, sourceLocation, action === 'swap' ? targetSlot : { occupied: false }))
  ;({ hubProfiles, saveLayoutsBySource } = writeSlot({ hubProfiles, saveLayoutsBySource }, targetLocation, sourceSlot))

  return { action, hubProfiles, saveLayoutsBySource }
}

function readSlot(state, location) {
  if (!location || !Number.isInteger(location.slot) || location.slot < 0) return null

  if (location.kind === 'hub') {
    const profile = state.hubProfiles?.find(candidate => candidate.hubProfileId === location.hubProfileId)
    if (!profile?.grid?.entries) return null
    const entry = profile.grid.entries[location.slot]
    return entry ? { occupied: true, ...entry } : { occupied: false }
  }

  const layout = state.saveLayoutsBySource?.[saveKey(location)]
  if (!layout) return null
  if (location.kind !== 'game') return null
  if (location.area === 'party') return layout.party?.[location.slot] ?? null
  if (location.area === 'box') return layout.boxes?.[location.box]?.slots?.[location.slot] ?? null
  return null
}

function writeSlot(state, location, slot) {
  if (location.kind === 'hub') return {
    ...state,
    hubProfiles: state.hubProfiles.map(profile => {
      if (profile.hubProfileId !== location.hubProfileId) return profile
      const entries = { ...profile.grid.entries }
      if (slot.occupied) {
        const { occupied, ...entry } = slot
        entries[location.slot] = entry
      } else delete entries[location.slot]
      return { ...profile, grid: { ...profile.grid, entries } }
    }),
  }

  const key = saveKey(location)
  const layout = state.saveLayoutsBySource[key]
  if (location.area === 'party') {
    const party = [...layout.party]
    party[location.slot] = slot
    return { ...state, saveLayoutsBySource: { ...state.saveLayoutsBySource, [key]: { ...layout, party } } }
  }

  const boxes = layout.boxes.map((box, index) => {
    if (index !== location.box) return box
    const slots = [...box.slots]
    slots[location.slot] = slot
    return { ...box, slots }
  })
  return { ...state, saveLayoutsBySource: { ...state.saveLayoutsBySource, [key]: { ...layout, boxes } } }
}

function canSwap(source, target) {
  if (source.kind === 'hub' || target.kind === 'hub') {
    return source.kind === 'hub' && target.kind === 'hub' && source.hubProfileId === target.hubProfileId
  }

  return source.kind === 'game'
    && target.kind === 'game'
    && source.gameId === target.gameId
    && source.profileId === target.profileId
    && ((source.area === 'party' && target.area === 'party')
      || (source.area === 'box' && target.area === 'box' && source.box === target.box))
}

function sameLocation(source, target) {
  if (!source || !target || source.kind !== target.kind || source.slot !== target.slot) return false
  if (source.kind === 'hub') return source.hubProfileId === target.hubProfileId
  return source.gameId === target.gameId
    && source.profileId === target.profileId
    && source.area === target.area
    && source.box === target.box
}

function saveKey(location) {
  return `${location.gameId}:${location.profileId}`
}
