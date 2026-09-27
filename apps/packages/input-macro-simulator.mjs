export const InputType = Object.freeze({ UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right', A: 'a', B: 'b', L: 'l', R: 'r' })
export const ActionType = Object.freeze({ PRESS: 'press', HOLD: 'hold' })
export const AVAILABLE_INPUTS = Object.freeze(Object.values(InputType))
export const INPUT_LABELS = Object.freeze({ up: '↑ Up', down: '↓ Down', left: '← Left', right: '→ Right', a: 'A', b: 'B', l: 'L', r: 'R' })
export const INPUT_CORE_IDS = Object.freeze({ up: 4, down: 5, left: 6, right: 7, a: 8, b: 0, l: 10, r: 11 })
export const MAX_ITEMS = 100
export const MAX_DURATION_MS = 600000
export const PRESS_DURATION_MS = 60
export const PRESS_INTERVAL_MS = 800

export function normalizeKeyboardKey(key) {
  const namedKeys = { ArrowUp: 'up arrow', ArrowDown: 'down arrow', ArrowLeft: 'left arrow', ArrowRight: 'right arrow', Enter: 'enter', ' ': 'space' }
  return namedKeys[key] ?? key.toLowerCase()
}

export function macroUsesKeyboardKey(macro, key, bindings) {
  const normalized = normalizeKeyboardKey(key)
  return macro.items.some(item => item.kind === 'button' && normalizeKeyboardKey(bindings?.[INPUT_CORE_IDS[item.input]]?.keyboard ?? '') === normalized)
}

const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max

export function createMacro(name = 'Nova macro') {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 50) throw new Error('Nome da macro deve ter entre 1 e 50 caracteres')
  const now = Date.now()
  return { schemaVersion: 2, id: id(), name: name.trim(), items: [], createdAt: now, updatedAt: now }
}

export function createItem(kind, overrides = {}) {
  const base = kind === 'button'
    ? { kind, input: 'a', action: 'press', count: 1, delayAfterMs: 800 }
    : kind === 'delay' ? { kind, durationMs: 1200 }
      : kind === 'repeat' ? { kind, count: 1 } : null
  if (!base) throw new Error('Tipo de item inválido')
  const item = { ...base, ...overrides, id: id(), kind }
  if (kind === 'button' && item.action === 'hold') {
    delete item.count
    item.holdMs ??= 2000
  }
  return item
}

export function addItem(macro, kind, overrides = {}, index = macro.items.length) {
  if (macro.items.length >= MAX_ITEMS) throw new Error(`A macro não pode exceder ${MAX_ITEMS} itens`)
  const items = [...macro.items]
  items.splice(index, 0, createItem(kind, overrides))
  return { ...macro, items, updatedAt: Date.now() }
}

export function removeItem(macro, itemId) {
  const items = macro.items.filter(item => item.id !== itemId)
  if (items.length === macro.items.length) throw new Error('Item não encontrado')
  return { ...macro, items, updatedAt: Date.now() }
}

export function updateItem(macro, itemId, changes) {
  const index = macro.items.findIndex(item => item.id === itemId)
  if (index < 0) throw new Error('Item não encontrado')
  const previous = macro.items[index]
  let item = { ...previous, ...changes, id: previous.id }
  if ((previous.kind === 'legacy' && changes.action) || (previous.kind === 'button' && changes.action && changes.action !== previous.action)) {
    item = { id: item.id, kind: 'button', input: item.input, action: changes.action, delayAfterMs: item.delayAfterMs, ...(changes.action === 'press' ? { count: 1 } : { holdMs: 2000 }) }
  }
  const items = [...macro.items]
  items[index] = item
  return { ...macro, items, updatedAt: Date.now() }
}

export function reorderItems(macro, fromIndex, toIndex) {
  if (!integer(fromIndex, 0, macro.items.length - 1) || !integer(toIndex, 0, macro.items.length - 1)) throw new Error('Posição inválida')
  if (fromIndex === toIndex) return macro
  const items = [...macro.items]
  items.splice(toIndex, 0, items.splice(fromIndex, 1)[0])
  return { ...macro, items, updatedAt: Date.now() }
}

export function validateMacro(macro) {
  const errors = []
  if (!object(macro)) return { valid: false, errors: ['Macro inválida'] }
  if (macro.schemaVersion !== 2) errors.push('Versão da macro inválida')
  if (typeof macro.id !== 'string' || !macro.id.trim()) errors.push('ID da macro inválido')
  if (typeof macro.name !== 'string' || !macro.name.trim() || macro.name.trim().length > 50) errors.push('Nome da macro deve ter entre 1 e 50 caracteres')
  if (!Array.isArray(macro.items) || macro.items.length === 0 || macro.items.length > MAX_ITEMS) errors.push(`A macro deve ter entre 1 e ${MAX_ITEMS} itens`)
  if (!integer(macro.createdAt, 0) || !integer(macro.updatedAt, 0)) errors.push('Datas da macro inválidas')
  const ids = new Set()
  if (Array.isArray(macro.items)) macro.items.forEach((item, index) => {
    const label = `Item ${index + 1}`
    if (!object(item)) { errors.push(`${label}: formato inválido`); return }
    if (typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) errors.push(`${label}: ID inválido ou repetido`)
    ids.add(item.id)
    const allowed = item.kind === 'button' ? ['id', 'kind', 'input', 'action', 'delayAfterMs', item.action === 'hold' ? 'holdMs' : 'count']
      : item.kind === 'delay' ? ['id', 'kind', 'durationMs']
        : item.kind === 'repeat' ? ['id', 'kind', 'count'] : []
    if (Object.keys(item).some(key => !allowed.includes(key))) errors.push(`${label}: campo inesperado`)
    if (item.kind === 'button') {
      if (!AVAILABLE_INPUTS.includes(item.input)) errors.push(`${label}: botão inválido`)
      if (!integer(item.delayAfterMs, 0, MAX_DURATION_MS)) errors.push(`${label}: delay posterior inválido`)
      if (item.action === 'press') {
        if (!integer(item.count, 1)) errors.push(`${label}: quantidade de pressões inválida`)
        if ('holdMs' in item) errors.push(`${label}: Hold não pertence a Press`)
      } else if (item.action === 'hold') {
        if (!integer(item.holdMs, 1, MAX_DURATION_MS)) errors.push(`${label}: duração de Hold inválida`)
        if ('count' in item) errors.push(`${label}: Count não pertence a Hold`)
      } else errors.push(`${label}: ação inválida`)
    } else if (item.kind === 'delay') {
      if (!integer(item.durationMs, 0, MAX_DURATION_MS)) errors.push(`${label}: duração de Delay inválida`)
    } else if (item.kind === 'repeat') {
      if (!integer(item.count, 0)) errors.push(`${label}: quantidade de Repeat inválida`)
    } else errors.push(`${label}: tipo inválido`)
  })
  return { valid: errors.length === 0, errors }
}

export function validateLegacyMacro(macro) {
  const numberIn = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  if (!object(macro) || typeof macro.id !== 'string' || !macro.id || typeof macro.name !== 'string' || !macro.name.trim() || !Array.isArray(macro.steps) || !numberIn(macro.createdAt, 0, Number.MAX_SAFE_INTEGER) || !numberIn(macro.updatedAt, 0, Number.MAX_SAFE_INTEGER)) return false
  return macro.steps.length > 0 && macro.steps.length <= MAX_ITEMS && macro.steps.every(step => object(step) && typeof step.id === 'string' && step.id && AVAILABLE_INPUTS.includes(step.input) && ['press', 'hold', 'repeat'].includes(step.action) && numberIn(step.delay, 0, 10000) && (step.action === 'press' ? step.duration == null || step.duration === 0 : step.action === 'hold' ? step.duration === 0 || numberIn(step.duration, 100, 30000) : numberIn(step.duration, 1, 100)))
}

export function migrateMacro(stored) {
  if (stored?.schemaVersion === 2) return { macro: structuredClone(stored), warnings: [] }
  if (!validateLegacyMacro(stored)) throw new Error('Macro legada inválida')
  const warnings = ['A temporização desta macro foi convertida: o delay ocorre após o botão e Press usa 800 ms entre pressões.']
  const items = stored.steps.map(step => {
    const common = { id: step.id, input: step.input, delayAfterMs: step.delay }
    if (step.duration === 0 || !Number.isSafeInteger(step.delay) || (step.action !== 'press' && !Number.isSafeInteger(step.duration))) {
      warnings.push('Um botão infinito antigo precisa ser substituído por Press ou Hold finito.')
      return { ...common, kind: 'legacy', action: step.action, legacyDuration: step.duration }
    }
    if (step.action === 'hold') return { ...common, kind: 'button', action: 'hold', holdMs: step.duration }
    return { ...common, kind: 'button', action: 'press', count: step.action === 'repeat' ? step.duration : 1 }
  })
  return { macro: { schemaVersion: 2, id: stored.id, name: stored.name, items, createdAt: stored.createdAt, updatedAt: stored.updatedAt }, warnings }
}

export function createMacroCursor(macro) {
  let index = 0
  const counters = new Map()
  return {
    next() {
      let traversed = 0
      while (index < macro.items.length) {
        if (++traversed > 1000) return { kind: 'yield' }
        const item = macro.items[index]
        if (item.kind !== 'repeat') { index += 1; return item }
        if (item.count === 0) { index = 0; continue }
        const count = (counters.get(index) ?? 0) + 1
        if (count < item.count) { counters.set(index, count); index = 0 }
        else { counters.delete(index); index += 1 }
      }
      return null
    },
  }
}

export function createMacroRunner({ macro, setPressed, schedule = setTimeout, clear = clearTimeout, onEnd = () => {} }) {
  const cursor = createMacroCursor(macro)
  let timer = null
  let held = null
  let active = false
  const release = () => {
    if (held === null) return true
    const input = held
    held = null
    try { setPressed(input, false); return true } catch { return false }
  }
  const finish = outcome => { if (!active) return; active = false; if (timer !== null) clear(timer); timer = null; release(); onEnd(outcome) }
  const safe = next => { try { next() } catch { finish('failed') } }
  const wait = (ms, next) => { timer = schedule(() => { timer = null; if (active) safe(next) }, ms) }
  const advance = () => {
    if (!active) return
    const item = cursor.next()
    if (!item) { finish('completed'); return }
    if (item.kind === 'yield') { wait(0, advance); return }
    if (item.kind === 'delay') { wait(item.durationMs, advance); return }
    let remaining = item.action === 'press' ? item.count : 1
    const press = () => {
      held = item.input
      setPressed(item.input, true)
      wait(item.action === 'hold' ? item.holdMs : PRESS_DURATION_MS, () => {
        if (!release()) { finish('failed'); return }
        remaining -= 1
        if (remaining > 0) wait(PRESS_INTERVAL_MS, press)
        else wait(item.delayAfterMs, advance)
      })
    }
    press()
  }
  return {
    start() { if (active) return; const validation = validateMacro(macro); if (!validation.valid) throw new Error(validation.errors[0]); active = true; safe(advance) },
    stop() { finish('stopped') },
    isActive() { return active },
  }
}

export const InputMacroSimulator = { InputType, ActionType, AVAILABLE_INPUTS, INPUT_LABELS, INPUT_CORE_IDS, createMacro, createItem, addItem, removeItem, updateItem, reorderItems, validateMacro, migrateMacro, createMacroCursor, createMacroRunner }
export default InputMacroSimulator
