import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { createControlProfileStore, defaultControlProfile } from '../../packages/control-profile-store.mjs'

const roots = new Set()

afterEach(async () => {
  await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true })))
  roots.clear()
})

async function profilePath() {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-controls-'))
  roots.add(root)
  return join(root, 'data', 'control-profile.json')
}

test('returns and persists a complete default GBA control profile', async () => {
  const dataPath = await profilePath()
  const profiles = createControlProfileStore({ dataPath })

  assert.deepEqual(await profiles.get(), defaultControlProfile)

  const updated = structuredClone(defaultControlProfile)
  updated.name = 'Keyboard layout'
  updated.bindings['8'] = { keyboard: 'k', gamepad: 'BUTTON_4' }
  assert.deepEqual(await profiles.replace(updated), updated)
  assert.deepEqual(await createControlProfileStore({ dataPath }).get(), updated)
})

test('rejects invalid control profiles without replacing the stored profile', async () => {
  const profiles = createControlProfileStore({ dataPath: await profilePath() })
  const invalid = structuredClone(defaultControlProfile)
  invalid.bindings['8'].keyboard = ''

  await assert.rejects(() => profiles.replace(invalid), { code: 'CONTROL_PROFILE_INVALID' })
  assert.deepEqual(await profiles.get(), defaultControlProfile)
})
