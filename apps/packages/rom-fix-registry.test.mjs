import assert from 'node:assert/strict'
import test from 'node:test'
import { getRomFixProfile, validateRomFixProfile } from './rom-fix-registry.mjs'

const hash = 'a'.repeat(64)

const profile = {
  validated: true,
  size: 8,
  addresses: { hook: '0x08000100' },
  offsets: { hook: '0x00000004' },
  values: {
    hookExpected: '10 20',
    hookReplacement: '30 40',
  },
}

test('returns a validated profile by exact lowercase SHA-256', () => {
  assert.deepEqual(getRomFixProfile({ [hash]: profile }, hash), { sha256: hash, ...profile })
})

test('does not return an unvalidated profile when validation is required', () => {
  assert.equal(getRomFixProfile({ [hash]: { ...profile, validated: false } }, hash), null)
})

test('rejects malformed profile data', () => {
  assert.throws(() => validateRomFixProfile({ ...profile, offsets: { hook: 'bad' } }), /offset/i)
})

test('does not resolve uppercase or unknown hashes', () => {
  assert.equal(getRomFixProfile({ [hash]: profile }, hash.toUpperCase()), null)
  assert.equal(getRomFixProfile({ [hash]: profile }, 'b'.repeat(64)), null)
})
