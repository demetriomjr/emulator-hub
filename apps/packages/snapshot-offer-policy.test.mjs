import assert from 'node:assert/strict'
import test from 'node:test'
import { createSnapshotOfferPolicy } from './snapshot-offer-policy.mjs'

test('suppresses the next restore offer only after a recent confirmed live save', () => {
  let time = 100
  const policy = createSnapshotOfferPolicy({ now: () => time })
  assert.equal(policy.shouldPromptAtClose(1), true)
  const token = policy.beginLiveSave()
  assert.equal(policy.shouldPromptAtClose(2), true)
  policy.confirmLiveSave(token, 2)
  time = 10_100
  assert.equal(policy.shouldPromptAtClose(2), false)
  time = 10_101
  assert.equal(policy.shouldPromptAtClose(2), true)
})

test('game input during an in-flight upload prevents suppression', () => {
  const policy = createSnapshotOfferPolicy({ now: () => 0 })
  const token = policy.beginLiveSave()
  policy.recordInput()
  policy.confirmLiveSave(token, 3)
  assert.equal(policy.shouldPromptAtClose(3), true)
})

test('manual state save and a changed canonical revision keep the prompt', () => {
  const policy = createSnapshotOfferPolicy({ now: () => 0 })
  policy.confirmLiveSave(policy.beginLiveSave(), 3)
  policy.recordManualStateSave()
  assert.equal(policy.shouldPromptAtClose(3), true)
  policy.confirmLiveSave(policy.beginLiveSave(), 4)
  assert.equal(policy.shouldPromptAtClose(4), false)
  assert.equal(policy.shouldPromptAtClose(5), true)
})

test('manual state save while an upload is pending keeps the prompt', () => {
  const policy = createSnapshotOfferPolicy({ now: () => 0 })
  const token = policy.beginLiveSave()
  policy.recordManualStateSave()
  policy.confirmLiveSave(token, 3)
  assert.equal(policy.shouldPromptAtClose(3), true)
})

test('an older live save confirmation cannot replace a newer checkpoint', () => {
  let time = 0
  const policy = createSnapshotOfferPolicy({ now: () => time })
  const first = policy.beginLiveSave()
  time = 1
  const second = policy.beginLiveSave()
  policy.confirmLiveSave(second, 4)
  assert.equal(policy.confirmLiveSave(first, 3), false)
  assert.equal(policy.shouldPromptAtClose(4), false)
})

test('unconfirmed or late saves cannot suppress the prompt', () => {
  let time = 0
  const policy = createSnapshotOfferPolicy({ now: () => time })
  policy.beginLiveSave() // an unchanged poll or failed upload is never confirmed
  assert.equal(policy.shouldPromptAtClose(1), true)
  const token = policy.beginLiveSave()
  time = 10_001
  policy.confirmLiveSave(token, 2)
  assert.equal(policy.shouldPromptAtClose(2), true)
})

test('a suppressed launch stays quiet while untouched and resumes after input', () => {
  let time = 0
  const policy = createSnapshotOfferPolicy({ now: () => time, suppressedLaunchSaveRevision: 4 })
  assert.equal(policy.shouldCapturePeriodic(), false)
  time = 60_000
  assert.equal(policy.shouldCapturePeriodic(), false)
  assert.equal(policy.shouldPromptAtClose(4), false)
  assert.equal(policy.shouldPromptAtClose(5), true)
  policy.recordInput()
  assert.equal(policy.shouldCapturePeriodic(), true)
  assert.equal(policy.shouldPromptAtClose(4), true)
})

test('restoring runtime state re-enables the prompt on a suppressed launch', () => {
  const policy = createSnapshotOfferPolicy({ now: () => 0, suppressedLaunchSaveRevision: 2 })
  policy.recordRuntimeRestore()
  assert.equal(policy.shouldCapturePeriodic(), true)
  assert.equal(policy.shouldPromptAtClose(2), true)
})

test('a failed live save attempt invalidates a suppressed launch and a prior checkpoint', () => {
  const suppressed = createSnapshotOfferPolicy({ now: () => 0, suppressedLaunchSaveRevision: 4 })
  suppressed.beginLiveSave()
  suppressed.recordSaveUncertainty()
  assert.equal(suppressed.shouldCapturePeriodic(), true)
  assert.equal(suppressed.shouldPromptAtClose(4), true)

  const recent = createSnapshotOfferPolicy({ now: () => 0 })
  recent.confirmLiveSave(recent.beginLiveSave(), 5)
  recent.beginLiveSave()
  recent.recordSaveUncertainty()
  assert.equal(recent.shouldPromptAtClose(5), true)
})
