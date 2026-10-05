const key = 'debugging-environment'
export const defaultDebuggingEnvironment = Object.freeze({ rngDebugLogging: false })

export function validateDebuggingEnvironment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.rngDebugLogging !== 'boolean') throw new TypeError('rngDebugLogging must be the only field and must be boolean.')
  return { rngDebugLogging: value.rngDebugLogging }
}

export function createDebuggingEnvironmentStore({ persistence }) {
  return {
    async get() {
      await persistence.set(key, JSON.stringify(defaultDebuggingEnvironment), { NX: true })
      return validateDebuggingEnvironment(JSON.parse(await persistence.get(key)))
    },
    async set(value) {
      const environment = validateDebuggingEnvironment(value)
      await persistence.set(key, JSON.stringify(environment))
      return environment
    },
  }
}
