export const InputType = Object.freeze({
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
  A: 'a',
  B: 'b',
  L: 'l',
  R: 'r',
})

export const ActionType = Object.freeze({
  PRESS: 'press',
  REPEAT: 'repeat',
  HOLD: 'hold',
})

export const AVAILABLE_INPUTS = Object.freeze([
  InputType.UP,
  InputType.DOWN,
  InputType.LEFT,
  InputType.RIGHT,
  InputType.A,
  InputType.B,
  InputType.L,
  InputType.R,
])

export const INPUT_LABELS = Object.freeze({
  [InputType.UP]: '↑ Up',
  [InputType.DOWN]: '↓ Down',
  [InputType.LEFT]: '← Left',
  [InputType.RIGHT]: '→ Right',
  [InputType.A]: 'A',
  [InputType.B]: 'B',
  [InputType.L]: 'L',
  [InputType.R]: 'R',
})

export const ACTION_TYPES = Object.freeze([ActionType.PRESS, ActionType.REPEAT, ActionType.HOLD])

export const ACTION_LABELS = Object.freeze({
  [ActionType.PRESS]: 'Press Once',
  [ActionType.REPEAT]: 'Repeat',
  [ActionType.HOLD]: 'Hold',
})

export const DEFAULT_STEP = Object.freeze({
  input: InputType.A,
  action: ActionType.PRESS,
  delay: 0,
})

export const INFINITE_DURATION = 0
export const HOLD_DURATION_MIN = 100
export const HOLD_DURATION_MAX = 30000
export const REPEAT_COUNT_MIN = 1
export const REPEAT_COUNT_MAX = 100
export const DELAY_MIN = 0
export const DELAY_MAX = 10000
export const MAX_STEPS = 100
export const NAME_MIN_LENGTH = 1
export const NAME_MAX_LENGTH = 50

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function now() {
  return Date.now()
}

