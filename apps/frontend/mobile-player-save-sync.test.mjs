import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('accepts same-origin close-save messages without relying on the parent WindowProxy identity', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')

  assert.match(player, /if \(event\.origin !== location\.origin\) return/)
  assert.doesNotMatch(player, /event\.source !== window\.parent/)
  assert.match(player, /window\.emulatorHubSyncSave = synchronizeCloudSave/)
})

test('uses the iframe same-origin save synchronizer before falling back to postMessage', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')

  assert.match(hub, /const directSync = frame\.contentWindow\?\.emulatorHubSyncSave/)
  assert.match(hub, /if \(typeof directSync === 'function'\) \{\s*Promise\.resolve\(directSync\(\)\)\.then\(\(\) => finish\(\), finish\)\s*return/s)
})

test('refreshes lease availability every three seconds only while the profile picker is open', async () => {
  const source = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  assert.match(source, /if \(!profileGame\) return undefined[\s\S]*getProfiles\(profileGame\.id\)[\s\S]*window\.setInterval\(refreshProfiles, 3_000\)[\s\S]*window\.clearInterval\(interval\)/)
})

test('verifies an optional launch IPS and provides it to EmulatorJS as a Blob URL', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')

  assert.match(player, /launch\.patchUrl[\s\S]*fetch\(launch\.patchUrl, \{ cache: 'no-store' \}\)/)
  assert.match(player, /patch bytes did not match the launch descriptor/i)
  assert.match(player, /window\.EJS_gamePatchUrl = URL\.createObjectURL\(new Blob\(\[patchBytes\]\)\)/)
})
