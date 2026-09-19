import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('defines the approved scaled mobile virtual gamepad without upstream speed controls', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')

  assert.match(player, /const isMobilePlayerViewport = window\.matchMedia\('\(max-width: 900px\) and \(max-height: 500px\) and \(orientation: landscape\)'\)\.matches/)
  assert.match(player, /window\.EJS_browserMode = isMobilePlayerViewport \? 'mobile' : undefined/)
  assert.match(player, /if \(isMobilePlayerViewport\) window\.EJS_emulator\?\.changeSettingOption\?\.\('virtual-gamepad', 'enabled'\)/)
  assert.match(player, /window\.EJS_VirtualGamepadSettings\s*=\s*\[/)
  assert.match(player, /type:\s*'zone',\s*id:\s*'dpad',\s*location:\s*'left',\s*left:\s*'50%',\s*top:\s*'50%',\s*joystickInput:\s*false,\s*inputValues:\s*\[4, 5, 6, 7\]/)
  assert.match(player, /const mobileGamepadLayout = Object\.freeze\(\[/)
  assert.match(player, /id: 'dpad', x: 133, y: 263, size: 195, shape: 'zone'/)
  assert.match(player, /id: 'a', x: 672, y: 323, size: 91, shape: 'round'/)
  assert.match(player, /id: 'start', x: 494, y: 313, size: 95, shape: 'block'/)
  assert.match(player, /applyMobileGamepadLayout\(\)/)
  assert.match(player, /id:\s*'start'/)
  assert.match(player, /id:\s*'select'/)
  assert.match(player, /id:\s*'a'/)
  assert.match(player, /id:\s*'b'/)
  assert.doesNotMatch(player, /id:\s*['"]speed_fast['"]|id:\s*['"]speed_slow['"]/)
})