export function createMacro(name) {
  const trimmed = name.trim()
  if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
    throw new Error(`Macro name must be between ${NAME_MIN_LENGTH} and ${NAME_MAX_LENGTH} characters`)
  }
  const timestamp = now()
  return {
    id: generateId(),
    name: trimmed,
    steps: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function addStep(macro, step, index) {
  if (macro.steps.length >= MAX_STEPS) {
    throw new Error(`Cannot exceed ${MAX_STEPS} steps per macro`)
  }
  const newStep = {
    ...DEFAULT_STEP,
    ...step,
    id: generateId(),
  }
  const steps = [...macro.steps]
  if (typeof index === 'number' && index >= 0 && index <= steps.length) {
    steps.splice(index, 0, newStep)
  } else {
    steps.push(newStep)
  }
  return {
    ...macro,
    steps,
    updatedAt: now(),
  }
}

export function removeStep(macro, stepId) {
  const steps = macro.steps.filter(s => s.id !== stepId)
  if (steps.length === macro.steps.length) {
    throw new Error(`Step with id ${stepId} not found`)
  }
  return {
    ...macro,
    steps,
    updatedAt: now(),
  }
}

export function updateStep(macro, stepId, updates) {
  const stepIndex = macro.steps.findIndex(s => s.id === stepId)
  if (stepIndex === -1) {
    throw new Error(`Step with id ${stepId} not found`)
  }
  const steps = [...macro.steps]
  steps[stepIndex] = {
    ...steps[stepIndex],
    ...updates,
  }
  return {
    ...macro,
    steps,
    updatedAt: now(),
  }
}

export function reorderSteps(macro, fromIndex, toIndex) {
  if (fromIndex < 0 || fromIndex >= macro.steps.length) {
    throw new Error('Invalid fromIndex')
  }
  if (toIndex < 0 || toIndex >= macro.steps.length) {
    throw new Error('Invalid toIndex')
  }
  if (fromIndex === toIndex) return macro
  const steps = [...macro.steps]
  const [removed] = steps.splice(fromIndex, 1)
  steps.splice(toIndex, 0, removed)
  return {
    ...macro,
    steps,
    updatedAt: now(),
  }
}

function validateStep(step, index) {
  const errors = []
  if (!AVAILABLE_INPUTS.includes(step.input)) {
    errors.push(`Step ${index + 1}: invalid input "${step.input}"`)
  }
  if (!ACTION_TYPES.includes(step.action)) {
    errors.push(`Step ${index + 1}: invalid action "${step.action}"`)
  }
  if (step.action === ActionType.HOLD) {
    if (step.duration !== INFINITE_DURATION && (typeof step.duration !== 'number' || step.duration < HOLD_DURATION_MIN || step.duration > HOLD_DURATION_MAX)) {
      errors.push(`Step ${index + 1}: hold duration must be 0 (infinite) or between ${HOLD_DURATION_MIN}ms and ${HOLD_DURATION_MAX}ms`)
    }
  }
  if (step.action === ActionType.REPEAT) {
    if (typeof step.duration !== 'number' || step.duration < REPEAT_COUNT_MIN || step.duration > REPEAT_COUNT_MAX) {
      errors.push(`Step ${index + 1}: repeat count must be between ${REPEAT_COUNT_MIN} and ${REPEAT_COUNT_MAX}`)
    }
  }
  if (step.action === ActionType.PRESS && step.duration != null && step.duration !== INFINITE_DURATION) {
    errors.push(`Step ${index + 1}: press duration must be 0 (infinite) or omitted`)
  }
  if (typeof step.delay !== 'number' || step.delay < DELAY_MIN || step.delay > DELAY_MAX) {
    errors.push(`Step ${index + 1}: delay must be between ${DELAY_MIN}ms and ${DELAY_MAX}ms`)
  }
  return errors
}

export function validateMacro(macro) {
  const errors = []
  if (!macro.name || macro.name.trim().length < NAME_MIN_LENGTH || macro.name.trim().length > NAME_MAX_LENGTH) {
    errors.push(`Macro name must be between ${NAME_MIN_LENGTH} and ${NAME_MAX_LENGTH} characters`)
  }
  if (!macro.steps || macro.steps.length === 0) {
    errors.push('Macro must have at least one step')
  }
  if (macro.steps && macro.steps.length > MAX_STEPS) {
    errors.push(`Macro cannot exceed ${MAX_STEPS} steps`)
  }
  if (macro.steps) {
    macro.steps.forEach((step, index) => {
      errors.push(...validateStep(step, index))
    })
  }
  return {
    valid: errors.length === 0,
    errors,
  }
}

const DEFAULT_PRESS_DURATION_MS = 60
const DEFAULT_REPEAT_INTERVAL_MS = 120

export function buildMacroTimeline(macro, options = {}) {
  const pressDurationMs = options.pressDurationMs ?? DEFAULT_PRESS_DURATION_MS
  const repeatIntervalMs = options.repeatIntervalMs ?? DEFAULT_REPEAT_INTERVAL_MS
  const events = []
  let cursor = 0
  for (const step of macro.steps) {
    const at = cursor
    if (step.action === ActionType.PRESS) {
      events.push({ at, input: step.input, value: 1 })
      if (step.duration !== INFINITE_DURATION) {
        events.push({ at: at + pressDurationMs, input: step.input, value: 0 })
      }
    } else if (step.action === ActionType.REPEAT) {
      for (let index = 0; index < step.duration; index += 1) {
        const pressAt = at + index * repeatIntervalMs
        events.push({ at: pressAt, input: step.input, value: 1 })
        events.push({ at: pressAt + pressDurationMs, input: step.input, value: 0 })
      }
    } else if (step.action === ActionType.HOLD) {
      events.push({ at, input: step.input, value: 1 })
      if (step.duration !== INFINITE_DURATION) {
        events.push({ at: at + step.duration, input: step.input, value: 0 })
      }
    }
    cursor = at + step.delay
  }
  return events
}

export const InputMacroSimulator = {
  InputType,
  ActionType,
  AVAILABLE_INPUTS,
  INPUT_LABELS,
  ACTION_TYPES,
  ACTION_LABELS,
  DEFAULT_STEP,
  createMacro,
  addStep,
  removeStep,
  updateStep,
  reorderSteps,
  validateMacro,
  HOLD_DURATION_MIN,
  HOLD_DURATION_MAX,
  REPEAT_COUNT_MIN,
  REPEAT_COUNT_MAX,
  DELAY_MIN,
  DELAY_MAX,
  MAX_STEPS,
  NAME_MIN_LENGTH,
  NAME_MAX_LENGTH,
  buildMacroTimeline,
  INFINITE_DURATION,
}

export default InputMacroSimulator