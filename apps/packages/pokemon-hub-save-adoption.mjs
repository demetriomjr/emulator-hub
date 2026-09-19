export async function adoptPokemonHubSave({ coordinator, profileId, gameId, saved, adapter, layout }) {
  if (!coordinator || typeof coordinator.adopt !== 'function') throw new TypeError('Pokemon Hub snapshot coordinator is invalid')
  if (!adapter || typeof adapter.readAllSlots !== 'function' || typeof adapter.id !== 'string') throw new TypeError('Pokemon save adapter cannot adopt records')
  if (typeof profileId !== 'string' || !profileId || typeof gameId !== 'string' || !gameId || !saved?.bytes || !Number.isInteger(saved.revision) || saved.revision < 1) throw new TypeError('Pokemon save adoption input is invalid')
  const inspection = typeof adapter.inspect === 'function' ? adapter.inspect(saved.bytes, layout) : null
  return coordinator.adopt({
    profileId,
    sourceKey: `save:${profileId}:${gameId}`,
    sourceRevision: saved.revision,
    adapter: adapter.id,
    ...(inspection?.transferCapabilities ? { transferCapability: inspection.transferCapabilities } : {}),
    slots: adapter.readAllSlots(saved.bytes, layout),
  })
}
