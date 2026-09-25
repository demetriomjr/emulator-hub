import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')

test('add-player picker remembers the last selected title only while the player session is open', () => {
  const open = hub.slice(hub.indexOf('  function openInstancePicker()'), hub.indexOf('  async function openControlPanel()'))
  const choose = hub.slice(hub.indexOf('  function chooseInstanceGame('), hub.indexOf('  function broadcastPlayerMessage('))
  const reset = hub.match(/\s{2}useEffect\(\(\) => \{\s*if \(activeSessions\.length === 0\) lastInstanceGameIdRef\.current = null\s*\}, \[activeSessions\.length\]\)/)?.[0]
  assert.ok(open.includes('function openInstancePicker'))
  assert.ok(choose.includes('function chooseInstanceGame'))
  assert.ok(reset)

  const games = [{ id: 'first', status: 'ready' }, { id: 'second', status: 'ready' }]
  const opened = []
  const effects = []
  const context = {
    activeSessions: [{}],
    gameSections: [{ games }],
    lastInstanceGameIdRef: { current: null },
    isMobileLandscape: false,
    MAX_PLAYER_INSTANCES: 6,
    setError() {},
    setInstancePicker() {},
    openProfilePicker(game) { opened.push(game.id) },
    useEffect(effect) { effects.push(effect) },
  }
  const picker = runInNewContext(`${open}\n${choose}\n${reset};\n({ openInstancePicker, chooseInstanceGame })`, context)

  picker.openInstancePicker()
  picker.chooseInstanceGame(games[1])
  picker.openInstancePicker()
  assert.deepEqual(opened, ['first', 'second', 'second'])

  games[1].status = 'unavailable'
  picker.openInstancePicker()
  assert.equal(opened.at(-1), 'first')
  games[1].status = 'ready'

  context.activeSessions = []
  effects[0]()
  context.activeSessions = [{}]
  picker.openInstancePicker()
  assert.equal(opened.at(-1), 'first')
})

test('add-player picker has an explicit Fechar control', () => {
  assert.match(hub, /profilePurpose === 'add-instance' \? 'Fechar' : '×'/)
})
