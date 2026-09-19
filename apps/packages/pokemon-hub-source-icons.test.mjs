import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const packages = new URL('./', import.meta.url)

test('uses the 3D box and floppy-disk icons for Pokemon Hub sources', async () => {
  const source = await readFile(new URL('./pokemon-hub-ui.jsx', packages), 'utf8')

  assert.match(source, /import \{[^}]*CodeSandboxOutlined[^}]*SaveOutlined[^}]*\} from '@ant-design\/icons'/)
  assert.match(source, /aria-label="Perfil do Hub"[^>]*icon=\{<CodeSandboxOutlined \/>\}/)
  assert.match(source, /aria-label="Perfil de Save"[^>]*icon=\{<SaveOutlined \/>\}/)
})
