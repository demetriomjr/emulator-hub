import assert from 'node:assert/strict'
import test from 'node:test'
import { describeRestoreCandidate } from './src/restore-candidate-view.mjs'

test('explains manual state, server capture time and a newer canonical save', () => {
  const view = describeRestoreCandidate({ candidateId: 'user:2', kind: 'user-state', reasonCode: 'user-request', origin: 'other-installation', capturedAt: '2026-09-24T12:00:00.000Z', captureClock: 'server', saveRevision: 2, currentSaveRevision: 3 })
  assert.equal(view.title, 'Estado salvo por você')
  assert.equal(view.reason, 'Salvo por você')
  assert.equal(view.origin, 'Outro dispositivo')
  assert.match(view.capture, /2026.*horário do servidor/)
  assert.match(view.saveFreshness, /atualizado depois/)
})

test('does not invent a capture time or wall-clock date for legacy local and sequence metadata', () => {
  const view = describeRestoreCandidate({ candidateId: 'local-1', kind: 'local-recovery', reasonCode: 'possible-recovery', origin: 'this-installation', capturedAt: null, captureClock: 'browser', gameTime: { value: 41, kind: 'save-sequence', adapterId: 'gen3-gba-v1' } })
  assert.equal(view.capture, 'Horário de captura desconhecido · relógio deste dispositivo')
  assert.equal(view.gameTime, 'Sequência do save: 41')
  assert.equal(view.saveFreshness, null)
})

test('does not call an untyped legacy remote capture automatic or user saved', () => {
  const view = describeRestoreCandidate({ candidateId: 'remote:1', kind: 'cloud-recovery', reasonCode: 'legacy-unknown', origin: 'unknown', capturedAt: '2026-09-24T12:00:00.000Z', captureClock: 'server' })
  assert.equal(view.title, 'Estado antigo')
  assert.match(view.reason, /manual ou automática desconhecida/)
})
