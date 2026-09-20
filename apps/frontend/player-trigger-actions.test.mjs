import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('renders transient L2 and R2 action selectors in the player header', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')

  assert.match(hub, /aria-label="Ação do L2"/)
  assert.match(hub, /aria-label="Ação do R2"/)
  assert.match(hub, /setL2TriggerAction\('none'\)/)
  assert.match(hub, /setR2TriggerAction\('none'\)/)
  assert.match(hub, /TriggerBinding trigger=\{triggerControls\.l2\}/)
  assert.match(hub, /TriggerBinding trigger=\{triggerControls\.r2\}/)
  assert.doesNotMatch(hub, /localStorage.*(?:l2|r2|trigger)|(?:l2|r2|trigger).*localStorage/i)
  assert.ok(
    hub.indexOf('global-reset-button') < hub.indexOf('trigger-action-control'),
    'places trigger selectors after Reset',
  )
})
