import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('accepts same-origin close-player messages without relying on the parent WindowProxy identity', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')

  assert.match(player, /if \(event\.origin !== hubOrigin\) return/)
  assert.match(player, /isClosePlayerMessage = event\.data\?\.type === 'emulator-hub:close-player'[\s\S]*?!isClosePlayerMessage && event\.source !== window\.parent/)
  assert.match(player, /window\.emulatorHubClose = closeEmulator/)
  assert.match(player, /event\.data\?\.type === 'emulator-hub:close-player'/)
})

test('uses an acknowledged message for the iframe save synchronizer', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')

  assert.doesNotMatch(hub, /frame\.contentWindow\?\.emulatorHubClose/)
  assert.match(hub, /requestPlayerFrame\(\{ frame, browser: window, sessionId, type: 'emulator-hub:close-player', replyType: 'emulator-hub:save-synced' \}\)/)
  assert.match(hub, /type: 'emulator-hub:close-player'/)
})

test('uploads battery saves from EmulatorJS save events and keeps periodic snapshots state-only', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  assert.match(player, /observeEmulatorSaveFiles\(emulator, bytes => \{/)
  assert.match(player, /const traceId = crypto\.randomUUID\(\)/)
  assert.match(player, /cloudSaveSynchronizer\.syncBytes\(copy, traceId\)/)
  assert.match(player, /logger: logSavePipeline/)
  assert.match(player, /putCloudSave\(launch\.saveUrl, bytes, revision,[\s\S]*?traceId, logSavePipeline\)/)
  assert.match(player, /saveRevision: cloudSaveSynchronizer\.getRevision\(\)/)
  const gameSaveObserver = player.slice(player.indexOf('function watchBatterySaveChanges()'), player.indexOf('async function captureLocalRecovery()'))
  assert.doesNotMatch(gameSaveObserver, /saveEmulatorState|persistEmulatorState|captureLocalRecovery/)
  const snapshotCapture = player.slice(player.indexOf('async function persistEmulatorState('), player.indexOf('async function deleteRestoreCandidate('))
  assert.match(snapshotCapture, /manager\.getState\?\.\(\)/)
  assert.doesNotMatch(snapshotCapture, /saveSaveFiles|getSaveFile|syncBytes|\.sav/)
  assert.match(player, /const restoreChoice = restoreCandidates\.length \? await requestRestoreChoice\(restoreCandidates\)/)
  assert.match(player, /selected\.kind === 'cloud-recovery' \|\| selected\.kind === 'user-state'/)
  assert.match(player, /await cloudSaveSynchronizer\.restore\(window\.EJS_emulator\.gameManager\)/)
  assert.match(player, /await cloudSaveSynchronizer\.restore\([\s\S]*?setPlayerReady\(\)/)
  assert.match(player, /let restoredRuntimeState = false/)
  assert.match(player, /if \(!restoredRuntimeState\) \{[\s\S]*?await Promise\.resolve\(window\.EJS_emulator\.gameManager\.restart\?\.\(\)\)/)
  assert.match(player, /if \(!restoredRuntimeState\) \{[\s\S]*?await cloudSaveSynchronizer\.restore\(window\.EJS_emulator\.gameManager\)/)
  assert.match(player, /if \(!restoredRuntimeState\) \{[\s\S]*?cloudSaveSynchronizer\.restore/)
  assert.doesNotMatch(player, /saveWritesBlockedByRuntimeState/)
  assert.match(player, /createRestoreRequest\(\{ requestId, kind: 'candidate-list', candidates, gameId: id, profileId, sessionId \}\)/)
  assert.match(player, /function createEmulatorGameId\(gameId, profileId\)/)
  assert.match(player, /window\.EJS_gameID = emulatorGameId/)
  assert.match(player, /emulatorGameId, \.\.\.context/)
})

test('keeps restore responses scoped to the originating player profile', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  const routing = await readFile(new URL('../packages/snapshot-restore-routing.mjs', import.meta.url), 'utf8')

  assert.match(hub, /event\.data\.sessionId !== session\.sessionId \|\| event\.data\.gameId !== session\.gameId \|\| event\.data\.profileId !== session\.profileId/)
  assert.match(hub, /type: 'emulator-hub:snapshot-restore-response', requestId, choiceAttemptId, sessionId, gameId: session\.gameId, profileId: session\.profileId, candidateId/)
  assert.match(routing, /message\.sessionId !== request\.sessionId/)
  assert.match(routing, /message\.profileId !== request\.profileId/)
})

test('keeps close-time battery flushes independent from snapshot restoration', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  const closePlayer = player.slice(player.indexOf('async function closeEmulator()'), player.indexOf('window.emulatorHubClose'))

  assert.match(closePlayer, /window\.EJS_emulator\?\.gameManager\?\.getSaveFile\?\.\(\)/)
  assert.match(closePlayer, /queueCloudSave\(finalSaveBytes\)/)
  assert.match(closePlayer, /await pendingSaveSync/)
  assert.match(player, /if \(leaseLost \|\| !cloudSaveSynchronizer/)
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
  assert.match(player, /if \(snapshot && !snapshotCompatible\) \{/)
  assert.match(player, /stored snapshot is incompatible with this launch/)
  assert.match(player, /savedSnapshot = snapshotCompatible \? /)
})

test('tracks confirmed live saves while normal close discards automatic recovery', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  assert.match(player, /createSnapshotOfferPolicy/)
  assert.match(player, /observeEmulatorSaveFiles\(emulator, bytes => \{[\s\S]*?beginLiveSave\(\)[\s\S]*?queueCloudSave\(bytes,[\s\S]*?confirmLiveSave\(token, cloudSaveSynchronizer\.getRevision\(\)\)/)
  assert.match(player, /onUncertain: \(\) => offerPolicy\?\.recordSaveUncertainty\(\)/)
  const close = player.slice(player.indexOf('async function closeEmulator()'), player.indexOf('window.emulatorHubClose'))
  assert.match(close, /queueCloudSave\(finalSaveBytes\)/)
  assert.match(close, /await deleteEmulatorSnapshot\(launchDescriptor\.snapshotUrl, snapshotRevision/)
  assert.doesNotMatch(close, /beginLiveSave/)
})

test('startup leaves cloud recovery intact until the restore choice is applied', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  const startup = player.slice(player.indexOf('async function start()'), player.indexOf('window.EJS_onGameStart = async () =>'))
  assert.doesNotMatch(startup, /deleteEmulatorSnapshot/)
  assert.match(player, /savedSnapshot = snapshotCompatible \? snapshot : null/)
  assert.match(player, /scheduleCloudRecoveryDeleteAfterChoice\(savedSnapshot\.revision\)/)
  assert.match(player, /window\.EJS_emulator\.gameManager\.loadState\(new Uint8Array\(current\.state\)\)/)
})
