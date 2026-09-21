import assert from 'node:assert/strict'
import test from 'node:test'
import { restoreSnapshotState } from './emulator-snapshot-restore.mjs'

test('declining snapshot restoration leaves the emulator and canonical save filesystem untouched', () => {
  const calls = []
  const manager = {
    loadState(state) { calls.push(['loadState', [...state]]) },
    FS: { writeFile(...args) { calls.push(['writeFile', ...args]) } },
    loadSaveFiles() { calls.push(['loadSaveFiles']) },
  }

  const restored = restoreSnapshotState({ state: new Uint8Array([5, 6]) }, manager, () => false)

  assert.equal(restored, false)
  assert.deepEqual(calls, [])
})

test('accepting snapshot restoration loads copied state only and does not write a .sav file', () => {
  const calls = []
  const manager = {
    loadState(state) { calls.push(['loadState', [...state]]) },
    FS: { writeFile(...args) { calls.push(['writeFile', ...args]) } },
    loadSaveFiles() { calls.push(['loadSaveFiles']) },
  }
  const snapshot = { state: new Uint8Array([7, 8, 9]) }

  assert.equal(restoreSnapshotState(snapshot, manager, () => true), true)
  snapshot.state[0] = 0

  assert.deepEqual(calls, [['loadState', [7, 8, 9]]])
})
