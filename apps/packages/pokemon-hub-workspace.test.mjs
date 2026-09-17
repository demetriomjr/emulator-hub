import assert from 'node:assert/strict'
import test from 'node:test'

import { addWorkspacePane, choosePaneSource, createPokemonHubWorkspaceState, isPaneSourceAvailable, removeWorkspacePane } from './pokemon-hub-workspace.mjs'

test('opens directly into an empty Hub workspace without selecting an Emulator Hub profile', () => {
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

test('hides occupied complete sources from other pane selectors while retaining the current value', () => {
  const hub = { kind: 'hub', hubProfileId: 'general' }
  const game = { kind: 'game', profileId: 'may', gameId: 'pokemon-emerald' }
  const panes = [hub, game, { kind: 'hub' }]

  assert.equal(isPaneSourceAvailable(panes, 0, hub), true)
  assert.equal(isPaneSourceAvailable(panes, 1, hub), false)
  assert.equal(isPaneSourceAvailable(panes, 2, hub), false)
  assert.equal(isPaneSourceAvailable(panes, 0, game), false)
  assert.equal(isPaneSourceAvailable(panes, 1, game), true)
  assert.equal(isPaneSourceAvailable(panes, 2, { kind: 'hub' }), true)
})

test('appends an empty terminal pane until the three-pane limit', () => {
  const result = choosePaneSource([null, null], 0, { kind: 'game', profileId: 'may', gameId: 'pokemon-emerald' })
  const second = choosePaneSource(result.panes, 1, { kind: 'hub', hubProfileId: 'shiny' })

  assert.deepEqual(addWorkspacePane(second.panes), [{ kind: 'game', profileId: 'may', gameId: 'pokemon-emerald' }, { kind: 'hub', hubProfileId: 'shiny' }, null])
})

test('does not create more than three workspace panes', () => {
  assert.throws(() => addWorkspacePane([null, null, null]), /three/i)
})

test('removes only the requested pane and will not remove the final pane', () => {
  const first = { kind: 'hub', hubProfileId: 'shiny' }
  const second = { kind: 'game', profileId: 'may', gameId: 'pokemon-emerald' }
  const third = { kind: 'hub', hubProfileId: 'living-dex' }

  assert.deepEqual(removeWorkspacePane([first, second, third], 1), [first, third])
  assert.deepEqual(removeWorkspacePane([first, second], 0), [second])
  assert.throws(() => removeWorkspacePane([first], 0), /at least one/i)
})

test('releases a removed source and ignores incomplete source type choices when checking duplicates', () => {
  const existing = { kind: 'game', profileId: 'may', gameId: 'pokemon-emerald' }
  const typeChoice = choosePaneSource([existing, { kind: 'game' }], 1, { kind: 'game' })
  assert.equal(typeChoice.error, '')

  const released = removeWorkspacePane([existing, null], 0)
  const reused = choosePaneSource([...released, null], 1, existing)
  assert.equal(reused.error, '')
  assert.deepEqual(reused.panes, [null, existing])
})
