import { createClient } from 'redis'

const defaultNamespace = 'emulator-hub:v1'

export function createRedisPersistence({ url, namespace = defaultNamespace, client } = {}) {
  if (typeof url !== 'string' || !url) throw persistenceError('REDIS_URL_MISSING', 'REDIS_URL must be configured.')
  if (typeof namespace !== 'string' || !/^[a-z0-9][a-z0-9:_-]*$/i.test(namespace)) throw persistenceError('REDIS_NAMESPACE_INVALID', 'REDIS_NAMESPACE is invalid.')

  const redis = client ?? createClient({ url })
  let connection
  redis.on?.('error', () => {})

  async function connect() {
    if (!connection) connection = redis.connect().catch(error => {
      connection = null
      throw persistenceError('REDIS_CONNECTION_FAILED', 'Redis could not be reached.', error)
    })
    return connection
  }

  function key(name) { return `${namespace}:${name}` }
  async function call(method, ...args) {
    await connect()
    try { return await redis[method](...args) } catch (error) { throw persistenceError('REDIS_OPERATION_FAILED', 'Redis operation failed.', error) }
  }

  return {
    async connect() { await connect() },
    async close() { if (redis.isOpen) await redis.quit() },
    async get(name) { return call('get', key(name)) },
    async set(name, value, options) { return call('set', key(name), value, options) },
    async delete(name) { return call('del', key(name)) },
    async addToSet(name, member) { return call('sAdd', key(name), member) },
    async removeFromSet(name, member) { return call('sRem', key(name), member) },
    async members(name) { return call('sMembers', key(name)) },
    async addToSortedSet(name, member, score) { return call('zAdd', key(name), { score, value: member }) },
    async removeFromSortedSet(name, member) { return call('zRem', key(name), member) },
    async rangeByScore(name, minimum, maximum) { return call('zRangeByScore', key(name), minimum, maximum) },
    async keys(prefix) {
      await connect()
      const keys = []
      for await (const batch of redis.scanIterator({ MATCH: `${key(prefix)}*` })) {
        for (const found of Array.isArray(batch) ? batch : [batch]) keys.push(found.slice(namespace.length + 1))
      }
      return keys
    },
  }
}

export function createMemoryRedisPersistence({ namespace = defaultNamespace } = {}) {
  const values = new Map()
  const sortedSets = new Map()
  return {
    async connect() {},
    async close() {},
    async get(name) { return values.get(`${namespace}:${name}`) ?? null },
    async set(name, value, options = {}) {
      const key = `${namespace}:${name}`
      if (options.NX && values.has(key)) return null
      values.set(key, value)
      return 'OK'
    },
    async delete(name) { return values.delete(`${namespace}:${name}`) ? 1 : 0 },
    async addToSet(name, member) {
      const key = `${namespace}:${name}`
      const members = values.get(key) ?? new Set()
      if (!(members instanceof Set)) throw new TypeError('Persistence key is not a set.')
      const size = members.size
      members.add(member)
      values.set(key, members)
      return members.size - size
    },
    async removeFromSet(name, member) {
      const members = values.get(`${namespace}:${name}`)
      if (!(members instanceof Set)) return 0
      const removed = members.delete(member) ? 1 : 0
      if (members.size === 0) values.delete(`${namespace}:${name}`)
      return removed
    },
    async members(name) {
      const members = values.get(`${namespace}:${name}`)
      if (members === undefined) return []
      if (!(members instanceof Set)) throw new TypeError('Persistence key is not a set.')
      return [...members]
    },
    async addToSortedSet(name, member, score) {
      const key = `${namespace}:${name}`
      const members = sortedSets.get(key) ?? new Map()
      const existed = members.has(member)
      members.set(member, score)
      sortedSets.set(key, members)
      return existed ? 0 : 1
    },
    async removeFromSortedSet(name, member) {
      const key = `${namespace}:${name}`
      const members = sortedSets.get(key)
      if (!members) return 0
      const removed = members.delete(member) ? 1 : 0
      if (members.size === 0) sortedSets.delete(key)
      return removed
    },
    async rangeByScore(name, minimum, maximum) {
      const members = sortedSets.get(`${namespace}:${name}`)
      if (!members) return []
      return [...members.entries()]
        .filter(([, score]) => score >= minimum && score <= maximum)
        .sort(([leftMember, leftScore], [rightMember, rightScore]) => leftScore - rightScore || leftMember.localeCompare(rightMember))
        .map(([member]) => member)
    },
    async keys(prefix) { return [...values.keys()].filter(key => key.startsWith(`${namespace}:${prefix}`)).map(key => key.slice(namespace.length + 1)) },
  }
}

export function persistenceError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  return error
}
