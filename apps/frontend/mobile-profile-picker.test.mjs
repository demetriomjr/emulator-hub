import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const frontend = new URL('./', import.meta.url)

test('uses the full mobile landscape viewport for the profile picker', async () => {
  const source = await readFile(new URL('./src/main.jsx', frontend), 'utf8')
  const css = await readFile(new URL('./src/styles.css', frontend), 'utf8')

  assert.match(source, /profile-overlay\$\{profilePickerPlacement \? ' profile-picker-overlay' : ''\} profile-picker-mobile/)
  assert.match(source, /style=\{profilePurpose === 'add-instance' \? [^\n]+ : profilePickerPlacement \? profilePickerPlacement : undefined\}/)
  assert.match(source, /className="profile-picker-content"/)
  assert.match(source, /className="profile-picker-profiles"/)
  assert.match(source, /className="profile-picker-create"/)
  assert.doesNotMatch(source, /profile-add-label/)
  assert.match(css, /\.profile-picker-mobile\s*\{[^}]*place-items:\s*stretch;[^}]*padding:\s*12px;/)
  assert.match(css, /\.profile-picker-mobile \.profile-picker-panel\s*\{[^}]*position:\s*fixed\s*!important;[^}]*inset:\s*12px\s*!important;[^}]*width:\s*auto\s*!important;[^}]*height:\s*auto\s*!important;[^}]*max-height:\s*none\s*!important;[^}]*border:\s*1px solid #398269;[^}]*border-radius:\s*18px;/)
  assert.match(css, /\.profile-picker-mobile \.profile-body\s*\{[^}]*flex:\s*1;/)
  assert.match(css, /\.profile-picker-mobile \.profile-picker-content\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*gap:\s*12px;/)
  assert.match(css, /\.profile-picker-mobile \.profile-add\s*\{[^}]*margin:\s*0;/)
  assert.match(css, /\.profile-picker-mobile \.profile-list\s*\{[^}]*width:\s*100%;[^}]*border:\s*0;[^}]*align-self:\s*start;[^}]*max-height:\s*100%;[^}]*overflow-y:\s*auto;/)
  assert.match(css, /\.profile-picker-mobile \.profile-row\s*\{[^}]*border:\s*1px solid #397c67;/)
  assert.match(css, /@media\s*\(max-width:\s*900px\)\s*and\s*\(max-height:\s*500px\)\s*and\s*\(orientation:\s*landscape\)\s*\{[\s\S]*\.profile-picker-mobile/)
})
