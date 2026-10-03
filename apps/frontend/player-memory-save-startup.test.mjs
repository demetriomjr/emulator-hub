import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { startEmulatorWithMemorySaves } from '../packages/emulator-save-filesystem.mjs'

const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')

test('EmulatorJS cannot auto-start before the memory-only save adapter is installed', () => {
  const setting = player.match(/window\.EJS_startOnLoaded = [^\n]+/)
  assert.ok(setting)
  const browser = {}
  runInNewContext(setting[0], { window: browser })
  let earlySaveReads = 0
  // Upstream starts the core immediately when this setting is true, before ready.
  if (browser.EJS_startOnLoaded) earlySaveReads++
  assert.equal(earlySaveReads, 0)
})

function readiness({ closed = false, incompatible = false } = {}) {
  const actions = []
  const start = player.indexOf('  window.EJS_ready = () => {')
  const end = player.indexOf('  window.EJS_onGameStart = async () => {', start)
  assert.ok(start > 0 && end > start)
  class GameManager {
    constructor() {
      this.mkdir = () => {}
      this.FS = { filesystems: { MEMFS: 'memory' }, mount(type) { actions.push(`save-storage:${type}`) } }
    }
    mountFileSystems() { throw new Error('Persistent save storage must never run') }
  }
  let mounted
  const emulator = {
    game: { querySelector: () => null },
    elements: { parent: { querySelector: () => ({ remove() {} }) } },
    startButtonClicked() {
      actions.push('start-core')
      this.gameManager = new GameManager()
      mounted = this.gameManager.mountFileSystems()
    },
  }
  const context = {
    window: { EJS_emulator: emulator, EJS_GameManager: incompatible ? null : GameManager },
    startEmulatorWithMemorySaves, closeRequested: closed, threadFallbackRequested: false, leaseLost: false,
    configureEmulatorNotifications() {}, interactionLock: { apply() {} }, stopLifecycleDiagnostics: null,
    audioMute: { attach() {}, apply() {} }, isMobilePlayerViewport: false, clientDiagnostics: null,
    applyFastForward() {}, snapshotTelemetry: { error() { actions.push('startup-error') } },
    loseLease() { actions.push('lease-lost') }, game: {},
  }
  runInNewContext(player.slice(start, end), context)
  return { actions, async ready() { context.window.EJS_ready(); await mounted } }
}

test('player readiness starts the core through the memory-only save adapter', async () => {
  const current = readiness()
  await current.ready()
  assert.deepEqual(current.actions, ['start-core', 'save-storage:memory'])
})

test('closing before readiness prevents the core from starting', async () => {
  const current = readiness({ closed: true })
  await current.ready()
  assert.deepEqual(current.actions, [])
})

test('an incompatible runtime reports startup failure and releases the player', async () => {
  const current = readiness({ incompatible: true })
  await current.ready()
  assert.deepEqual(current.actions, ['startup-error', 'lease-lost'])
})
