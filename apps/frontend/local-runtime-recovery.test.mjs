import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('captures local recovery immediately and every 10 seconds, preserving it on lease loss', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  assert.match(player, /async function captureLocalRecovery\(\)[\s\S]*?manager\.getState\?\.\(\)[\s\S]*?stateCopy = measureSynchronousOperation\([\s\S]*?new Uint8Array\(state\)[\s\S]*?localRecoveryStore\.put\([\s\S]*?state: stateCopy\s*\}\)/)
  const localCapture = player.slice(player.indexOf('async function captureLocalRecovery()'), player.indexOf('async function clearLocalRecovery()'))
  assert.doesNotMatch(localCapture, /manager\.saveSaveFiles\?\.\(\)|manager\.getSaveFile\?\.\(\)|localRecovery\.save/)
  assert.match(player, /window\.setInterval\(\(\) => void captureLocalRecovery\(\)\.catch\([\s\S]*?\), 10_000\)/)
  assert.match(player, /\), 10_000\)\s+void captureLocalRecovery\(\)\.catch\(/)
  assert.match(player, /markRuntimeBreak\(profileId, id\)/)
  assert.doesNotMatch(player, /addEventListener\('pagehide'[\s\S]*clearLocalRecovery/)
})

test('offers a matching recovery candidate inside a scoped emulator session', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  assert.match(hub, /localRecoveryStore\.getForLaunch\(profile\.id, game\.id, lease\.runtimeStateInvalidatedAtRevision\)/)
  assert.match(hub, /localRecoveryPrompt/)
  assert.match(hub, /SnapshotRestorePrompt/)
  assert.match(hub, /player-cell/)
  assert.match(hub, /await acquirePlayerLease\(game\.id, profile\.id, sessionId\)/)
  assert.doesNotMatch(hub, /recoveryCandidate && <div className="profile-overlay"/)
})

test('clears local recovery after successful close synchronization and preserves it on failure', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  assert.match(hub, /const closeResult = await flushPlayerSave\(frame\)\s+if \(!closeResult\.preserveRecovery\) \{[\s\S]*?await clearPlayerRecovery\(frame\)[\s\S]*?catch/)
  assert.match(hub, /else if \(!saveCloseCoordinatorRef\.current\) void closePlayer\(\)/)
})
