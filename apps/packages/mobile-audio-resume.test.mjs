import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as mobileAudio from './mobile-audio-resume.mjs'

const { installAudioResumeOnUserGesture } = mobileAudio

function createElement() {
  const listeners = new Map()
  return {
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type) },
    emit(type) { listeners.get(type)?.() },
    listenerCount() { return listeners.size },
  }
}

test('waits for a completed gesture before resuming a suspended emulator audio context', async () => {
  const element = createElement()
  let resumeCalls = 0
  const context = { state: 'suspended', async resume() { resumeCalls += 1; this.state = 'running' } }

  installAudioResumeOnUserGesture({ element, getAudioContext: () => context })
  element.emit('pointerdown')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(resumeCalls, 0)

  element.emit('pointerup')
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(resumeCalls, 1)
  assert.equal(element.listenerCount(), 0)
})

test('keeps listening after a rejected resume so a later user gesture can retry', async () => {
  const element = createElement()
  let attempts = 0
  const context = {
    state: 'suspended',
    async resume() {
      attempts += 1
      if (attempts === 1) throw new DOMException('Permission was denied', 'NotAllowedError')
      this.state = 'running'
    },
  }

  installAudioResumeOnUserGesture({ element, getAudioContext: () => context })
  element.emit('touchend')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(element.listenerCount(), 3)

  element.emit('touchend')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(attempts, 2)
  assert.equal(element.listenerCount(), 0)
})

test('does not let a pending resume block a later completed gesture', () => {
  const element = createElement()
  let attempts = 0
  const context = { state: 'suspended', resume() { attempts += 1; return new Promise(() => {}) } }

  installAudioResumeOnUserGesture({ element, getAudioContext: () => context })
  element.emit('touchend')
  element.emit('touchend')

  assert.equal(attempts, 2)
})

test('finds the active emulator audio context through its OpenAL source', () => {
  const context = { state: 'suspended', resume() {} }
  const emulator = { Module: { AL: { currentCtx: { sources: { 0: { gain: { context } } } } } } }

  assert.equal(mobileAudio.getEmulatorAudioContext(emulator), context)
})
