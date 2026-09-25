export function selectPlayerThreadMode({ core, protocol, crossOriginIsolated, sharedArrayBufferAvailable, retryWithoutThreads = false, mode = 'ordinary' }) {
  if (mode !== 'threaded') return { enabled: false, reason: 'ordinary-core-comparison' }
  if (retryWithoutThreads) return { enabled: false, reason: 'startup-fallback' }
  if (protocol !== 'http:' && protocol !== 'https:') return { enabled: false, reason: 'unsupported-document-scheme' }
  if (core !== 'gba') return { enabled: false, reason: 'core-not-verified' }
  if (!crossOriginIsolated || !sharedArrayBufferAvailable) return { enabled: false, reason: 'frame-not-isolated' }
  return { enabled: true, reason: 'isolated-mgba' }
}

export function playerThreadFallbackUrl(url) {
  const next = new URL(url)
  if (next.searchParams.get('threadFallback') === '1') return null
  next.searchParams.set('threadFallback', '1')
  return next.href
}
