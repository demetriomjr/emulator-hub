import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageFile = new URL('./input-macro-simulator-ui.jsx', import.meta.url)

test('macro editor is a self-contained list editor with the available inputs and actions', async () => {
  const source = await readFile(packageFile, 'utf8')

  assert.match(source, /export default function MacroEditor\(/)
  assert.match(source, /AVAILABLE_INPUTS\.map/)
  assert.match(source, /ACTION_TYPES\.map/)
  assert.match(source, /label: INPUT_ICONS\[input\]/)
  assert.match(source, /ACTION_LABELS\[action\]/)
})

test('macro editor supports add, remove, and drag reorder of steps', async () => {
  const source = await readFile(packageFile, 'utf8')

  assert.match(source, /onClick=\{appendStep\}/)
  assert.match(source, /onClick=\{\(\) => onRemove\(step\.id\)\}/)
  assert.match(source, /reorderSteps\(macro, fromIndex, toIndex\)/)
  assert.match(source, /draggable/)
  assert.match(source, /onDrop/)
})

test('press hides duration while hold and repeat show a summarized placeholder and delay defaults to one second', async () => {
  const source = await readFile(packageFile, 'utf8')

  assert.match(source, /step\.action !== 'press' &&/)
  assert.match(source, /if \(action === 'press' && step\.duration !== 0\) next\.duration = undefined/)
  assert.match(source, /placeholder=\{durationPlaceholder\}/)
  assert.match(source, /'Count'/)
  assert.match(source, /'0 = infinite'/)
  assert.match(source, /placeholder="Delay \(ms\)"/)
  assert.match(source, /step\.delay \?\? 1000/)
})

test('save is exposed as a callback the backend persistence layer can receive', async () => {
  const source = await readFile(packageFile, 'utf8')

  assert.match(source, /\{ macro, onChange, onSave, error = '' \}/)
  assert.match(source, /onClick=\{onSave\}/)
})