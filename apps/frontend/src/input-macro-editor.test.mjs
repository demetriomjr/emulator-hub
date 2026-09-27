import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { transformWithOxc } from 'vite'
import { AVAILABLE_INPUTS, InputType, MAX_ITEMS, addItem, createMacro, removeItem, reorderItems, updateItem, validateMacro } from '../../packages/input-macro-simulator.mjs'

const source = (await readFile(new URL('../../packages/input-macro-simulator-ui.jsx', import.meta.url), 'utf8'))
  .replace(/^import .+\r?\n/gm, '')
  .replace('export default function MacroEditor', 'function MacroEditor')
  .replace('export function ControllerIcon', 'function ControllerIcon')
const transformed = await transformWithOxc(source + '\nglobalThis.MacroEditor = MacroEditor; globalThis.MacroItemRow = MacroItemRow', 'input-macro-simulator-ui.jsx', { jsx: { runtime: 'classic' } })
const icon = () => null
const context = {
  React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }) },
  Button: icon, InputNumber: icon, Select: icon, DragDropProvider: icon,
  ArrowDownOutlined: icon, ArrowLeftOutlined: icon, ArrowRightOutlined: icon, ArrowUpOutlined: icon,
  ClockCircleOutlined: icon, DeleteOutlined: icon, HolderOutlined: icon, RedoOutlined: icon,
  PointerSensor: { configure: () => [] }, PointerActivationConstraints: { Distance: class {} },
  useDraggable: () => ({ ref() {}, isDragging: false }), useDroppable: () => ({ ref() {}, isDropTarget: false }),
  AVAILABLE_INPUTS, InputType, MAX_ITEMS, addItem, removeItem, reorderItems, updateItem, validateMacro,
}
vm.runInNewContext(transformed.code, context)

function nodes(root) {
  const result = []
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object' || !('type' in value)) return
    const element = value.type === context.MacroItemRow ? context.MacroItemRow(value.props) : value
    result.push(element)
    visit(element.props?.children)
  }
  visit(root)
  return result
}

function render(macro, props = {}) {
  let changed
  const tree = context.MacroEditor({ macro, onChange: next => { changed = next }, onSave() {}, onStart() {}, onStop() {}, ...props })
  return { all: nodes(tree), changed: () => changed }
}

test('three icon buttons add the corresponding item with its defaults', () => {
  for (const [label, kind] of [['Adicionar botão', 'button'], ['Adicionar delay', 'delay'], ['Adicionar repeat', 'repeat']]) {
    const view = render(createMacro('Teste'))
    view.all.find(node => node.props?.['aria-label'] === label).props.onClick()
    assert.equal(view.changed().items[0].kind, kind)
  }
})

test('row fields update values, delete a row and move by keyboard', () => {
  let macro = addItem(createMacro('Teste'), 'button')
  macro = addItem(macro, 'delay')
  const view = render(macro)
  view.all.find(node => node.props?.['aria-label'] === 'Botão do item 1').props.onChange('b')
  assert.equal(view.changed().items[0].input, 'b')
  view.all.find(node => node.props?.['aria-label'] === 'Mover item 2').props.onKeyDown({ key: 'ArrowUp', preventDefault() {} })
  assert.equal(view.changed().items[0].kind, 'delay')
  view.all.find(node => node.props?.['aria-label'] === 'Excluir item 1').props.onClick()
  assert.equal(view.changed().items.length, 1)
})

test('dropping one item on another changes their order', () => {
  let macro = addItem(createMacro('Teste'), 'button')
  macro = addItem(macro, 'repeat')
  const view = render(macro)
  view.all.find(node => node.type === context.DragDropProvider).props.onDragEnd({ operation: { source: { data: { index: 0 } }, target: { data: { index: 1 } } } })
  assert.deepEqual(view.changed().items.map(item => item.kind), ['repeat', 'button'])
})

test('run control calls Iniciar or Parar according to confirmed phase', () => {
  const macro = addItem(createMacro('Teste'), 'button')
  let action = ''
  const controls = phase => nodes(context.MacroEditor({ macro, onChange() {}, onSave() {}, onStart: () => { action = 'start' }, onStop: () => { action = 'stop' }, runPhase: phase }))
    .find(node => node.props?.className?.includes('macro-run-toggle'))
  controls('idle').props.onClick()
  assert.equal(action, 'start')
  controls('running').props.onClick()
  assert.equal(action, 'stop')
})

test('invalid count shows an error in its item row', () => {
  const macro = addItem(createMacro('Teste'), 'button', { count: null })
  const view = render(macro)
  assert.ok(view.all.some(node => node.props?.className === 'macro-item-error' && String(node.props.children).includes('Item 1')))
})

test('Hold duration input accepts zero for a continuous hold', () => {
  const macro = addItem(createMacro('Continuous'), 'button', { action: 'hold', holdMs: 2000 })
  const view = render(macro)
  const duration = view.all.find(node => node.type === context.InputNumber && node.props?.value === 2000)
  assert.equal(duration.props.min, 0)
  assert.match(duration.props.title, /0 mantém pressionado/)
  duration.props.onChange(0)
  assert.equal(view.changed().items[0].holdMs, 0)
  assert.equal(validateMacro(view.changed()).valid, true)
})

test('Press count accepts zero and hides its inapplicable posterior delay', () => {
  const macro = addItem(createMacro('Infinite Press'), 'button', { action: 'press', count: 1 })
  const editable = render(macro)
  editable.all.find(node => node.props?.precision === 0 && node.props?.value === 1).props.onChange(0)
  const view = render(editable.changed())
  const numbers = view.all.filter(node => node.props?.precision === 0)
  assert.equal(numbers.length, 1)
  assert.equal(numbers[0].props.min, 0)
  assert.match(numbers[0].props.title, /0.*infinit/)
  assert.equal(validateMacro(editable.changed()).valid, true)
})

test('item insertion is disabled at the 100 item limit', () => {
  let macro = createMacro('Cheia')
  for (let index = 0; index < MAX_ITEMS; index += 1) macro = addItem(macro, 'delay')
  const view = render(macro)
  assert.equal(view.all.find(node => node.props?.['aria-label'] === 'Adicionar botão').props.disabled, true)
})
