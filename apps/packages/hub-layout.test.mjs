import assert from 'node:assert/strict'
import { test } from 'node:test'

import { groupGamesByLayout } from './hub-layout.mjs'

test('groups Game Boy Advance titles and applies configured release order before other titles', () => {
  const games = [
    { id: 'leafgreen', title: 'Pokémon LeafGreen Version', system: 'gba' },
    { id: 'emerald', title: 'Pokémon Emerald Version', system: 'gba' },
    { id: 'silver', title: 'Pokémon Silver Version', system: 'gbc' },
    { id: 'ruby', title: 'Pokémon Ruby Version', system: 'gba' },
    { id: 'firered', title: 'Pokémon FireRed Version', system: 'gba' },
    { id: 'sapphire', title: 'Pokémon Sapphire Version', system: 'gba' },
    { id: 'crystal', title: 'Pokémon Crystal Version', system: 'gba' },
  ]
  const layout = {
    sections: [{
      id: 'game-boy-advance', title: 'Game Boy Advance', system: 'gba',
      gameIds: ['ruby', 'sapphire', 'emerald', 'firered', 'leafgreen'],
    }],
  }

  assert.deepEqual(groupGamesByLayout(games, layout), [{
    id: 'game-boy-advance', title: 'Game Boy Advance',
    games: ['ruby', 'sapphire', 'emerald', 'firered', 'leafgreen', 'crystal'].map(id => games.find(game => game.id === id)),
  }])
})
