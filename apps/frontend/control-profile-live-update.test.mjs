import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('updates controls in a running player without recreating its iframe', async () => {
  const [hub, player] = await Promise.all([
    readFile(new URL('./src/main.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./src/player.js', import.meta.url), 'utf8'),
  ])

  assert.doesNotMatch(hub, /setControlRevision/)
  assert.doesNotMatch(hub, /key=\{`\$\{session\.gameId\}:\$\{session\.profileId\}:\$\{controlRevision\}`\}/)
  assert.match(hub, /broadcastPlayerMessage\('emulator-hub:control-profile', \{ bindings: profile\.bindings \}\)/)
  assert.match(player, /event\.data\?\.type === 'emulator-hub:control-profile'/)
  assert.match(player, /gamepadInput\?\.setBindings\(bindings\)/)
})
