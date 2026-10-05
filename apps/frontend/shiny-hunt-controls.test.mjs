import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { transformWithOxc } from 'vite'
import { hoennStarterChoices } from '../packages/shiny-hunt-start-sequence.mjs'

const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
const start = hub.indexOf('<div className="hunt-binary-options">')
const action = hub.indexOf('<button className="hunt-modal-action"', start)
const end = hub.indexOf('</button>', action) + '</button>'.length
assert.ok(start > 0 && end > action)
const transformed = await transformWithOxc('globalThis.Controls = () => <div>' + hub.slice(start, end) + '</div>', 'hunt-controls.jsx', { jsx: { runtime: 'classic' } })
const context = {
  React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
  Select() {}, HuntStarterPicker() {}, hoennStarterChoices, huntErrorMessages: {}, huntStatus: { phase: 'idle' },
  stopShinyHunt() {}, startShinyHunt() {},
  huntStarterPickerOpen: false,
  setHuntStarterPickerOpen(value) { context.huntStarterPickerOpen = value },
}
vm.runInNewContext(transformed.code, context)

function render(config, running = false) {
  context.huntConfig = config
  context.huntRunning = running
  context.setHuntConfig = update => { context.huntConfig = update(context.huntConfig) }
  const nodes = []
  const visit = element => {
    if (Array.isArray(element)) return element.forEach(visit)
    if (!element?.type) return
    nodes.push(element)
    visit(element.props.children)
  }
  visit(context.Controls())
  return nodes
}

test('the starter method opens a named picker on every click and requires an explicit choice', () => {
  context.huntStarterPickerOpen = false
  let view = render({ resetMode: 'exit-encounter', startMode: 'common', stopMode: 'first-shiny' })
  const methods = view.filter(node => node.props.name === 'hunt-start-mode')
  assert.equal(methods.length, 7)
  assert.equal(view.filter(node => node.type === context.Select).length, 0)
  const starter = methods.find(node => node.props.value === 'hoenn-starter')
  starter.props.onClick()
  starter.props.onChange()
  assert.equal(context.huntConfig.resetMode, 'soft-reset')
  view = render(context.huntConfig)
  const picker = view.find(node => node.type === context.HuntStarterPicker)
  assert.equal(picker.props.selectedPosition, undefined)
  assert.equal(view.filter(node => node.type === context.Select).length, 0)
  assert.equal(view.find(node => node.props.className === 'hunt-modal-action').props.disabled, true)
  assert.equal(view.find(node => node.props.value === 'exit-encounter').props.disabled, true)
  picker.props.onSelect(3)
  assert.equal(context.huntStarterPickerOpen, false)
  view = render(context.huntConfig)
  assert.equal(view.find(node => node.props.className === 'hunt-modal-action').props.disabled, false)
  const label = view.find(node => node.type === 'label' && node.props.children.some(child => child?.props?.value === 'hoenn-starter'))
  assert.ok(label.props.children.includes('Iniciais (Mudkip)'))
  view.find(node => node.props.value === 'hoenn-starter').props.onClick()
  assert.equal(context.huntStarterPickerOpen, true)
  view = render(context.huntConfig)
  const reopened = view.find(node => node.type === context.HuntStarterPicker)
  assert.equal(reopened.props.selectedPosition, 3)
  reopened.props.onClose()
  assert.equal(context.huntStarterPickerOpen, false)
  assert.equal(context.huntConfig.starterPosition, 3)
})

test('Fossil selection uses soft reset and locks battle exit while preserving stop choices', () => {
  let view = render({ resetMode: 'exit-encounter', startMode: 'common', stopMode: 'all-shiny' })
  const fossil = view.find(node => node.props.name === 'hunt-start-mode' && node.props.value === 'fossil')
  assert.ok(fossil)
  fossil.props.onChange()
  assert.equal(context.huntConfig.startMode, 'fossil')
  assert.equal(context.huntConfig.resetMode, 'soft-reset')
  assert.equal(context.huntConfig.stopMode, 'all-shiny')
  view = render(context.huntConfig)
  assert.equal(view.find(node => node.props.value === 'exit-encounter').props.disabled, true)
  assert.equal(view.find(node => node.props.value === 'fossil').props.checked, true)
  assert.equal(view.find(node => node.props.className === 'hunt-modal-action').props.disabled, false)
})

test('a running Hoenn hunt locks settings and keeps Stop available', () => {
  const view = render({ resetMode: 'soft-reset', startMode: 'hoenn-starter', starterPosition: 2, stopMode: 'all-shiny' }, true)
  assert.ok(view.filter(node => node.type === 'fieldset').every(node => node.props.disabled))
  assert.equal(view.filter(node => node.type === context.Select).length, 0)
  const action = view.find(node => node.props.className === 'hunt-modal-action')
  assert.equal(action.props.disabled, false)
  assert.equal(action.props.onClick, context.stopShinyHunt)
})

test('starter choice uses each full Pokémon name and removes the game instructions', () => {
  for (const [starterPosition, name] of [[1, 'Treecko'], [2, 'Torchic'], [3, 'Mudkip']]) {
    const view = render({ resetMode: 'soft-reset', startMode: 'hoenn-starter', starterPosition, stopMode: 'first-shiny' })
    const label = view.find(node => node.type === 'label' && node.props.children.some(child => child?.props?.value === 'hoenn-starter'))
    assert.ok(label.props.children.includes(`Iniciais (${name})`))
  }
  assert.ok(!hub.includes('FireRed/LeafGreen:'))
  assert.ok(!hub.includes('id="hunt-starter-position"'))
})

test('the hub sends the shared choice and a single tap command through the player protocol', () => {
  assert.match(hub, /requestHunt\(session, 'prepare', null, \{ \.\.\.huntConfig \}\)/)
  assert.match(hub, /tap: .*requestHunt\(session, 'tap', cycleId, \{ button \}, 2000\)/)
  assert.match(hub, /getGameCode: session => huntGameCodes\.get\(session\.sessionId\)/)
  assert.match(hub, /huntGameCodes\.set\(session\.sessionId, reply\.gameCode\)/)
})
