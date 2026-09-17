import assert from 'node:assert/strict'
import test from 'node:test'

import { choosePaneSource, createPokemonHubWorkspaceState } from './pokemon-hub-workspace.mjs'

test('opens the Hub workspace before an Emulator Hub profile is chosen', () => {
  assert.deepEqual(createPokemonHubWorkspaceState(), { profile: null, panes: { left: { kind: 'hub' }, right: null }, boxes: {} })
})

test('rejects selecting Hub as both workspace panes', () => {
  const result = choosePaneSource({ left: { kind: 'hub' }, right: null }, 'right', { kind: 'hub' })

  assert.deepEqual(result, { panes: { left: { kind: 'hub' }, right: null }, error: 'Pokémon Hub can only be open in one pane.' })
})

test('rejects selecting the same save in both workspace panes', () => {
  const result = choosePaneSource({ left: { kind: 'game', gameId: 'pokemon-emerald' }, right: null }, 'right', { kind: 'game', gameId: 'pokemon-emerald' })

  assert.deepEqual(result, { panes: { left: { kind: 'game', gameId: 'pokemon-emerald' }, right: null }, error: 'The same game save cannot be open in both panes.' })
})

test('allows a game save and Hub to occupy opposite panes', () => {
  const result = choosePaneSource({ left: null, right: null }, 'left', { kind: 'game', gameId: 'pokemon-emerald' })
  const second = choosePaneSource(result.panes, 'right', { kind: 'hub' })

  assert.deepEqual(second, { panes: { left: { kind: 'game', gameId: 'pokemon-emerald' }, right: { kind: 'hub' } }, error: '' })
})
