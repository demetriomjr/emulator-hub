import assert from 'node:assert/strict'
import test from 'node:test'
import { configureEmulatorNotifications } from './emulator-notifications.mjs'

const configPath = '/home/web_user/.config/retroarch/retroarch.cfg'

function runtime(config) {
  const events = new Map()
  const writes = []
  const fs = {
    readFile(path, options) {
      assert.equal(path, configPath)
      assert.equal(options.encoding, 'utf8')
      return config
    },
    writeFile(path, contents) {
      assert.equal(path, configPath)
      assert.equal(typeof contents, 'string', 'Emscripten rejects ArrayBuffer writes')
      writes.push(contents)
      config = contents
    },
  }
  return { emulator: { on: (event, callback) => events.set(event, callback) }, prepare: () => events.get('saveDatabaseLoaded')?.(fs), writes }
}

test('configures the canvas notification after FS preparation and preserves save/core settings', () => {
  const generated = 'savefile_directory = "/data/saves"\nvideo_vsync = true\ncore_specific_option = "keep"\n'
  const { emulator, prepare, writes } = runtime(generated)
  configureEmulatorNotifications(emulator)
  assert.equal(writes.length, 0, 'FS is not ready at EJS_ready')
  prepare()
  assert.equal(writes.length, 1)
  assert.ok(writes[0].startsWith(generated))
  assert.match(writes[0], /^notification_show_fast_forward = false$/m)
})

test('replaces existing notification settings without leaving conflicting duplicates', () => {
  const { emulator, prepare, writes } = runtime('notification_show_fast_forward = "true"\nvideo_font_enable = true\n notification_show_fast_forward = true')
  configureEmulatorNotifications(emulator)
  prepare()
  prepare()
  assert.equal(writes.length, 2)
  assert.equal(writes[0], writes[1])
  assert.equal(writes[0].match(/^notification_show_fast_forward = false$/gm)?.length, 1)
  assert.match(writes[0], /^video_font_enable = true$/m)
  assert.doesNotMatch(writes[0], /notification_show_fast_forward = "?true/)
})

test('logs a configuration failure without interrupting game startup', () => {
  let callback
  const warnings = []
  const error = new Error('FS unavailable')
  configureEmulatorNotifications({ on: (_, handler) => { callback = handler } }, { warn: (...args) => warnings.push(args) })
  assert.equal(typeof callback, 'function')
  assert.doesNotThrow(() => callback({ readFile() { throw error } }))
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0][1], error)
})
