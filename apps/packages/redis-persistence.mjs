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
    async keys(prefix) {
      await connect()
      const keys = []
      for await (const found of redis.scanIterator({ MATCH: `${key(prefix)}*` })) keys.push(found.slice(namespace.length + 1))
      return keys
    },
  }
}

export function createMemoryRedisPersistence({ namespace = defaultNamespace } = {}) {
  const values = new Map()
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
    async keys(prefix) { return [...values.keys()].filter(key => key.startsWith(`${namespace}:${prefix}`)).map(key => key.slice(namespace.length + 1)) },
  }
}

export function persistenceError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  return error
}
