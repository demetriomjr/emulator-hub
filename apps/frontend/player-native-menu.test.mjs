import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
const document = await readFile(new URL('./player.html', import.meta.url), 'utf8')

test('hides EmulatorJS toolbar and context menus while keeping game controls', () => {
  const buttons = player.match(/window\.EJS_Buttons = \{([^}]+)\}/)?.[1] ?? ''
  for (const name of ['playPause', 'restart', 'mute', 'settings', 'fullscreen', 'saveState', 'loadState', 'screenRecord', 'gamepad', 'cheat', 'volume', 'saveSavFiles', 'loadSavFiles', 'quickSave', 'quickLoad', 'screenshot', 'cacheManager', 'exitEmulation']) {
    assert.match(buttons, new RegExp(`\\b${name}: false\\b`))
  }
  for (const selector of ['.ejs_menu_bar', '.ejs_context_menu', '.ejs_virtualGamepad_open']) {
    assert.ok(document.includes(`#game ${selector}`))
  }
  assert.match(document, /display:\s*none\s*!important/)
  assert.match(player, /window\.EJS_defaultControls =/)
  assert.match(player, /window\.EJS_VirtualGamepadSettings =/)
})
