import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('captures local recovery state only every 2.5 seconds and preserves it on lease loss', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  assert.match(player, /async function captureLocalRecovery\(\)[\s\S]*?manager\.getState\?\.\(\)[\s\S]*?localRecoveryStore\.put\([\s\S]*?state: new Uint8Array\(state\)\s*\}\)/)
  assert.doesNotMatch(player, /manager\.saveSaveFiles\?\.\(\)|manager\.getSaveFile\?\.\(\)|localRecovery\.save/)
  assert.match(player, /window\.setInterval\(\(\) => void captureLocalRecovery\(\), 2_500\)/)
  assert.match(player, /markRuntimeBreak\(profileId, id\)/)
  assert.match(player, /addEventListener\('pagehide'/)
})

test('offers a matching recovery candidate inside a scoped emulator session', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  assert.match(hub, /localRecoveryStore\.get\(profile\.id, game\.id\)/)
  assert.match(hub, /localRecoveryPrompt/)
  assert.match(hub, /SnapshotRestorePrompt/)
  assert.match(hub, /player-cell/)
  assert.match(hub, /await acquirePlayerLease\(game\.id, profile\.id, sessionId\)/)
  assert.doesNotMatch(hub, /recoveryCandidate && <div className="profile-overlay"/)
})

test('clears local recovery after successful close synchronization and preserves it on failure', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  assert.match(hub, /flushPlayerSave\(frame\)\.then\(\(\) => clearPlayerRecovery\(frame\)\)/)
  assert.match(hub, /else void closePlayer\(\)/)
})
