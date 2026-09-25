import assert from 'node:assert/strict'
import test from 'node:test'

import { formatGameProfileLabel, orderGameProfiles } from './save-profile-display.mjs'

test('numbers the full profile order of each ROM even when the Hub omits profiles without saves', () => {
  const ruby = [
    { id: 'third', name: 'Same', createdAt: '2026-09-03T00:00:00Z', hasSave: true },
    { id: 'first', name: 'Same', createdAt: '2026-09-01T00:00:00Z', hasSave: false },
    { id: 'second', name: 'Same', createdAt: '2026-09-02T00:00:00Z', hasSave: true },
  ]
  const ordered = orderGameProfiles(ruby)
  assert.deepEqual(ordered.map(profile => profile.id), ['first', 'second', 'third'])
  assert.deepEqual(ordered.filter(profile => profile.hasSave).map(profile => formatGameProfileLabel(profile, ruby)), ['#2 Same', '#3 Same'])
  assert.equal(formatGameProfileLabel({ id: 'first', name: 'Renamed' }, ruby), '#1 Renamed')
  assert.equal(formatGameProfileLabel({ id: 'first', name: 'Same' }, [{ id: 'first', name: 'Same', createdAt: ruby[1].createdAt }]), '#1 Same')
  assert.equal(ruby[0].name, 'Same')
})
