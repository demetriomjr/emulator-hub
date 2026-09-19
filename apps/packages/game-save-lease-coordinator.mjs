const transition = {
  lua: `
local current = redis.call('GET', KEYS[1])
local input = cjson.decode(ARGV[1])
local now = tonumber(input.now)
local lease = current and cjson.decode(current) or nil
local active = lease and tonumber(lease.expiresAt) > now
local result

if input.action == 'acquire-player' then
  if active and lease.ownerKind ~= 'player' then
    result = { status = 'held-hub' }
  elseif active and lease.deviceId ~= input.deviceId then
    result = { status = 'held-player' }
  else
    local minimumGeneration = tonumber(input.minimumGeneration) or 1
    local currentGeneration = lease and tonumber(lease.generation) or 0
    local sameSession = active and lease.deviceId == input.deviceId and lease.sessionId == input.sessionId
    local generation = sameSession and math.max(currentGeneration, minimumGeneration) or math.max(currentGeneration, minimumGeneration - 1) + 1
    local next = { profileId = input.profileId, gameId = input.gameId, ownerKind = 'player', deviceId = input.deviceId, sessionId = input.sessionId, generation = generation, expiresAt = now + tonumber(input.duration) }
    redis.call('SET', KEYS[1], cjson.encode(next))
    result = { status = 'ok', lease = next }
  end
elseif input.action == 'acquire-hub' then
  if active and lease.ownerKind == 'player' then
    result = { status = 'held-player' }
  elseif active and lease.workspaceId ~= input.workspaceId then
    result = { status = 'held-hub' }
  else
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
    const lease = raw ? JSON.parse(raw) : null
    const active = lease?.expiresAt > input.now
    if (input.action === 'acquire-player') {
      if (active && lease.ownerKind !== 'player') return JSON.stringify({ status: 'held-hub' })
      if (active && lease.deviceId !== input.deviceId) return JSON.stringify({ status: 'held-player' })
      const minimumGeneration = input.minimumGeneration ?? 1
      const currentGeneration = lease?.generation ?? 0
      const sameSession = active && lease.deviceId === input.deviceId && lease.sessionId === input.sessionId
      const generation = sameSession ? Math.max(currentGeneration, minimumGeneration) : Math.max(currentGeneration, minimumGeneration - 1) + 1
      const next = { profileId: input.profileId, gameId: input.gameId, ownerKind: 'player', deviceId: input.deviceId, sessionId: input.sessionId, generation, expiresAt: input.now + input.duration }
      await set(keys[0], JSON.stringify(next))
      return JSON.stringify({ status: 'ok', lease: next })
    }
    if (input.action === 'acquire-hub') {
      if (active && lease.ownerKind === 'player') return JSON.stringify({ status: 'held-player' })
      if (active && lease.workspaceId !== input.workspaceId) return JSON.stringify({ status: 'held-hub' })
      const next = active ? { ...lease, expiresAt: input.now + input.duration } : { profileId: input.profileId, gameId: input.gameId, ownerKind: 'pokemon-hub', workspaceId: input.workspaceId, expiresAt: input.now + input.duration }
      await set(keys[0], JSON.stringify(next))
      return JSON.stringify({ status: 'ok', lease: next })
    }
    if (!active || (input.ownerKind === 'player' && (lease.ownerKind !== 'player' || lease.deviceId !== input.deviceId || lease.sessionId !== input.sessionId || lease.generation !== input.generation)) || (input.ownerKind === 'pokemon-hub' && (lease.ownerKind !== 'pokemon-hub' || lease.workspaceId !== input.workspaceId))) return JSON.stringify({ status: 'invalid' })
    if (input.action === 'release') {
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
  }

  async function run(action, ownerKind, input, duration) {
    validateInput(input, ownerKind, action)
    const result = JSON.parse(await persistence.eval(transition, { keys: [key(input.profileId, input.gameId)], arguments: [JSON.stringify({ ...input, action, ownerKind, now: now(), duration })] }))
    if (result.status === 'held-player') throw leaseError('SAVE_IN_USE_BY_PLAYER', 'This save is open in an active player session.')
    if (result.status === 'held-hub') throw leaseError('SAVE_IN_USE_BY_POKEMON_HUB', 'This save is open in Pokemon Hub.')
    if (result.status !== 'ok') throw leaseError(ownerKind === 'player' ? 'PLAYER_LEASE_INVALID' : 'HUB_LEASE_INVALID', 'This game save lease is no longer active.')
    return result.lease
  }
}

function key(profileId, gameId) { return `game-save-lease:${profileId}:${gameId}` }
function validDuration(value) { return Number.isFinite(value) && value > 0 }
function validateIdentity(input) { for (const field of ['profileId', 'gameId']) if (typeof input?.[field] !== 'string' || input[field].length === 0) throw new TypeError(`Game save lease ${field} is invalid.`) }
function validateInput(input, ownerKind, action) {
  validateIdentity(input)
  if (ownerKind === 'player') {
    for (const field of ['deviceId', 'sessionId']) if (typeof input?.[field] !== 'string' || input[field].length === 0) throw new TypeError(`Player lease ${field} is invalid.`)
    if (action !== 'acquire-player' && (!Number.isInteger(input.generation) || input.generation < 1)) throw new TypeError('Player lease generation is invalid.')
    if (input.minimumGeneration !== undefined && (!Number.isInteger(input.minimumGeneration) || input.minimumGeneration < 1)) throw new TypeError('Player lease minimum generation is invalid.')
  } else if (typeof input?.workspaceId !== 'string' || input.workspaceId.length === 0) throw new TypeError('Pokemon Hub workspace ID is invalid.')
}
function leaseError(code, message) { const error = new Error(message); error.code = code; return error }
