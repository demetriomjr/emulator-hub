const transition = {
  lua: `
local current = redis.call('GET', KEYS[1])
local revisionRaw = redis.call('GET', KEYS[2])
local historyRaw = redis.call('GET', KEYS[3])
local input = cjson.decode(ARGV[1])
local now = tonumber(input.now)
local lease = current and cjson.decode(current) or nil
local revision = revisionRaw and tonumber(revisionRaw) or 0
local history = historyRaw and cjson.decode(historyRaw) or {}
local active = lease and tonumber(lease.expiresAt) > now
local result

if input.action == 'acquire-player' then
  if input.expectedSessionRevision ~= nil and active then
    result = { status = lease.ownerKind == 'player' and 'held-player' or 'held-hub' }
  elseif active and lease.ownerKind ~= 'player' then
    result = { status = 'held-hub' }
  elseif active and lease.deviceId ~= input.deviceId then
    result = { status = 'held-player' }
  elseif input.expectedSessionRevision ~= nil and tonumber(input.expectedSessionRevision) ~= revision then
    result = { status = 'stale-session' }
  else
    local minimumGeneration = tonumber(input.minimumGeneration) or 1
    local currentGeneration = lease and tonumber(lease.generation) or 0
    local sameSession = active and lease.deviceId == input.deviceId and lease.sessionId == input.sessionId and lease.sessionRevision ~= nil and tonumber(lease.sessionRevision) == revision
    local generation = sameSession and math.max(currentGeneration, minimumGeneration) or math.max(currentGeneration, minimumGeneration - 1) + 1
    local sessionRevision = sameSession and revision or revision + 1
    local startedAt = sameSession and lease.startedAt or now
    if not sameSession then
      if lease and lease.ownerKind == 'player' then
        for i = #history, 1, -1 do
          if history[i].sessionId == lease.sessionId and history[i].sessionRevision == lease.sessionRevision then
            history[i].endedAt = active and now or tonumber(lease.expiresAt)
            history[i].endReason = active and 'replaced' or 'expired'
            break
          end
        end
      end
      history[#history + 1] = { sessionId = input.sessionId, sessionRevision = sessionRevision, startedAt = now, endedAt = cjson.null, endReason = cjson.null }
      redis.call('SET', KEYS[2], tostring(sessionRevision))
      redis.call('SET', KEYS[3], cjson.encode(history))
    end
    local next = { profileId = input.profileId, gameId = input.gameId, ownerKind = 'player', deviceId = input.deviceId, sessionId = input.sessionId, generation = generation, sessionRevision = sessionRevision, startedAt = startedAt, expiresAt = now + tonumber(input.duration) }
    redis.call('SET', KEYS[1], cjson.encode(next))
    result = { status = 'ok', lease = next }
  end
elseif input.action == 'acquire-hub' then
  if active and lease.ownerKind == 'player' then
    result = { status = 'held-player' }
  elseif active and lease.workspaceId ~= input.workspaceId then
    result = { status = 'held-hub' }
  else
    if lease and lease.ownerKind == 'player' then
      for i = #history, 1, -1 do
        if history[i].sessionId == lease.sessionId and history[i].sessionRevision == lease.sessionRevision then
          history[i].endedAt = tonumber(lease.expiresAt)
          history[i].endReason = 'expired'
          redis.call('SET', KEYS[3], cjson.encode(history))
          break
        end
      end
    end
    local next = active and lease or { profileId = input.profileId, gameId = input.gameId, ownerKind = 'pokemon-hub', workspaceId = input.workspaceId, expiresAt = now + tonumber(input.duration) }
    if active then next.expiresAt = now + tonumber(input.duration) end
    redis.call('SET', KEYS[1], cjson.encode(next))
    result = { status = 'ok', lease = next }
  end
elseif not active then
  result = { status = 'invalid' }
elseif input.ownerKind == 'player' and (lease.ownerKind ~= 'player' or lease.deviceId ~= input.deviceId or lease.sessionId ~= input.sessionId or tonumber(lease.generation) ~= tonumber(input.generation)) then
  result = { status = 'invalid' }
elseif input.ownerKind == 'pokemon-hub' and (lease.ownerKind ~= 'pokemon-hub' or lease.workspaceId ~= input.workspaceId) then
  result = { status = 'invalid' }
elseif input.action == 'release' then
  if lease.ownerKind == 'player' then
    for i = #history, 1, -1 do
      if history[i].sessionId == lease.sessionId and history[i].sessionRevision == lease.sessionRevision then
        history[i].endedAt = now
        history[i].endReason = 'released'
        redis.call('SET', KEYS[3], cjson.encode(history))
        break
      end
    end
  end
  redis.call('DEL', KEYS[1])
  result = { status = 'ok', lease = lease }
else
  lease.expiresAt = now + tonumber(input.duration)
  redis.call('SET', KEYS[1], cjson.encode(lease))
  result = { status = 'ok', lease = lease }
end
return cjson.encode(result)`,
  async memory({ keys, arguments: [encoded], get, set, delete: remove }) {
    const input = JSON.parse(encoded)
    const raw = await get(keys[0])
    const revision = Number(await get(keys[1]) ?? 0)
    const history = JSON.parse(await get(keys[2]) ?? '[]')
    const lease = raw ? JSON.parse(raw) : null
    const active = lease?.expiresAt > input.now
    if (input.action === 'acquire-player') {
      if (input.expectedSessionRevision !== undefined && active) return JSON.stringify({ status: lease.ownerKind === 'player' ? 'held-player' : 'held-hub' })
      if (active && lease.ownerKind !== 'player') return JSON.stringify({ status: 'held-hub' })
      if (active && lease.deviceId !== input.deviceId) return JSON.stringify({ status: 'held-player' })
      if (input.expectedSessionRevision !== undefined && input.expectedSessionRevision !== revision) return JSON.stringify({ status: 'stale-session' })
      const minimumGeneration = input.minimumGeneration ?? 1
      const currentGeneration = lease?.generation ?? 0
      const sameSession = active && lease.deviceId === input.deviceId && lease.sessionId === input.sessionId && lease.sessionRevision !== undefined && lease.sessionRevision === revision
      const generation = sameSession ? Math.max(currentGeneration, minimumGeneration) : Math.max(currentGeneration, minimumGeneration - 1) + 1
      const sessionRevision = sameSession ? revision : revision + 1
      const startedAt = sameSession ? lease.startedAt : input.now
      if (!sameSession) {
        if (lease?.ownerKind === 'player') {
          const prior = history.findLast(entry => entry.sessionId === lease.sessionId && entry.sessionRevision === lease.sessionRevision)
          if (prior) { prior.endedAt = active ? input.now : lease.expiresAt; prior.endReason = active ? 'replaced' : 'expired' }
        }
        history.push({ sessionId: input.sessionId, sessionRevision, startedAt: input.now, endedAt: null, endReason: null })
        await set(keys[1], String(sessionRevision))
        await set(keys[2], JSON.stringify(history))
      }
      const next = { profileId: input.profileId, gameId: input.gameId, ownerKind: 'player', deviceId: input.deviceId, sessionId: input.sessionId, generation, sessionRevision, startedAt, expiresAt: input.now + input.duration }
      await set(keys[0], JSON.stringify(next))
      return JSON.stringify({ status: 'ok', lease: next })
    }
    if (input.action === 'acquire-hub') {
      if (active && lease.ownerKind === 'player') return JSON.stringify({ status: 'held-player' })
      if (active && lease.workspaceId !== input.workspaceId) return JSON.stringify({ status: 'held-hub' })
      if (lease?.ownerKind === 'player') {
        const prior = history.findLast(entry => entry.sessionId === lease.sessionId && entry.sessionRevision === lease.sessionRevision)
        if (prior) { prior.endedAt = lease.expiresAt; prior.endReason = 'expired'; await set(keys[2], JSON.stringify(history)) }
      }
      const next = active ? { ...lease, expiresAt: input.now + input.duration } : { profileId: input.profileId, gameId: input.gameId, ownerKind: 'pokemon-hub', workspaceId: input.workspaceId, expiresAt: input.now + input.duration }
      await set(keys[0], JSON.stringify(next))
      return JSON.stringify({ status: 'ok', lease: next })
    }
    if (!active || (input.ownerKind === 'player' && (lease.ownerKind !== 'player' || lease.deviceId !== input.deviceId || lease.sessionId !== input.sessionId || lease.generation !== input.generation)) || (input.ownerKind === 'pokemon-hub' && (lease.ownerKind !== 'pokemon-hub' || lease.workspaceId !== input.workspaceId))) return JSON.stringify({ status: 'invalid' })
    if (input.action === 'release') {
      if (lease.ownerKind === 'player') {
        const current = history.findLast(entry => entry.sessionId === lease.sessionId && entry.sessionRevision === lease.sessionRevision)
        if (current) { current.endedAt = input.now; current.endReason = 'released'; await set(keys[2], JSON.stringify(history)) }
      }
      await remove(keys[0])
      return JSON.stringify({ status: 'ok', lease })
    }
    const renewed = { ...lease, expiresAt: input.now + input.duration }
    await set(keys[0], JSON.stringify(renewed))
    return JSON.stringify({ status: 'ok', lease: renewed })
  },
}

