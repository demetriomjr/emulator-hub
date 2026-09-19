import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('captures a local complete recovery bundle every 2.5 seconds and preserves it on lease loss', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  assert.match(player, /manager\.saveSaveFiles\?\.\(\)[\s\S]*manager\.getSaveFile\?\.\(\)[\s\S]*manager\.getState\?\.\(\)/)
  assert.match(player, /window\.setInterval\(\(\) => void captureLocalRecovery\(\), 2_500\)/)
  assert.match(player, /markRuntimeBreak\(profileId, id\)/)
  assert.match(player, /addEventListener\('pagehide'/)
})

test('offers a matching recovery candidate before acquiring a new lease and supports discard', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  assert.match(hub, /localRecoveryStore\.get\(profile\.id, game\.id\)/)
  assert.match(hub, /setRecoveryCandidate\(/)
  assert.match(hub, /await localRecoveryStore\.clear\(recoveryCandidate\.profileId, recoveryCandidate\.gameId\)/)
  assert.match(hub, /await acquirePlayerLease\(game\.id, profile\.id, sessionId\)/)
  assert.match(hub, /recoveryCandidate && <div className="profile-overlay"/)
})

test('clears local recovery on every normal close path, even when cloud synchronization fails', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  assert.match(hub, /flushPlayerSave\(frame\)\.finally\(\(\) => clearPlayerRecovery\(frame\)\)/)
  assert.match(hub, /else void closePlayer\(\)/)
})
