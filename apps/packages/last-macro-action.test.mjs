import assert from 'node:assert/strict'
import test from 'node:test'
import { createLastMacroAction, LAST_MACRO_ID_KEY } from './last-macro-action.mjs'

function storage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}

test('remembers a confirmed macro and starts it from the current saved list', async () => {
  const session = storage()
  const saved = { id: 'macro-a', name: 'A' }
  const started = []
  const action = createLastMacroAction({ storage: session, listMacros: async () => [saved], getRunState: () => ({ runId: null, phase: 'idle' }), start: macro => { started.push(macro) }, stop() {} })
  action.remember(saved.id)
  assert.equal(session.getItem(LAST_MACRO_ID_KEY), saved.id)
  await action.toggle()
  assert.deepEqual(started, [saved])
})

test('stops any active macro even without a remembered ID', async () => {
  const stopped = []
  const action = createLastMacroAction({ storage: storage(), listMacros: () => { throw new Error('Must not list') }, getRunState: () => ({ runId: 'other-macro', phase: 'running' }), start() {}, stop: () => { stopped.push(true) } })
  await action.toggle()
  assert.equal(stopped.length, 1)
})

test('does not start again while the last macro is being looked up', async () => {
  let resolveList
  const session = storage()
  session.setItem(LAST_MACRO_ID_KEY, 'macro-a')
  const started = []
  const action = createLastMacroAction({ storage: session, listMacros: () => new Promise(resolve => { resolveList = resolve }), getRunState: () => ({ runId: null, phase: 'idle' }), start: macro => { started.push(macro.id) }, stop() {} })
  const first = action.toggle()
  await action.toggle()
  resolveList([{ id: 'macro-a' }])
  await first
  assert.deepEqual(started, ['macro-a'])
})

test('clears an ID whose macro was removed and ignores presses while stopping', async () => {
  const session = storage()
  session.setItem(LAST_MACRO_ID_KEY, 'removed')
  let lists = 0
  const action = createLastMacroAction({ storage: session, listMacros: async () => { lists += 1; return [] }, getRunState: () => ({ runId: null, phase: 'idle' }), start() {}, stop() {} })
  await action.toggle()
  assert.equal(session.getItem(LAST_MACRO_ID_KEY), null)
  await action.toggle()
  assert.equal(lists, 1)
  const stopping = createLastMacroAction({ storage: session, listMacros: () => { throw new Error('Must not list') }, getRunState: () => ({ runId: 'run', phase: 'stopping' }), start() {}, stop: () => { throw new Error('Must not stop twice') } })
  await stopping.toggle()
})
