import { randomUUID } from 'node:crypto'

export function createPokemonHubSessionStore({ now = () => Date.now(), leaseMs = 30_000 } = {}) {
  const sessions = new Map()

  function active(session) { return session && session.expiresAt > now() }
  function requireSession({ sessionId, leaseToken }) {
    const session = sessions.get(sessionId)
    if (!active(session) || session.leaseToken !== leaseToken) {
      if (session && !active(session)) sessions.delete(sessionId)
      const error = new Error('Pokémon Hub game session is invalid.')
      error.code = 'POKEMON_HUB_SESSION_INVALID'
      throw error
    }
    return session
  }

  return {
    open({ profileId, gameId }) {
      const sessionId = randomUUID()
      const leaseToken = randomUUID()
      const expiresAt = now() + leaseMs
      sessions.set(sessionId, { profileId, gameId, leaseToken, expiresAt })
      return { sessionId, leaseToken, expiresAt }
    },
    renew(sessionRef) {
      const session = requireSession(sessionRef)
      session.expiresAt = now() + leaseMs
      return { sessionId: sessionRef.sessionId, leaseToken: session.leaseToken, expiresAt: session.expiresAt }
    },
    close(sessionRef) { sessions.delete(requireSession(sessionRef) && sessionRef.sessionId) },
    hasLiveSession(profileId, gameId) {
      for (const [id, session] of sessions) {
        if (!active(session)) { sessions.delete(id); continue }
        if (session.profileId === profileId && session.gameId === gameId) return true
      }
      return false
    },
  }
}
