import profiles from './pokemon-save-layouts.json' with { type: 'json' }

const profilesById = new Map(profiles.profiles.map(profile => [profile.id, profile]))

export function getPokemonSaveLayout(layoutProfileId, adapterId, pokemonSaveTitle = null) {
  const profile = profilesById.get(layoutProfileId)
  if (!profile || profile.adapter !== adapterId || (pokemonSaveTitle !== null && !profile.titles.includes(pokemonSaveTitle))) return null
  return structuredClone({ ...profile, ...(pokemonSaveTitle !== null ? { pokemonSaveTitle } : profile.titles.length === 1 ? { pokemonSaveTitle: profile.titles[0] } : {}) })
}

export function getPokemonSaveMetadataForTitle(title) {
  const titleId = titleIdForDisplayTitle(title)
  if (!titleId) return null
  const profile = profiles.profiles.find(candidate => candidate.titles.includes(titleId))
  if (!profile) return null
  return { adapter: profile.adapter, layoutProfile: profile.id, title: titleId, saveKind: 'battery', supported: true }
}

function titleIdForDisplayTitle(title) {
  const normalized = typeof title === 'string'
    ? title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '')
    : ''
  return profiles.titleAliases[normalized] ?? null
}
