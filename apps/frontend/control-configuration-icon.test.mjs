import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const frontend = new URL('./', import.meta.url)

test('reuses the Pokemon Hub save-profile gamepad glyph in both control configuration buttons', async () => {
  const source = await readFile(new URL('./src/main.jsx', frontend), 'utf8')
  const css = await readFile(new URL('./src/styles.css', frontend), 'utf8')

  assert.equal((source.match(/<svg viewBox="0 0 24 24" className="control-configuration-icon" aria-hidden="true">/g) ?? []).length, 2)
  assert.equal((source.match(/M7\.1 8\.5h9\.8c1\.5 0 2\.8 1 3\.2 2\.45l1\.08 4\.15a2\.35 2\.35 0 0 1-4\.08 2\.1l-1\.55-1\.7H8\.4l-1\.55 1\.7a2\.35 2\.35 0 0 1-4\.08-2\.1l1\.08-4\.15A3\.3 3\.3 0 0 1 7\.1 8\.5Z/g) ?? []).length, 2)
  assert.match(css, /\.control-configuration-icon\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*fill:\s*none;[^}]*stroke:\s*currentColor;[^}]*stroke-linecap:\s*round;[^}]*stroke-linejoin:\s*round;[^}]*stroke-width:\s*1\.8;/)
})
