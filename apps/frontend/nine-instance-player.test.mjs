import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('the existing add guards share a nine-player cap', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  assert.match(hub, /const MAX_PLAYER_INSTANCES = 9/)
  assert.match(hub, /disabled=\{activeSessions\.length >= MAX_PLAYER_INSTANCES\}/)
  assert.match(hub, /function openInstancePicker\(\)\s*\{\s*if \(isMobileLandscape \|\| activeSessions\.length >= MAX_PLAYER_INSTANCES\) return/)
  assert.match(hub, /async function launchWithProfile\(profile\)\s*\{\s*if \(profilePurpose === 'add-instance' && activeSessions\.length >= MAX_PLAYER_INSTANCES\) return/)
  assert.match(hub, /setActiveSessions\(current => current\.length >= MAX_PLAYER_INSTANCES \? current : \[\.\.\.current, session\]\)/)
})

test('seven through nine players occupy a third row of three proportional cells', async () => {
  const css = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8')
  for (const count of [7, 8, 9]) {
    assert.match(css, new RegExp(`\\.player-panel-${count}(?:,| \\.player-grid| \\{)`))
  }
  assert.match(css, /\.player-panel-7, \.player-panel-8, \.player-panel-9 \{ aspect-ratio: 3 \/ 2; \}/)
  assert.match(css, /\.player-panel-7 \.player-grid, \.player-panel-8 \.player-grid, \.player-panel-9 \.player-grid \{ grid-template-columns: repeat\(3, 1fr\); grid-template-rows: repeat\(3, 1fr\); \}/)
  assert.match(css, /\.player-grid \{ display: grid; width: 100%; height: 100%/)
  assert.match(css, /\.player-shell:fullscreen \.player-panel\s*\{[^}]*calc\(\(100dvh - 52px\) \* 1\.5\)/)
})

test('local development defaults to nine independent player origins', async () => {
  const source = await readFile(new URL('./scripts/dev.mjs', import.meta.url), 'utf8')
  assert.match(source, /Array\.from\(\{ length: 9 \}, \(_, slot\) => hubPort \+ slot \+ 1\)/)
})
