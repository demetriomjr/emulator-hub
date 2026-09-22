import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('trigger selectors expose Soft Reset and Hard Reset labels', async () => {
  const source = await readFile(new URL('../packages/player-trigger-actions.mjs', import.meta.url), 'utf8')
  assert.match(source, /value: 'soft-reset', label: 'Soft Reset'/)
  assert.match(source, /value: 'reset', label: 'Hard Reset'/)
  assert.match(source, /'soft-reset': 'emulator-hub:soft-reset'/)
  assert.match(source, /reset: 'emulator-hub:reset'/)
})
