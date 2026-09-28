import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { createGamepadInputGate } from '../packages/gamepad-input-gate.mjs'
import { getGameProfileNumber } from '../packages/save-profile-display.mjs'
import { saveRunningProfileNames } from '../packages/running-profile-editor.mjs'

const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
const start = hub.indexOf('  function openProfileInfo(')
const end = hub.indexOf('  function openInstancePicker()', start)
assert.ok(start > 0 && end > start, 'running profile editor handlers must exist')
const source = `${hub.slice(start, end)}\n({ openProfileInfo, closeProfileInfo, submitProfileInfo, openHeaderProfileInfo, submitMultiProfileInfo })`

function harness({ fail = false } = {}) {
  const calls = []
  const context = {
    activeSessions: [
      { sessionId: 'a', gameId: 'red', gameTitle: 'Pokémon Red', profileId: 'p1', profileName: 'Red' },
      { sessionId: 'b', gameId: 'blue', gameTitle: 'Pokémon Blue', profileId: 'p2', profileName: 'Blue' },
    ],
    games: [
      { id: 'red', title: 'Pokémon Red', profiles: [{ id: 'p1', createdAt: '2026-01-01T00:00:00Z' }] },
      { id: 'blue', title: 'Pokémon Blue', profiles: [{ id: 'p2', createdAt: '2026-01-01T00:00:00Z' }] },
    ],
    focusedSessionId: 'b', profileInfoSessionId: null, profileInfoName: '', profileInfoBusy: false,
    multiProfileRows: null, multiProfileBusy: false,
    getGameProfileNumber, saveRunningProfileNames,
    profileInfoGamepadGatesRef: { current: new Map() },
    createGamepadInputGate,
    readGamepadSnapshot: () => ['BUTTON_1'],
    activeGamepadBindings: snapshot => snapshot,
    setProfileInfoSessionId(value) { context.profileInfoSessionId = value },
    setProfileInfoName(value) { context.profileInfoName = value },
    setProfileInfoError(value) { context.profileInfoError = value },
    setProfileInfoBusy(value) { context.profileInfoBusy = value },
    setMultiProfileRows(value) { context.multiProfileRows = typeof value === 'function' ? value(context.multiProfileRows) : value },
    setMultiProfileBusy(value) { context.multiProfileBusy = value },
    setMultiProfileError(value) { context.multiProfileError = value },
    setActiveSessions(transform) { context.activeSessions = transform(context.activeSessions) },
    setProfiles(transform) { context.profiles = transform(context.profiles ?? []) },
    updateCachedProfiles(gameId, transform) { calls.push(['cache', gameId, transform([{ id: 'p2', name: 'Blue' }])]) },
    replaceCatalogProfile(current, updated) { return current.map(profile => profile.id === updated.id ? updated : profile) },
    handleGlobalProfileSaved(gameId, updated) { calls.push(['saved', gameId, updated.id, updated.name]) },
    async updateProfile(gameId, profileId, name) {
      calls.push(['patch', gameId, profileId, name])
      if (fail) throw new Error('Falha ao salvar')
      return { id: profileId, name, createdAt: '2026-01-01T00:00:00Z', oddsResetCount: 0 }
    },
  }
  const api = runInNewContext(source, context)
  return { api, context, calls }
}

test('information button edits the focused running profile and persists it immediately', async () => {
  const { api, context, calls } = harness()
  api.openProfileInfo()
  assert.equal(context.profileInfoSessionId, 'b')
  assert.equal(context.profileInfoName, 'Blue')
  assert.deepEqual(context.profileInfoGamepadGatesRef.current.get('b').filter(['BUTTON_1']), [])
  context.profileInfoName = 'Blue II'
  await api.submitProfileInfo({ preventDefault() {} })
  assert.deepEqual(calls[0], ['patch', 'blue', 'p2', 'Blue II'])
  assert.equal(context.activeSessions[1].profileName, 'Blue II')
  assert.equal(calls[1][1], 'blue')
  assert.equal(calls[1][2][0].name, 'Blue II')
  assert.equal(context.profileInfoSessionId, null)
  assert.deepEqual(context.profileInfoGamepadGatesRef.current.get('b').filter(['BUTTON_1', 'BUTTON_2']), ['BUTTON_2'])
})

