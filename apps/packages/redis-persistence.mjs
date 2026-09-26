const defaultNamespace = 'emulator-hub:v1'

export function createRedisPersistence({ url, namespace = defaultNamespace, client, createClient } = {}) {
  if (typeof url !== 'string' || !url) throw persistenceError('REDIS_URL_MISSING', 'REDIS_URL must be configured.')
  if (typeof namespace !== 'string' || !/^[a-z0-9][a-z0-9:_-]*$/i.test(namespace)) throw persistenceError('REDIS_NAMESPACE_INVALID', 'REDIS_NAMESPACE is invalid.')

  if (!client && typeof createClient !== 'function') throw new TypeError('Redis client factory is required.')
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

  async function evalScript(transition, { keys = [], arguments: scriptArguments = [] } = {}) {
    const script = normalizeLuaTransition(transition).lua
    if (!Array.isArray(keys) || keys.some(keyName => typeof keyName !== 'string' || keyName.length === 0)) throw persistenceError('REDIS_SCRIPT_KEYS_INVALID', 'Redis script keys are invalid.')
    if (!Array.isArray(scriptArguments) || scriptArguments.some(argument => typeof argument !== 'string' && !Buffer.isBuffer(argument))) throw persistenceError('REDIS_SCRIPT_ARGUMENTS_INVALID', 'Redis script arguments are invalid.')
    return call('eval', script, { keys: keys.map(key), arguments: scriptArguments })
  }

  return {
    async connect() { await connect() },
    async close() { if (redis.isOpen) await redis.quit() },
    async eval(script, options) { return evalScript(script, options) },
    async get(name) { return call('get', key(name)) },
    async type(name) { return call('type', key(name)) },
    async set(name, value, options) { return call('set', key(name), value, options) },
    async delete(name) { return call('del', key(name)) },
    async addToSet(name, member) { return call('sAdd', key(name), member) },
    async removeFromSet(name, member) { return call('sRem', key(name), member) },
    async members(name) { return call('sMembers', key(name)) },
    async addToSortedSet(name, member, score) { return call('zAdd', key(name), { score, value: member }) },
    async removeFromSortedSet(name, member) { return call('zRem', key(name), member) },
    async rangeByScore(name, minimum, maximum) { return call('zRangeByScore', key(name), minimum, maximum) },
    async rangeWithScores(name) { return call('zRangeWithScores', key(name), 0, -1) },
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
  const namespacePrefix = `${namespace}:`
  let evalTail = Promise.resolve()
  const fullKey = name => name.startsWith(namespacePrefix) ? name : `${namespacePrefix}${name}`
  const logicalKey = name => name.startsWith(namespacePrefix) ? name.slice(namespacePrefix.length) : name
  const runEval = async (transition, options = {}) => {
    const script = normalizeLuaTransition(transition).memory
    const keys = options.keys ?? []
    const scriptArguments = options.arguments ?? []
    if (!Array.isArray(keys) || keys.some(keyName => typeof keyName !== 'string' || keyName.length === 0)) throw persistenceError('REDIS_SCRIPT_KEYS_INVALID', 'Redis script keys are invalid.')
    if (!Array.isArray(scriptArguments) || scriptArguments.some(argument => typeof argument !== 'string' && !Buffer.isBuffer(argument))) throw persistenceError('REDIS_SCRIPT_ARGUMENTS_INVALID', 'Redis script arguments are invalid.')
    const run = evalTail.then(async () => script({
      keys: keys.map(fullKey),
      arguments: scriptArguments,
      async get(name) { return values.get(fullKey(name)) ?? null },
      async set(name, value, setOptions = {}) {
        const target = fullKey(name)
        if (setOptions.NX && values.has(target)) return null
        values.set(target, value)
        return 'OK'
      },
      async delete(name) { return values.delete(fullKey(name)) ? 1 : 0 },
    }))
    evalTail = run.catch(() => {})
    return run
  }
  return {
    async connect() {},
    async close() {},
    async eval(script, options) { return runEval(script, options) },
    async get(name) { return values.get(fullKey(name)) ?? null },
    async type(name) {
      const key = fullKey(name)
      if (sortedSets.has(key)) return 'zset'
      if (values.get(key) instanceof Set) return 'set'
      return values.has(key) ? 'string' : 'none'
    },
    async set(name, value, options = {}) {
      const key = fullKey(name)
      if (options.NX && values.has(key)) return null
      values.set(key, value)
      return 'OK'
    },
    async delete(name) { return values.delete(fullKey(name)) ? 1 : 0 },
    async addToSet(name, member) {
      const key = fullKey(name)
      const members = values.get(key) ?? new Set()
      if (!(members instanceof Set)) throw new TypeError('Persistence key is not a set.')
      const size = members.size
      members.add(member)
      values.set(key, members)
      return members.size - size
    },
    async removeFromSet(name, member) {
      const members = values.get(fullKey(name))
      if (!(members instanceof Set)) return 0
      const removed = members.delete(member) ? 1 : 0
      if (members.size === 0) values.delete(fullKey(name))
      return removed
    },
    async members(name) {
      const members = values.get(fullKey(name))
      if (members === undefined) return []
      if (!(members instanceof Set)) throw new TypeError('Persistence key is not a set.')
      return [...members]
    },
    async addToSortedSet(name, member, score) {
      const key = fullKey(name)
      const members = sortedSets.get(key) ?? new Map()
      const existed = members.has(member)
      members.set(member, score)
      sortedSets.set(key, members)
      return existed ? 0 : 1
    },
    async removeFromSortedSet(name, member) {
      const key = fullKey(name)
      const members = sortedSets.get(key)
      if (!members) return 0
      const removed = members.delete(member) ? 1 : 0
      if (members.size === 0) sortedSets.delete(key)
      return removed
    },
    async rangeByScore(name, minimum, maximum) {
      const members = sortedSets.get(fullKey(name))
      if (!members) return []
      return [...members.entries()]
        .filter(([, score]) => score >= minimum && score <= maximum)
        .sort(([leftMember, leftScore], [rightMember, rightScore]) => leftScore - rightScore || leftMember.localeCompare(rightMember))
        .map(([member]) => member)
    },
    async rangeWithScores(name) {
      const members = sortedSets.get(fullKey(name))
      if (!members) return []
      return [...members.entries()]
        .sort(([leftMember, leftScore], [rightMember, rightScore]) => leftScore - rightScore || leftMember.localeCompare(rightMember))
        .map(([value, score]) => ({ value, score }))
    },
    async keys(prefix) { return [...new Set([...values.keys(), ...sortedSets.keys()])].filter(key => key.startsWith(fullKey(prefix))).map(logicalKey) },
  }
}

function normalizeLuaTransition(transition) {
  if (typeof transition === 'string' && transition.length > 0) return { lua: transition, memory: null }
  if (!transition || typeof transition !== 'object' || typeof transition.lua !== 'string' || transition.lua.length === 0 || typeof transition.memory !== 'function') throw persistenceError('REDIS_SCRIPT_INVALID', 'Redis atomic transition must provide Lua and memory handlers.')
  return transition
}

export function persistenceError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  return error
}