export function createGameSaveLeaseCoordinator({ persistence, now = () => Date.now(), playerLeaseDurationMs = 45_000, hubLeaseDurationMs = 9_000 } = {}) {
  if (!persistence || typeof persistence.eval !== 'function' || typeof persistence.get !== 'function') throw new TypeError('Game save lease persistence is required.')
  if (!validDuration(playerLeaseDurationMs) || !validDuration(hubLeaseDurationMs)) throw new TypeError('Game save lease duration is invalid.')

  return {
    acquirePlayer: input => run('acquire-player', 'player', input, playerLeaseDurationMs),
    renewPlayer: input => run('renew', 'player', input, playerLeaseDurationMs),
    releasePlayer: input => run('release', 'player', input, playerLeaseDurationMs),
    assertPlayerWrite: input => run('assert', 'player', input, playerLeaseDurationMs),
    acquireHub: input => run('acquire-hub', 'pokemon-hub', input, hubLeaseDurationMs),
    renewHub: input => run('renew', 'pokemon-hub', input, hubLeaseDurationMs),
    releaseHub: input => run('release', 'pokemon-hub', input, hubLeaseDurationMs),
    async get({ profileId, gameId }) {
      validateIdentity({ profileId, gameId })
      const raw = await persistence.get(key(profileId, gameId))
      const lease = raw ? JSON.parse(raw) : null
      return lease?.expiresAt > now() ? lease : null
    },
    async getSessionRevision({ profileId, gameId }) {
      validateIdentity({ profileId, gameId })
      return Number(await persistence.get(revisionKey(profileId, gameId)) ?? 0)
    },
    async getSessionHistory({ profileId, gameId }) {
      validateIdentity({ profileId, gameId })
      const history = JSON.parse(await persistence.get(historyKey(profileId, gameId)) ?? '[]')
      const rawLease = await persistence.get(key(profileId, gameId))
      const lease = rawLease ? JSON.parse(rawLease) : null
      return history.map(entry => entry.endReason === null && lease?.sessionId === entry.sessionId && lease?.sessionRevision === entry.sessionRevision && lease.expiresAt <= now()
        ? { ...entry, endedAt: lease.expiresAt, endReason: 'expired' }
        : entry)
    },
  }

  async function run(action, ownerKind, input, duration) {
    validateInput(input, ownerKind, action)
    const result = JSON.parse(await persistence.eval(transition, { keys: [key(input.profileId, input.gameId), revisionKey(input.profileId, input.gameId), historyKey(input.profileId, input.gameId)], arguments: [JSON.stringify({ ...input, action, ownerKind, now: now(), duration })] }))
    if (result.status === 'held-player') throw leaseError('SAVE_IN_USE_BY_PLAYER', 'This save is open in an active player session.')
    if (result.status === 'held-hub') throw leaseError('SAVE_IN_USE_BY_POKEMON_HUB', 'This save is open in Pokemon Hub.')
    if (result.status === 'stale-session') throw leaseError('PLAYER_SESSION_STALE', 'A newer player session has used this profile.')
    if (result.status !== 'ok') throw leaseError(ownerKind === 'player' ? 'PLAYER_LEASE_INVALID' : 'HUB_LEASE_INVALID', 'This game save lease is no longer active.')
    return result.lease
  }
}

