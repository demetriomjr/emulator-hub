import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('places a status-driven Play/Pause control before mute', async () => {
  const source = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  const control = source.match(/<div className="fast-forward-control">([\s\S]*?)<Button className=\{`fast-forward-button mute-button/)
  assert.ok(control)
  assert.match(control[1], /PlaybackGlyph paused=\{playerPaused\[activeSessions\[0\]\?\.sessionId\]\}/)
  assert.match(control[1], /onClick=\{[^}]*toggleGlobalPlayback/)
  assert.doesNotMatch(control[1], /aria-pressed|is-active/)
})
