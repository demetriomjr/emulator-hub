import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPlayerInteractionLock } from './player-interaction-lock.mjs'

function harness({ paused = false, ready = true } = {}) {
  const calls = []
  const emulator = { paused, gameManager: ready ? {} : null,
    pause() { calls.push('pause'); this.paused = true },
    play() { calls.push('play'); this.paused = false },
  }
  let mayResume = true
  const lock = createPlayerInteractionLock({
    getEmulator: () => emulator,
    releaseGamepadInput: () => calls.push('release-input'),
    canResume: () => mayResume,
  })
  return { emulator, lock, calls, setMayResume: value => { mayResume = value } }
}

test('pauses every running emulator once and resumes only after unlock', () => {
  const { lock, calls } = harness()
  lock.setLocked(true)
  lock.setLocked(true)
  lock.setLocked(false)
  assert.deepEqual(calls, ['release-input', 'pause', 'release-input', 'play'])
})

test('does not resume an emulator already paused before the chooser opened', () => {
  const { lock, calls, emulator } = harness({ paused: true })
  lock.setLocked(true)
  lock.setLocked(false)
  assert.equal(emulator.paused, true)
  assert.deepEqual(calls, ['release-input'])
})

test('remembers a lock requested during startup and waits for runtime readiness to resume', () => {
  const { lock, calls, emulator, setMayResume } = harness({ ready: false })
  lock.setLocked(true)
  emulator.gameManager = {}
  emulator.paused = false
  lock.apply()
  setMayResume(false)
  lock.setLocked(false)
  assert.equal(emulator.paused, true)
  setMayResume(true)
  lock.apply()
  assert.deepEqual(calls, ['release-input', 'release-input', 'pause', 'play'])
})

test('blocks iframe keyboard events only while locked', () => {
  const { lock } = harness()
  const events = []
  const event = { preventDefault: () => events.push('prevent'), stopImmediatePropagation: () => events.push('stop') }
  assert.equal(lock.blockKeyboard(event), false)
  lock.setLocked(true)
  assert.equal(lock.blockKeyboard(event), true)
  assert.deepEqual(events, ['prevent', 'stop'])
})
