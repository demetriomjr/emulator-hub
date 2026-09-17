import profiles from './pokemon-save-layouts.json' with { type: 'json' }

const profilesById = new Map(profiles.profiles.map(profile => [profile.id, profile]))

export function getPokemonSaveLayout(layoutProfileId, adapterId) {
  const profile = profilesById.get(layoutProfileId)
  if (!profile || profile.adapter !== adapterId) return null
  return structuredClone(profile)
}
