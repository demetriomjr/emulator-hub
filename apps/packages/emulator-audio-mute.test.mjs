import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmulatorAudioMute } from './emulator-audio-mute.mjs'

function emulatorAt(volume = 0.5) {
  const calls = []
  const emulator = {
    volume,
    setVolume(value) { calls.push(value); this.muted = value === 0 },
  }
  return { emulator, calls }
}

test('applies initial mute and restores the previous volume', () => {
  const { emulator, calls } = emulatorAt(0.7)
  const mute = createEmulatorAudioMute(true)
  mute.attach(emulator)
  assert.deepEqual(calls, [0])
  assert.equal(emulator.volume, 0.7)
  mute.setMuted(false)
  assert.deepEqual(calls, [0, 0.7])
})

test('native volume adjustments cannot override an active global mute', () => {
  const { emulator, calls } = emulatorAt(0.4)
  const mute = createEmulatorAudioMute(true)
  mute.attach(emulator)
  emulator.volume = 0.8
  emulator.setVolume(0.8)
  assert.deepEqual(calls, [0, 0])
  assert.equal(emulator.muted, true)
  mute.setMuted(false)
  assert.deepEqual(calls, [0, 0, 0.8])
})

test('unmute uses a nonzero fallback when the emulator has no remembered volume', () => {
  const { emulator, calls } = emulatorAt(0)
  const mute = createEmulatorAudioMute(true)
  mute.attach(emulator)
  mute.setMuted(false)
  assert.deepEqual(calls, [0, 0.5])
})

test('repeated state and attach calls do not stack volume wrappers', () => {
  const { emulator, calls } = emulatorAt(0.6)
  const mute = createEmulatorAudioMute(false)
  mute.attach(emulator)
  mute.attach(emulator)
  mute.setMuted(false)
  mute.setMuted(true)
  mute.setMuted(true)
  assert.deepEqual(calls, [0])
})
