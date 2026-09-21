import assert from 'node:assert/strict'
import test from 'node:test'

import { createGamePatchLookup, gamePatchForRom } from './game-patches.mjs'

test('associates the Emerald RNG patch only with its exact original ROM hash', () => {
  const patch = gamePatchForRom('a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af')

  assert.deepEqual(patch, {
    file: 'Pokemon Emerald.ips',
    sha256: '9c3795241bc91199cbe14b53cd4934f009119f2bb3ba9d06c1af3931a19a24b6',
  })
  assert.equal(gamePatchForRom('0'.repeat(64)), null)
})

test('creates isolated exact-hash patch lookups for backend integration', () => {
  const lookup = createGamePatchLookup([{
    romSha256: 'a'.repeat(64), file: 'fixture.ips', sha256: 'b'.repeat(64),
  }])

  assert.deepEqual(lookup('a'.repeat(64)), { file: 'fixture.ips', sha256: 'b'.repeat(64) })
  assert.equal(lookup('c'.repeat(64)), null)
})
