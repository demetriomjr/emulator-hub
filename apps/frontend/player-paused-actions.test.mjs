import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { isEmulatorPlaying } from '../packages/player-playback.mjs'

const source = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')

test('paused emulators ignore both reset commands before changing the odds clock', () => {
  const begin = source.indexOf("  if (event.data?.type === 'emulator-hub:reset')")
  const end = source.indexOf("  if (event.data?.type === 'emulator-hub:macro-prepare')", begin)
  assert.ok(begin >= 0 && end > begin)
  const actions = []
  const handle = runInNewContext(`function handle(event) {\n${source.slice(begin, end)}\n}\nhandle`, {
    shinyHuntPlayer: null,
    isEmulatorPlaying,
    runtimeReady: true,
    window: { EJS_emulator: { paused: true, gameManager: { restart: () => actions.push('restart') } } },
    stopMacro: () => actions.push('stop-macro'),
    oddsClock: { configure: () => { actions.push('odds'); return true } },
    softResetEmulator: () => actions.push('soft-reset'),
    clientDiagnostics: null,
  })
  handle({ data: { type: 'emulator-hub:reset', oddsResetCount: 2, virtualTimestamp: 120_000 } })
  handle({ data: { type: 'emulator-hub:soft-reset', oddsResetCount: 2, virtualTimestamp: 120_000 } })
  assert.deepEqual(actions, [])
})
