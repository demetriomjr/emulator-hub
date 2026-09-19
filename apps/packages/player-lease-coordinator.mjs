const transition = {
  lua: `
local current = redis.call('GET', KEYS[1])
local input = cjson.decode(ARGV[1])
local now = tonumber(input.now)
local lease = current and cjson.decode(current) or nil
local active = lease and tonumber(lease.expiresAt) > now
local result
if input.action == 'acquire' then
  if active and lease.deviceId ~= input.deviceId then
    result = { status = 'held' }
  else
    local minimumGeneration = tonumber(input.minimumGeneration) or 1
    local currentGeneration = lease and tonumber(lease.generation) or 0
    local sameSession = active and lease.deviceId == input.deviceId and lease.sessionId == input.sessionId
    local generation = sameSession and math.max(currentGeneration, minimumGeneration) or math.max(currentGeneration, minimumGeneration - 1) + 1
    local next = { profileId = input.profileId, gameId = input.gameId, deviceId = input.deviceId, sessionId = input.sessionId, generation = generation, expiresAt = now + tonumber(input.duration) }
    redis.call('SET', KEYS[1], cjson.encode(next))
    result = { status = 'ok', lease = next }
  end
elseif not active or lease.deviceId ~= input.deviceId or lease.sessionId ~= input.sessionId or tonumber(lease.generation) ~= tonumber(input.generation) then
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
    const key = keys[0]
    const raw = await get(key)
    const lease = raw ? JSON.parse(raw) : null
    const active = lease && lease.expiresAt > input.now
    if (input.action === 'acquire') {
      if (active && lease.deviceId !== input.deviceId) return JSON.stringify({ status: 'held' })
      const minimumGeneration = input.minimumGeneration ?? 1
      const currentGeneration = lease?.generation ?? 0
      const sameSession = active && lease.deviceId === input.deviceId && lease.sessionId === input.sessionId
      const generation = sameSession ? Math.max(currentGeneration, minimumGeneration) : Math.max(currentGeneration, minimumGeneration - 1) + 1
      const next = { profileId: input.profileId, gameId: input.gameId, deviceId: input.deviceId, sessionId: input.sessionId, generation, expiresAt: input.now + input.duration }
      await set(key, JSON.stringify(next))
      return JSON.stringify({ status: 'ok', lease: next })
    }
    if (!active || lease.deviceId !== input.deviceId || lease.sessionId !== input.sessionId || lease.generation !== input.generation) return JSON.stringify({ status: 'invalid' })
    if (input.action === 'release') {
      await remove(key)
      return JSON.stringify({ status: 'ok', lease })
    }
    const renewed = { ...lease, expiresAt: input.now + input.duration }
    await set(key, JSON.stringify(renewed))
    return JSON.stringify({ status: 'ok', lease: renewed })
  },
}

export function createPlayerLeaseCoordinator({ persistence, now = () => Date.now(), leaseDurationMs = 45_000 } = {}) {
  if (!persistence || typeof persistence.eval !== 'function') throw new TypeError('Player lease persistence is required.')
  if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) throw new TypeError('Player lease duration is invalid.')

  return {
    acquire: input => run('acquire', input),
    renew: input => run('renew', input),
    release: input => run('release', input),
    assertWrite: input => run('assert', input),
    async get({ profileId, gameId }) {
      const raw = await persistence.get(key(profileId, gameId))
      const lease = raw ? JSON.parse(raw) : null
      return lease?.expiresAt > now() ? lease : null
    },
    async isActive(identity) { return (await this.get(identity)) !== null },
  }

  async function run(action, input) {
    validate(input, action !== 'acquire')
    const result = JSON.parse(await persistence.eval(transition, {
      keys: [key(input.profileId, input.gameId)],
      arguments: [JSON.stringify({ ...input, action, now: now(), duration: leaseDurationMs })],
    }))
    if (result.status === 'held') throw leaseError('PLAYER_LEASE_HELD', 'This profile is already open on another device.')
    if (result.status !== 'ok') throw leaseError('PLAYER_LEASE_INVALID', 'This player lease is no longer active.')
    return result.lease
  }
}

function key(profileId, gameId) { return `player-lease:${profileId}:${gameId}` }
function validate(input, needsGeneration) {
  for (const field of ['profileId', 'gameId', 'deviceId', 'sessionId']) if (typeof input?.[field] !== 'string' || input[field].length === 0) throw new TypeError(`Player lease ${field} is invalid.`)
  if (needsGeneration && (!Number.isInteger(input.generation) || input.generation < 1)) throw new TypeError('Player lease generation is invalid.')
  if (input.minimumGeneration !== undefined && (!Number.isInteger(input.minimumGeneration) || input.minimumGeneration < 1)) throw new TypeError('Player lease minimum generation is invalid.')
}
function leaseError(code, message) { const error = new Error(message); error.code = code; return error }
