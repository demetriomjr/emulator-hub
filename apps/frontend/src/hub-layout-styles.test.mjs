import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const stylesheet = new URL('./styles.css', import.meta.url)

test('centers the desktop catalog after the sidebar and lets game cards share a row', async () => {
  const css = await readFile(stylesheet, 'utf8')

  assert.match(css, /\.hub-layout\s*\{[^}]*padding-left:\s*64px;/)
  assert.match(css, /\.hub-content\s*\{[^}]*width:\s*min\(1400px,\s*calc\(100%\s*-\s*clamp\(32px,\s*5vw,\s*96px\)\)\);[^}]*margin:\s*0\s+auto;/)
  assert.match(css, /\.hub-section-games\s+\.boxes\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(210px,\s*1fr\)\);/)
  assert.match(css, /\.hub-section-header::after\s*\{[^}]*flex:\s*1;/)
  assert.match(css, /\.hub-section-header::after\s*\{[^}]*flex:\s*0\s+1\s+70%;/)
  assert.match(css, /\.profile-list\s*\{[^}]*max-height:\s*232px;[^}]*overflow-y:\s*auto;/)
})
