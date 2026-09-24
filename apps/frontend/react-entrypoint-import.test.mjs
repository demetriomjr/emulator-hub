import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as reactDomClient from 'react-dom/client'

test('imports the browser root from the module that exports it', async () => {
  const source = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  const reactDom = await import('react-dom')

  assert.equal(typeof reactDom.createRoot, 'undefined')
  assert.equal(typeof reactDom.createPortal, 'function')
  assert.equal(typeof reactDomClient.createRoot, 'function')
  assert.match(source, /^import\s*\{\s*createPortal\s*\}\s*from\s*['"]react-dom['"]\s*$/m)
  assert.match(source, /^import\s*\{\s*createRoot\s*\}\s*from\s*['"]react-dom\/client['"]\s*$/m)
})
