export function migrateLegacyInventory(legacy, { hubProfileId, hubBoxId }) {
  if (!legacy || legacy.schemaVersion !== 1 || !Array.isArray(legacy.slots) || legacy.slots.length !== 30) throw invalidBox()
  return {
    inventory: {
      schemaVersion: 2, profileId: legacy.profileId, hubEpoch: legacy.hubEpoch, revision: legacy.revision,
      hubProfiles: [{ hubProfileId, name: 'Pokémon Hub', boxOrder: [hubBoxId] }],
    },
    box: { schemaVersion: 1, hubBoxId, hubProfileId, name: 'Box 1', columns: 6, rows: 5, revision: 1, slots: [...legacy.slots] },
  }
}

export function createHubBox({ hubBoxId, hubProfileId, name, columns, rows }) {
  if (typeof hubBoxId !== 'string' || typeof hubProfileId !== 'string' || typeof name !== 'string' || !name.trim() || !Number.isInteger(columns) || columns < 1 || columns > 30 || !Number.isInteger(rows) || rows < 1 || rows > 30) throw invalidBox()
  return { schemaVersion: 1, hubBoxId, hubProfileId, name: name.trim(), columns, rows, revision: 1, slots: Array(columns * rows).fill(null) }
}

function invalidBox() { const error = new Error('Pokémon Hub box is invalid.'); error.code = 'POKEMON_HUB_BOX_INVALID'; return error }
