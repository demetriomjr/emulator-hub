import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getProfile } from '../packages/hub-client.js'

test('profile detail client addresses one game profile and validates the response', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  try {
    globalThis.fetch = async (url, options) => {
      calls.push([url, options])
      return { ok: true, json: async () => ({ id: 'profile/one', name: 'Leaf' }) }
    }
    assert.deepEqual(await getProfile('game one', 'profile/one'), { id: 'profile/one', name: 'Leaf' })
    assert.deepEqual(calls, [['/api/games/game%20one/profiles/profile%2Fone', { cache: 'no-store' }]])

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ profile: {} }) })
    await assert.rejects(getProfile('game', 'profile'), /Invalid profile response/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('global editor keeps selection scoped and persists only the selected profile name', async () => {
  const editor = await readFile(new URL('./src/profile-editor.jsx', import.meta.url), 'utf8')
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  const css = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8')
  assert.match(hub, /aria-label="Configurar controles"[\s\S]*aria-label="Editar perfis"/)
  assert.match(editor, /getProfiles\(selectedGameId\)/)
  assert.match(editor, /getProfile\(selectedGameId, selectedProfileId\)/)
  assert.match(editor, /setSelectedProfileId\(null\)[\s\S]*setProfile\(null\)/)
  assert.match(editor, /if \(!current\) return[\s\S]*setProfile\(result\)/)
  assert.match(editor, /updateProfile\(selectedGameId, profile\.id, draftName\)/)
  assert.match(editor, /onSaved\(selectedGameId, updated\)/)
  assert.match(hub, /function handleGlobalProfileSaved\(gameId, updated\)[\s\S]*updateCachedProfiles[\s\S]*setActiveSessions/)
  assert.match(css, /\.global-profile-editor-columns \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
})
