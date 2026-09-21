import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('accepts same-origin close-player messages without relying on the parent WindowProxy identity', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')

  assert.match(player, /if \(event\.origin !== location\.origin\) return/)
  assert.match(player, /isClosePlayerMessage = event\.data\?\.type === 'emulator-hub:close-player'[\s\S]*?!isClosePlayerMessage && event\.source !== window\.parent/)
  assert.match(player, /window\.emulatorHubClose = closeEmulator/)
  assert.match(player, /event\.data\?\.type === 'emulator-hub:close-player'/)
})

test('uses the iframe same-origin save synchronizer before falling back to postMessage', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')

  assert.match(hub, /const directSync = frame\.contentWindow\?\.emulatorHubClose/)
  assert.match(hub, /if \(typeof directSync === 'function'\) \{\s*Promise\.resolve\(directSync\(\)\)\.then\(\(\) => finish\(\), finish\)\s*return/s)
  assert.match(hub, /type: 'emulator-hub:close-player'/)
})

test('uploads battery saves from EmulatorJS save events and keeps periodic snapshots state-only', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  assert.match(player, /observeEmulatorSaveFiles\(emulator, queueCloudSave\)/)
  assert.match(player, /const traceId = crypto\.randomUUID\(\)/)
  assert.match(player, /cloudSaveSynchronizer\.syncBytes\(copy, traceId\)/)
  assert.match(player, /logger: logSavePipeline/)
  assert.match(player, /putCloudSave\(launch\.saveUrl, bytes, revision,[\s\S]*?traceId, logSavePipeline\)/)
  assert.match(player, /saveRevision: cloudSaveSynchronizer\.getRevision\(\)/)
  const snapshotCapture = player.slice(player.indexOf('async function persistEmulatorState()'), player.indexOf('async function closeEmulator()'))
  assert.match(snapshotCapture, /manager\.getState\?\.\(\)/)
  assert.doesNotMatch(snapshotCapture, /saveSaveFiles|getSaveFile|syncBytes|\.sav/)
  assert.match(player, /restoreSnapshotState\(savedSnapshot,[\s\S]*?window\.confirm\(/)
})

test('flushes the current gameManager battery save when closing even if no save event fired', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  const closePlayer = player.slice(player.indexOf('async function closeEmulator()'), player.indexOf('window.emulatorHubClose'))

  assert.match(closePlayer, /window\.EJS_emulator\?\.gameManager\?\.getSaveFile\?\.\(\)/)
  assert.match(closePlayer, /queueCloudSave\(finalSaveBytes\)/)
  assert.match(closePlayer, /await pendingSaveSync/)
})

test('refreshes lease availability every three seconds only while the profile picker is open', async () => {
  const source = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  assert.match(source, /if \(!profileGame\) return undefined[\s\S]*getProfiles\(profileGame\.id\)[\s\S]*window\.setInterval\(refreshProfiles, 3_000\)[\s\S]*window\.clearInterval\(interval\)/)
})

test('verifies an optional launch IPS and provides it to EmulatorJS as a Blob URL', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')

  assert.match(player, /launch\.patchUrl[\s\S]*fetch\(launch\.patchUrl, \{ cache: 'no-store' \}\)/)
  assert.match(player, /patch bytes did not match launch descriptor/i)
  assert.match(player, /window\.EJS_gamePatchUrl = URL\.createObjectURL\(new Blob\(\[patchBytes\]\)\)/)
})

test('continues without a failed optional IPS or an incompatible snapshot', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')

  assert.match(player, /fetch\(launch\.patchUrl, \{ cache: 'no-store' \}\)\.catch\(error => \(\{ ok: false, status: 0, error \}\)\)/)
  assert.match(player, /event: 'patch-fetch-failed'/)
  assert.match(player, /launch\.patchUrl = undefined[\s\S]*launch\.patchSha256 = undefined/)
  assert.match(player, /if \(snapshot && !snapshotCompatible\) console\.warn/)
  assert.match(player, /savedSnapshot = snapshotCompatible \? /)
})
