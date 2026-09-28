export const gen3BallIconSlugs = Object.freeze([
  'master-ball', 'ultra-ball', 'great-ball', 'poke-ball',
  'safari-ball', 'net-ball', 'dive-ball', 'nest-ball',
  'repeat-ball', 'timer-ball', 'luxury-ball', 'premier-ball',
])

const dreamWorldBallIconSlugs = [
  'dive-ball', 'dusk-ball', 'great-ball', 'heal-ball', 'luxury-ball',
  'master-ball', 'nest-ball', 'net-ball', 'poke-ball', 'premier-ball',
  'quick-ball', 'repeat-ball', 'safari-ball', 'timer-ball', 'ultra-ball',
]

const gen5BallIconSlugs = [
  'cherish-ball', 'dream-ball', 'park-ball', 'sport-ball',
  'lure-ball', 'level-ball', 'moon-ball', 'heavy-ball',
  'fast-ball', 'friend-ball', 'love-ball',
]

const defaultBallIconSlugs = [
  'beast-ball', 'lastrange-ball', 'lapoke-ball', 'lagreat-ball',
  'laultra-ball', 'laheavy-ball', 'laleaden-ball', 'lagigaton-ball',
  'lafeather-ball', 'lawing-ball', 'lajet-ball', 'laorigin-ball',
]

export const preferredBallIconSources = Object.freeze([
  ...dreamWorldBallIconSlugs.map(slug => ({ slug, source: 'dream-world' })),
  ...gen5BallIconSlugs.map(slug => ({ slug, source: 'gen5' })),
  ...defaultBallIconSlugs.map(slug => ({ slug, source: 'default' })),
].sort((left, right) => left.slug.localeCompare(right.slug)).map(entry => Object.freeze(entry)))

export function getGen3BallIconUrl(ballId) {
  if (!Number.isInteger(ballId) || ballId < 1 || ballId > gen3BallIconSlugs.length) return null
  const slug = gen3BallIconSlugs[ballId - 1]
  return `/resources/pokeballs/${slug}.png`
}
