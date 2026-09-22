import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('loads global player preferences at hub startup and persists trigger/speed changes', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  assert.match(hub, /getUserPreferences\(\)/)
  assert.match(hub, /getUserPreferences\(\)\.then\(\(\{ preferences, initialized \}\)/)
  assert.match(hub, /updateUserPreferences\(partial\)/)
  assert.match(hub, /triggerActions: \{ l2: action \}/)
  assert.match(hub, /triggerActions: \{ r2: action \}/)
  assert.match(hub, /saveUserPreferences\(\{ fastForwardSpeed: speed \}\)/)
  assert.match(hub, /initializeIfAbsent: true/)
  assert.doesNotMatch(hub, /writeFastForwardSpeed\(/)
})

test('queries the first iframe and accepts only its same-origin matching state response', async () => {
  const [hub, player] = await Promise.all([
    readFile(new URL('./src/main.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./src/player.js', import.meta.url), 'utf8'),
  ])
  assert.match(hub, /document\.querySelector\('\.player-grid iframe'\)/)
  assert.match(hub, /emulator-hub:get-fast-forward-state/)
  assert.match(hub, /event\.source !== frame\.contentWindow/)
  assert.match(hub, /emulator-hub:fast-forward-state/)
  assert.match(player, /event\.data\?\.type === 'emulator-hub:get-fast-forward-state'/)
  assert.match(player, /enabled: fastForwardRequest\.enabled/)
})
