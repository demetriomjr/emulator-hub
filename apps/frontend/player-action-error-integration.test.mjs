import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const parent = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')

test('player initiated failures are scoped to the originating iframe and shown in its cell', () => {
  assert.match(player, /type: 'emulator-hub:player-action-failed', sessionId, gameId: id, profileId, action/)
  assert.match(parent, /event\.data\?\.type === 'emulator-hub:player-action-failed'/)
  assert.match(parent, /candidate\.contentWindow === event\.source/)
  assert.match(parent, /event\.data\.sessionId !== session\.sessionId \|\| event\.data\.gameId !== session\.gameId \|\| event\.data\.profileId !== session\.profileId/)
  assert.match(parent, /playerActionErrors\[session\.sessionId\].*role="alert"/s)
})

test('automatic discard failures are not sent to the player', () => {
  const discard = player.slice(player.indexOf('function scheduleCloudRecoveryDeleteAfterChoice('), player.indexOf('async function closeEmulator()'))
  assert.doesNotMatch(discard, /reportPlayerActionFailure/)
})
