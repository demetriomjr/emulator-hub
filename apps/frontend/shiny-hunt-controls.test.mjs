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
  Select() {}, hoennStarterChoices, huntErrorMessages: {}, huntStatus: { phase: 'idle' },
  stopShinyHunt() {}, startShinyHunt() {},
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

test('one Hoenn method reveals one shared ball selector and requires an explicit choice', () => {
  let view = render({ resetMode: 'exit-encounter', startMode: 'common', stopMode: 'first-shiny' })
  const methods = view.filter(node => node.props.name === 'hunt-start-mode')
  assert.equal(methods.length, 6)
  assert.equal(view.filter(node => node.type === context.Select).length, 0)
  methods.find(node => node.props.value === 'hoenn-starter').props.onChange()
  assert.equal(context.huntConfig.resetMode, 'soft-reset')
  view = render(context.huntConfig)
  const selector = view.find(node => node.type === context.Select)
  assert.equal(selector.props.id, 'hunt-starter-position')
  assert.deepEqual(selector.props.options.map(option => option.value), [1, 2, 3])
  assert.equal(selector.props.value, undefined)
  assert.equal(view.find(node => node.props.className === 'hunt-modal-action').props.disabled, true)
  assert.equal(view.find(node => node.props.value === 'exit-encounter').props.disabled, true)
  selector.props.onChange(3)
  view = render(context.huntConfig)
  assert.equal(view.find(node => node.type === context.Select).props.value, 3)
  assert.equal(view.find(node => node.props.className === 'hunt-modal-action').props.disabled, false)
})

test('a running Hoenn hunt locks settings and keeps Stop available', () => {
  const view = render({ resetMode: 'soft-reset', startMode: 'hoenn-starter', starterPosition: 2, stopMode: 'all-shiny' }, true)
  assert.ok(view.filter(node => node.type === 'fieldset').every(node => node.props.disabled))
  assert.equal(view.find(node => node.type === context.Select).props.disabled, true)
  const action = view.find(node => node.props.className === 'hunt-modal-action')
  assert.equal(action.props.disabled, false)
  assert.equal(action.props.onClick, context.stopShinyHunt)
})

test('the hub sends the shared choice and a single tap command through the player protocol', () => {
  assert.match(hub, /requestHunt\(session, 'prepare', null, \{ \.\.\.huntConfig \}\)/)
  assert.match(hub, /tap: .*requestHunt\(session, 'tap', cycleId, \{ button \}, 2000\)/)
  assert.match(hub, /getGameCode: session => huntGameCodes\.get\(session\.sessionId\)/)
  assert.match(hub, /huntGameCodes\.set\(session\.sessionId, reply\.gameCode\)/)
})
