import assert from 'node:assert/strict'
import test from 'node:test'

import { addWorkspacePane, choosePaneSource, createPokemonHubWorkspaceState } from './pokemon-hub-workspace.mjs'

test('opens the Hub workspace before an Emulator Hub profile is chosen', () => {
  assert.deepEqual(createPokemonHubWorkspaceState(), { profile: null, panes: [null], boxes: {} })
})

test('rejects loading the same Hub profile in two workspace panes', () => {
  const result = choosePaneSource([{ kind: 'hub', hubProfileId: 'shiny' }, null], 1, { kind: 'hub', hubProfileId: 'shiny' })

  assert.deepEqual(result, { panes: [{ kind: 'hub', hubProfileId: 'shiny' }, null], error: 'This Hub profile is already open.' })
})

test('rejects selecting the same game save in two workspace panes', () => {
  const result = choosePaneSource([{ kind: 'game', profileId: 'may', gameId: 'pokemon-emerald' }, null], 1, { kind: 'game', profileId: 'may', gameId: 'pokemon-emerald' })

  assert.deepEqual(result, { panes: [{ kind: 'game', profileId: 'may', gameId: 'pokemon-emerald' }, null], error: 'This game save is already open.' })
})

test('allows distinct sources and a third workspace pane', () => {
  const result = choosePaneSource([null, null], 0, { kind: 'game', profileId: 'may', gameId: 'pokemon-emerald' })
  const second = choosePaneSource(result.panes, 1, { kind: 'hub', hubProfileId: 'shiny' })

  assert.deepEqual(addWorkspacePane(second.panes), [{ kind: 'game', profileId: 'may', gameId: 'pokemon-emerald' }, { kind: 'hub', hubProfileId: 'shiny' }, null])
})

test('does not create more than three workspace panes', () => {
  assert.throws(() => addWorkspacePane([null, null, null]), /three/i)
})
