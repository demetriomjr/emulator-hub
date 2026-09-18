import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('defines the mobile virtual gamepad without the upstream speed controls', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')

  assert.match(player, /const isMobilePlayerViewport = window\.matchMedia\('\(max-width: 900px\) and \(max-height: 500px\) and \(orientation: landscape\)'\)\.matches/)
  assert.match(player, /window\.EJS_browserMode = isMobilePlayerViewport \? 'mobile' : undefined/)
  assert.match(player, /if \(isMobilePlayerViewport\) window\.EJS_emulator\?\.changeSettingOption\?\.\('virtual-gamepad', 'enabled'\)/)
  assert.match(player, /window\.EJS_VirtualGamepadSettings\s*=\s*\[/)
  assert.match(player, /id:\s*'dpad'/)
  assert.match(player, /id:\s*'start'/)
  assert.match(player, /id:\s*'select'/)
  assert.match(player, /id:\s*'a'/)
  assert.match(player, /id:\s*'b'/)
  assert.doesNotMatch(player, /id:\s*['"]speed_fast['"]|id:\s*['"]speed_slow['"]/)
})
