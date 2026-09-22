const speeds = Object.freeze([1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])
const actions = Object.freeze(['none', 'soft-reset', 'reset', 'save-state', 'load-state', 'fast-forward'])
export const defaultUserPreferences = Object.freeze({ version: 1, fastForwardSpeed: 1.5, triggerActions: Object.freeze({ l2: 'none', r2: 'none' }) })

export function createRedisUserPreferencesStore({ persistence }) {
  let queue = Promise.resolve()
  return {
    async get() {
      const source = await persistence.get('user-preferences')
      if (source === null) return { preferences: copy(defaultUserPreferences), initialized: false }
      return { preferences: normalize(JSON.parse(source)), initialized: true }
    },
    patch(partial) {
      const operation = queue.then(async () => {
        const normalized = normalizePartial(partial)
        const result = JSON.parse(await persistence.eval(userPreferencesTransition, { keys: ['user-preferences'], arguments: [JSON.stringify(normalized)] }))
        if (result.error) throw preferenceError(result.error)
        return { preferences: normalize(result.preferences), initialized: result.initialized }
      })
      queue = operation.catch(() => {})
      return operation
    },
  }
}

export function normalizePartial(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw preferenceError('USER_PREFERENCES_INVALID')
  const keys = Object.keys(value)
  if (keys.some(key => !['fastForwardSpeed', 'triggerActions', 'initializeIfAbsent'].includes(key))) throw preferenceError('USER_PREFERENCES_INVALID')
  if ('initializeIfAbsent' in value && value.initializeIfAbsent !== true) throw preferenceError('USER_PREFERENCES_INVALID')
  if ('fastForwardSpeed' in value && !speeds.includes(value.fastForwardSpeed)) throw preferenceError('USER_PREFERENCES_INVALID')
  if ('triggerActions' in value) {
    const triggerActions = value.triggerActions
    if (!triggerActions || typeof triggerActions !== 'object' || Array.isArray(triggerActions) || Object.keys(triggerActions).some(key => !['l2', 'r2'].includes(key))) throw preferenceError('USER_PREFERENCES_INVALID')
    for (const action of Object.values(triggerActions)) if (!actions.includes(action)) throw preferenceError('USER_PREFERENCES_INVALID')
  }
  return { ...value, triggerActions: value.triggerActions ? { ...value.triggerActions } : undefined }
}

function normalize(value) {
  if (!value || value.version !== 1 || !speeds.includes(value.fastForwardSpeed) || !value.triggerActions || !actions.includes(value.triggerActions.l2) || !actions.includes(value.triggerActions.r2)) throw preferenceError('USER_PREFERENCES_INVALID')
  return { version: 1, fastForwardSpeed: value.fastForwardSpeed, triggerActions: { l2: value.triggerActions.l2, r2: value.triggerActions.r2 } }
}

function copy(value) { return { version: 1, fastForwardSpeed: value.fastForwardSpeed, triggerActions: { ...value.triggerActions } } }
function preferenceError(code) { const error = new Error('User preferences are invalid.'); error.code = code; return error }

const userPreferencesTransition = {
  lua: `local raw = redis.call('GET', KEYS[1])
local input = cjson.decode(ARGV[1])
if raw == false then
  local initial = { version = 1, fastForwardSpeed = input.fastForwardSpeed or 1.5, triggerActions = { l2 = 'none', r2 = 'none' } }
  if input.triggerActions then if input.triggerActions.l2 then initial.triggerActions.l2 = input.triggerActions.l2 end; if input.triggerActions.r2 then initial.triggerActions.r2 = input.triggerActions.r2 end end
  if input.initializeIfAbsent then redis.call('SET', KEYS[1], cjson.encode(initial)); return cjson.encode({ preferences = initial, initialized = true }) end
  return cjson.encode({ preferences = initial, initialized = false })
end
local current = cjson.decode(raw)
if input.initializeIfAbsent then return cjson.encode({ preferences = current, initialized = true }) end
if input.fastForwardSpeed then current.fastForwardSpeed = input.fastForwardSpeed end
if input.triggerActions then if input.triggerActions.l2 then current.triggerActions.l2 = input.triggerActions.l2 end; if input.triggerActions.r2 then current.triggerActions.r2 = input.triggerActions.r2 end end
redis.call('SET', KEYS[1], cjson.encode(current))
return cjson.encode({ preferences = current, initialized = true })`,
  async memory({ keys, arguments: [encoded], get, set }) {
    const input = JSON.parse(encoded)
    const raw = await get(keys[0])
    if (!raw) {
      const initial = copy(defaultUserPreferences)
      if (input.fastForwardSpeed !== undefined) initial.fastForwardSpeed = input.fastForwardSpeed
      if (input.triggerActions) Object.assign(initial.triggerActions, input.triggerActions)
      if (input.initializeIfAbsent) { await set(keys[0], JSON.stringify(initial)); return JSON.stringify({ preferences: initial, initialized: true }) }
      return JSON.stringify({ preferences: initial, initialized: false })
    }
    const current = normalize(JSON.parse(raw))
    if (input.initializeIfAbsent) return JSON.stringify({ preferences: current, initialized: true })
    if (input.fastForwardSpeed !== undefined) current.fastForwardSpeed = input.fastForwardSpeed
    if (input.triggerActions) Object.assign(current.triggerActions, input.triggerActions)
    await set(keys[0], JSON.stringify(current))
    return JSON.stringify({ preferences: current, initialized: true })
  },
}
