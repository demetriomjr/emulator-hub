import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('uses one per-emulator restore prompt for local and backend decisions', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  assert.match(hub, /SnapshotRestorePrompt/)
  assert.match(hub, /emulator-hub:snapshot-restore-request/)
  assert.match(hub, /emulator-hub:snapshot-restore-response/)
  assert.match(hub, /player-cell/)
  assert.doesNotMatch(player, /window\.confirm\('Há um snapshot deste perfil/)
})

test('does not render the old global recovery overlay', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(hub, /recoveryCandidate && <div className="profile-overlay"/)
  assert.match(hub, /snapshotRestoreRequests/)
})