function key(profileId, gameId) { return `game-save-lease:${profileId}:${gameId}` }
function revisionKey(profileId, gameId) { return `player-session-revision:${profileId}:${gameId}` }
function historyKey(profileId, gameId) { return `player-session-history:${profileId}:${gameId}` }
function validDuration(value) { return Number.isFinite(value) && value > 0 }
function validateIdentity(input) { for (const field of ['profileId', 'gameId']) if (typeof input?.[field] !== 'string' || input[field].length === 0) throw new TypeError(`Game save lease ${field} is invalid.`) }
function validateInput(input, ownerKind, action) {
  validateIdentity(input)
  if (ownerKind === 'player') {
    for (const field of ['deviceId', 'sessionId']) if (typeof input?.[field] !== 'string' || input[field].length === 0) throw new TypeError(`Player lease ${field} is invalid.`)
    if (action !== 'acquire-player' && (!Number.isInteger(input.generation) || input.generation < 1)) throw new TypeError('Player lease generation is invalid.')
    if (input.minimumGeneration !== undefined && (!Number.isInteger(input.minimumGeneration) || input.minimumGeneration < 1)) throw new TypeError('Player lease minimum generation is invalid.')
    if (input.expectedSessionRevision !== undefined && (action !== 'acquire-player' || !Number.isInteger(input.expectedSessionRevision) || input.expectedSessionRevision < 1)) throw new TypeError('Expected player session revision is invalid.')
  } else if (typeof input?.workspaceId !== 'string' || input.workspaceId.length === 0) throw new TypeError('Pokemon Hub workspace ID is invalid.')
}
function leaseError(code, message) { const error = new Error(message); error.code = code; return error }
