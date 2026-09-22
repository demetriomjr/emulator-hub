import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('caps player sessions at six instances in both the control and launch flow', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')

  assert.match(hub, /const MAX_PLAYER_INSTANCES = 6/)
  assert.match(hub, /disabled=\{activeSessions\.length >= MAX_PLAYER_INSTANCES\}/)
  assert.match(hub, /function openInstancePicker\(\)\s*\{\s*if \(isMobileLandscape \|\| activeSessions\.length >= MAX_PLAYER_INSTANCES\) return/)
  assert.match(hub, /async function launchWithProfile\(profile\)\s*\{\s*if \(profilePurpose === 'add-instance' && activeSessions\.length >= MAX_PLAYER_INSTANCES\) return/)
})

test('lays out five and six instances in a two-column, three-row surface with six-cell fullscreen sizing', async () => {
  const css = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8')

  assert.match(css, /\.player-shell-5, \.player-shell-6\s*\{[^}]*calc\(\(100dvh - 52px\)\s*\*\s*1\)\)/)
  assert.match(css, /\.player-panel-5, \.player-panel-6\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1;/)
  assert.match(css, /\.player-panel-5 \.player-grid, \.player-panel-6 \.player-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, 1fr\);[^}]*grid-template-rows:\s*repeat\(3, 1fr\);/)
  assert.match(css, /\.player-shell-5:fullscreen \.player-panel, \.player-shell-6:fullscreen \.player-panel\s*\{[^}]*\*\s*1\)\)/)
})

test('keeps session-wide controls wired to every active iframe', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')

  assert.match(hub, /function broadcastPlayerMessage\(type, payload = \{\}\)\s*\{\s*for \(const frame of document\.querySelectorAll\('\.player-grid iframe'\)\)/)
  assert.match(hub, /emulator-hub:fast-forward[\s\S]*?querySelectorAll\('\.player-grid iframe'\)/)
  assert.match(hub, /global-reset-button[\s\S]*?querySelectorAll\('\.player-grid iframe'\)/)
  assert.match(hub, /saveAttempts: activeSessions\.map\(\(session, index\)/)
})
