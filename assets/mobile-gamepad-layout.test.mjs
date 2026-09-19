import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('starts from the normalized selected mobile-pad layout', async () => {
  const html = await readFile(new URL('./mobile-gamepad-layout.html', import.meta.url), 'utf8')

  assert.match(html, /id="size" type="range" min="34" max="300"/)
  assert.match(html, /id: 'dpad', label: 'D-pad', kind: 'zone', x: 133, y: 263, size: 195/)
  assert.match(html, /control\.kind === 'zone'/)
  assert.match(html, /id: 'a', label: 'A', kind: 'round', x: 775, y: 248, size: 91/)
  assert.match(html, /id: 'b', label: 'B', kind: 'round', x: 672, y: 323, size: 91/)
  assert.match(html, /id: 'start', label: 'Start', kind: 'block', x: 494, y: 313, size: 95/)
  assert.match(html, /id: 'select', label: 'Select', kind: 'block', x: 350, y: 313, size: 89/)
  assert.match(html, /id: 'l', label: 'L', kind: 'shoulder', x: 121, y: 48, size: 150/)
  assert.match(html, /id: 'r', label: 'R', kind: 'shoulder', x: 723, y: 48, size: 150/)
  assert.match(html, /context\.fillRect\(0, 0, canvas\.width, canvas\.height\)/)
  assert.doesNotMatch(html, /Game screen/)
})
