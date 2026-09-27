import assert from 'node:assert/strict'
import test from 'node:test'
import * as dragFeedback from './pokemon-hub-drag-feedback.mjs'

const { getPokemonHubDragFeedback } = dragFeedback

const ruby = { kind: 'game', gameId: 'ruby-game', profileId: 'ruby-profile' }
const emerald = { kind: 'game', gameId: 'emerald-game', profileId: 'emerald-profile' }
const hub = { kind: 'hub', hubProfileId: 'hub-profile' }
const layout = (transferCapabilities, slots = []) => ({ transferCapabilities, party: slots, boxes: [] })
const rubyLayout = layout({ game: 'pokemon-ruby', ordinaryTradeReady: true, nationalDexUnlocked: false, networkMachineRestored: null }, [{ occupied: true }, { occupied: true }])
const emeraldLayout = layout({ game: 'pokemon-emerald', ordinaryTradeReady: true, nationalDexUnlocked: false, networkMachineRestored: null })

test('marks only drops from outside the Party into the Party as forbidden', () => {
  assert.equal(typeof dragFeedback.isPokemonHubPartyDropForbidden, 'function')
  const { isPokemonHubPartyDropForbidden } = dragFeedback
  const party = { kind: 'game', area: 'party', slot: 0 }
  const box = { kind: 'game', area: 'box', box: 0, slot: 0 }
  const hubSlot = { kind: 'hub', slot: 0 }
  assert.equal(isPokemonHubPartyDropForbidden(box, party), true)
  assert.equal(isPokemonHubPartyDropForbidden(hubSlot, party), true)
  assert.equal(isPokemonHubPartyDropForbidden(party, { ...party, slot: 1 }), false)
  assert.equal(isPokemonHubPartyDropForbidden(box, { ...box, slot: 1 }), false)
})

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
  const unlockedRubyLayout = layout({ game: 'pokemon-ruby', ordinaryTradeReady: true, nationalDexUnlocked: true, gameClear: true, networkMachineRestored: null }, [{ occupied: true }, { occupied: true }])
  const feedback = getPokemonHubDragFeedback({ panes: [ruby, emerald, hub], source: ruby, slot: { occupied: true, species: 252, isEgg: true }, saveLayoutsBySource: { 'ruby-game:ruby-profile': unlockedRubyLayout, 'emerald-game:emerald-profile': emeraldLayout } })
  assert.equal(feedback.dragDisabled, false)
  assert.equal(feedback.destinations.find(destination => destination.source === emerald).reason.code, 'TRANSFER_NATIONAL_DEX_REQUIRED')
  assert.equal(feedback.destinations.find(destination => destination.source === hub).allowed, true)
})

test('uses the Hub passport when evaluating a Hub to save overlay', () => {
  const feedback = getPokemonHubDragFeedback({ panes: [hub, { ...ruby, gameId: 'firered-game' }], source: hub, slot: { occupied: true, species: 252, isEgg: false, hubPassport: { sourceTitle: 'pokemon-ruby', sourceFamily: 'hoenn-rs' } }, saveLayoutsBySource: { 'firered-game:ruby-profile': layout({ game: 'pokemon-firered', ordinaryTradeReady: true, nationalDexUnlocked: true, networkMachineRestored: false }) } })
  assert.equal(feedback.dragDisabled, true)
  assert.equal(feedback.reason.code, 'TRANSFER_NETWORK_MACHINE_REQUIRED')
})

test('marks a locked save-to-Hub destination while keeping local save dragging available', () => {
  const slot = { occupied: true, species: 25, isEgg: false }
  const locked = getPokemonHubDragFeedback({
    panes: [ruby, hub], source: ruby, slot,
    saveLayoutsBySource: { 'ruby-game:ruby-profile': layout({ game: 'pokemon-ruby', nationalDexUnlocked: false, gameClear: true }, [{ occupied: true }, { occupied: true }]) },
  })
  assert.equal(locked.destinations[0].allowed, false)
  assert.equal(locked.destinations[0].reason.code, 'TRANSFER_NATIONAL_DEX_REQUIRED')
  assert.equal(locked.dragDisabled, false)

  const unverified = getPokemonHubDragFeedback({ panes: [ruby, hub], source: ruby, slot, saveLayoutsBySource: { 'ruby-game:ruby-profile': layout(null, [{ occupied: true }, { occupied: true }]) } })
  assert.equal(unverified.destinations[0].reason.code, 'TRANSFER_EXPORT_UNVERIFIED')
  assert.equal(unverified.dragDisabled, false)
})
