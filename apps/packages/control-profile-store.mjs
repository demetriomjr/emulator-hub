import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const inputIds = Object.freeze(['0', '2', '3', '4', '5', '6', '7', '8', '10', '11'])

export const defaultControlProfile = Object.freeze({
  version: 1,
  name: 'Default',
  system: 'gba',
  bindings: Object.freeze({
    0: Object.freeze({ keyboard: 'x', gamepad: 'BUTTON_2' }),
    2: Object.freeze({ keyboard: 'shift', gamepad: 'SELECT' }),
    3: Object.freeze({ keyboard: 'enter', gamepad: 'START' }),
    4: Object.freeze({ keyboard: 'up arrow', gamepad: 'DPAD_UP' }),
    5: Object.freeze({ keyboard: 'down arrow', gamepad: 'DPAD_DOWN' }),
    6: Object.freeze({ keyboard: 'left arrow', gamepad: 'DPAD_LEFT' }),
    7: Object.freeze({ keyboard: 'right arrow', gamepad: 'DPAD_RIGHT' }),
    8: Object.freeze({ keyboard: 'z', gamepad: 'BUTTON_1' }),
    10: Object.freeze({ keyboard: 'a', gamepad: 'LEFT_TOP_SHOULDER' }),
    11: Object.freeze({ keyboard: 's', gamepad: 'RIGHT_TOP_SHOULDER' }),
  }),
})

export function createControlProfileStore({ dataPath }) {
  let queue = Promise.resolve()

  return {
    async get() {
      return copyProfile(await readProfile(dataPath))
    },
    replace(profile) {
      const operation = queue.then(async () => {
        const normalized = normalizeProfile(profile)
        await writeProfile(dataPath, normalized)
        return copyProfile(normalized)
      })
      queue = operation.catch(() => {})
      return operation
    },
  }
}

async function readProfile(dataPath) {
  try {
    const source = await readFile(dataPath, 'utf8')
    return normalizeProfile(JSON.parse(source))
  } catch (error) {
    if (error.code === 'ENOENT') return defaultControlProfile
    if (error.code === 'CONTROL_PROFILE_INVALID') throw error
    const storeError = new Error('Control profile could not be loaded.', { cause: error })
    storeError.code = 'CONTROL_PROFILE_LOAD_FAILED'
    throw storeError
  }
}

async function writeProfile(dataPath, profile) {
  try {
    await mkdir(dirname(dataPath), { recursive: true })
    const temporaryPath = `${dataPath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, JSON.stringify(profile, null, 2), 'utf8')
    await rename(temporaryPath, dataPath)
  } catch (error) {
    const storeError = new Error('Control profile could not be saved.', { cause: error })
    storeError.code = 'CONTROL_PROFILE_WRITE_FAILED'
    throw storeError
  }
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== 'object' || profile.version !== 1 || profile.system !== 'gba') {
    throw profileError()
  }

  const name = normalizeValue(profile.name)
  if (!name || name.length > 32) throw profileError()
  const bindings = {}
  if (!profile.bindings || typeof profile.bindings !== 'object') throw profileError()
  if (Object.keys(profile.bindings).length !== inputIds.length || inputIds.some(id => !(id in profile.bindings))) throw profileError()

  for (const id of inputIds) {
    const binding = profile.bindings[id]
    if (!binding || typeof binding !== 'object') throw profileError()
    const keyboard = normalizeValue(binding.keyboard)
    const gamepad = normalizeValue(binding.gamepad)
    if (!keyboard || !gamepad || keyboard.length > 64 || gamepad.length > 64) throw profileError()
    bindings[id] = { keyboard, gamepad }
  }

  return { version: 1, name, system: 'gba', bindings }
}

function normalizeValue(value) {
  return typeof value === 'string' && !/[\u0000-\u001F\u007F]/.test(value) ? value.normalize('NFC').trim() : ''
}

function copyProfile(profile) {
  return { ...profile, bindings: Object.fromEntries(Object.entries(profile.bindings).map(([id, binding]) => [id, { ...binding }])) }
}

function profileError() {
  const error = new Error('Control profile must contain complete GBA keyboard and gamepad bindings.')
  error.code = 'CONTROL_PROFILE_INVALID'
  return error
}
