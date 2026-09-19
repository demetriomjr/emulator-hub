import assert from 'node:assert/strict'
import test from 'node:test'
import { getPokemonHubDragFeedback } from './pokemon-hub-drag-feedback.mjs'

const ruby = { kind: 'game', gameId: 'ruby-game', profileId: 'ruby-profile' }
const emerald = { kind: 'game', gameId: 'emerald-game', profileId: 'emerald-profile' }
const hub = { kind: 'hub', hubProfileId: 'hub-profile' }
const layout = (transferCapabilities, slots = []) => ({ transferCapabilities, party: slots, boxes: [] })
const rubyLayout = layout({ game: 'pokemon-ruby', ordinaryTradeReady: true, nationalDexUnlocked: false, networkMachineRestored: null }, [{ occupied: true }, { occupied: true }])
const emeraldLayout = layout({ game: 'pokemon-emerald', ordinaryTradeReady: true, nationalDexUnlocked: false, networkMachineRestored: null })

test('disables a sprite when the sole visible save destination rejects it', () => {
  const feedback = getPokemonHubDragFeedback({ panes: [ruby, emerald], source: ruby, slot: { occupied: true, species: 252, isEgg: true }, saveLayoutsBySource: { 'ruby-game:ruby-profile': rubyLayout, 'emerald-game:emerald-profile': emeraldLayout } })
  assert.equal(feedback.dragDisabled, true)
  assert.equal(feedback.reason.code, 'TRANSFER_NATIONAL_DEX_REQUIRED')
})

test('treats an omitted Egg marker from the public slot projection as a normal Pokemon', () => {
  const feedback = getPokemonHubDragFeedback({ panes: [ruby, emerald], source: ruby, slot: { occupied: true, species: 152 }, saveLayoutsBySource: { 'ruby-game:ruby-profile': rubyLayout, 'emerald-game:emerald-profile': emeraldLayout } })
  assert.equal(feedback.dragDisabled, true)
  assert.equal(feedback.reason.code, 'TRANSFER_NATIONAL_DEX_REQUIRED')
})

test('keeps dragging available when a Hub destination accepts a Pokemon rejected by the other save', () => {
  const feedback = getPokemonHubDragFeedback({ panes: [ruby, emerald, hub], source: ruby, slot: { occupied: true, species: 252, isEgg: true }, saveLayoutsBySource: { 'ruby-game:ruby-profile': rubyLayout, 'emerald-game:emerald-profile': emeraldLayout } })
  assert.equal(feedback.dragDisabled, false)
  assert.equal(feedback.destinations.find(destination => destination.source === emerald).reason.code, 'TRANSFER_NATIONAL_DEX_REQUIRED')
  assert.equal(feedback.destinations.find(destination => destination.source === hub).allowed, true)
})

test('uses the Hub passport when evaluating a Hub to save overlay', () => {
  const feedback = getPokemonHubDragFeedback({ panes: [hub, { ...ruby, gameId: 'firered-game' }], source: hub, slot: { occupied: true, species: 252, isEgg: false, hubPassport: { sourceTitle: 'pokemon-ruby', sourceFamily: 'hoenn-rs' } }, saveLayoutsBySource: { 'firered-game:ruby-profile': layout({ game: 'pokemon-firered', ordinaryTradeReady: true, nationalDexUnlocked: true, networkMachineRestored: false }) } })
  assert.equal(feedback.dragDisabled, true)
  assert.equal(feedback.reason.code, 'TRANSFER_NETWORK_MACHINE_REQUIRED')
})