test('closing the editor discards the draft and releases held buttons individually', () => {
  const { api, context } = harness()
  api.openProfileInfo()
  assert.deepEqual(context.profileInfoGamepadGatesRef.current.get('b').filter(['BUTTON_1']), [])
  context.profileInfoName = 'Unsaved'
  api.closeProfileInfo()
  assert.equal(context.profileInfoSessionId, null)
  assert.deepEqual(context.profileInfoGamepadGatesRef.current.get('b').filter(['BUTTON_1', 'BUTTON_2']), ['BUTTON_2'])
  assert.equal(context.activeSessions[1].profileName, 'Blue')
})

test('switching the editor to another running session unlocks the prior session', () => {
  const { api, context } = harness()
  api.openProfileInfo()
  const formerGate = context.profileInfoGamepadGatesRef.current.get('b')
  context.focusedSessionId = 'a'
  api.openProfileInfo()
  assert.equal(context.profileInfoSessionId, 'a')
  assert.deepEqual(formerGate.filter(['BUTTON_1', 'BUTTON_2']), ['BUTTON_2'])
  assert.deepEqual(context.profileInfoGamepadGatesRef.current.get('a').filter(['BUTTON_1']), [])
})

test('information overlay opens the profile of its own emulator', () => {
  const { api, context } = harness()
  api.openProfileInfo('a')
  assert.equal(context.profileInfoSessionId, 'a')
  assert.equal(context.profileInfoName, 'Red')
})

test('header information lists every open player with fixed save numbers and editable names', () => {
  const { api, context } = harness()
  api.openHeaderProfileInfo()
  assert.deepEqual(context.multiProfileRows.map(row => [row.gameTitle, row.number, row.name]), [
    ['Pokémon Red', 1, 'Red'], ['Pokémon Blue', 1, 'Blue'],
  ])
  assert.equal(context.profileInfoSessionId, null)
})

test('one save submits names for every open player and closes after success', async () => {
  const { api, context, calls } = harness()
  api.openHeaderProfileInfo()
  context.multiProfileRows[0].name = 'Red II'
  context.multiProfileRows[1].name = 'Blue II'
  await api.submitMultiProfileInfo({ preventDefault() {} })
  assert.deepEqual(calls.filter(call => call[0] === 'patch'), [
    ['patch', 'red', 'p1', 'Red II'], ['patch', 'blue', 'p2', 'Blue II'],
  ])
  assert.equal(calls.filter(call => call[0] === 'saved').length, 2)
  assert.equal(context.multiProfileRows, null)
})

test('header information keeps the single player editor when only one is open', () => {
  const { api, context } = harness()
  context.activeSessions = [context.activeSessions[0]]
  api.openHeaderProfileInfo()
  assert.equal(context.profileInfoSessionId, 'a')
  assert.equal(context.multiProfileRows, null)
})

test('failed profile save keeps its editor open with the entered name', async () => {
  const { api, context } = harness({ fail: true })
  api.openProfileInfo()
  context.profileInfoName = 'Blue II'
  await api.submitProfileInfo({ preventDefault() {} })
  assert.equal(context.profileInfoSessionId, 'b')
  assert.equal(context.profileInfoName, 'Blue II')
  assert.equal(context.profileInfoError, 'Falha ao salvar')
})

test('information control and editor live in the selected player cell', () => {
  assert.match(hub, /aria-label="Informações do perfil"/)
  assert.match(hub, /profileInfoSessionId === session\.sessionId && <div className="profile-info-overlay"/)
})
