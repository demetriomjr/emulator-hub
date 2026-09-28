import assert from 'node:assert/strict'
import test from 'node:test'

import { getGen3BallIconUrl, preferredBallIconSources } from './pokemon-card-ball-icon.mjs'

test('covers every PokéAPI Poké Ball pocket item with the best available pinned artwork', () => {
  const names = [
    'net-ball', 'dive-ball', 'nest-ball', 'repeat-ball', 'timer-ball', 'luxury-ball', 'premier-ball', 'dusk-ball', 'heal-ball', 'quick-ball', 'cherish-ball', 'dream-ball', 'beast-ball',
    'master-ball', 'ultra-ball', 'great-ball', 'poke-ball', 'safari-ball', 'park-ball', 'sport-ball', 'lastrange-ball', 'lapoke-ball', 'lagreat-ball', 'laultra-ball', 'laheavy-ball', 'laleaden-ball', 'lagigaton-ball', 'lafeather-ball', 'lawing-ball', 'lajet-ball', 'laorigin-ball',
    'lure-ball', 'level-ball', 'moon-ball', 'heavy-ball', 'fast-ball', 'friend-ball', 'love-ball',
  ]
  assert.deepEqual(preferredBallIconSources.map(({ slug }) => slug).sort(), names.sort())
  assert.equal(preferredBallIconSources.find(({ slug }) => slug === 'ultra-ball').source, 'dream-world')
  assert.equal(preferredBallIconSources.find(({ slug }) => slug === 'cherish-ball').source, 'gen5')
  assert.equal(preferredBallIconSources.find(({ slug }) => slug === 'beast-ball').source, 'default')
})

test('uses the correct local Poké Ball icon for native Gen III ball IDs', () => {
  assert.equal(getGen3BallIconUrl(1), '/resources/pokeballs/master-ball.png')
  assert.equal(getGen3BallIconUrl(4), '/resources/pokeballs/poke-ball.png')
  assert.equal(getGen3BallIconUrl(12), '/resources/pokeballs/premier-ball.png')
  for (let ballId = 1; ballId <= 12; ballId += 1) assert.match(getGen3BallIconUrl(ballId), /^\/resources\/pokeballs\/[^/]+\.png$/)
})

test('does not invent a Poké Ball icon for unknown native IDs', () => {
  assert.equal(getGen3BallIconUrl(0), null)
  assert.equal(getGen3BallIconUrl(13), null)
  assert.equal(getGen3BallIconUrl(null), null)
})
