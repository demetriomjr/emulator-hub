import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
const source = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
test('player feeds only prepared ROM bytes to EmulatorJS and prevents per-Blob persistence', () => {
  const input = source.match(/window\.EJS_gameUrl = [^\n]+/)[0]
  const captured = [], preparedRom = { bytes: new Uint8Array([4,5]) }, context = { window: {}, preparedRom, Blob, URL: { createObjectURL(blob) { captured.push(blob); return 'blob:prepared' } } }
  runInNewContext(input, context)
  assert.equal(context.window.EJS_gameUrl, 'blob:prepared')
  assert.equal(captured[0].size, 2)
  assert.doesNotMatch(source, /window\.EJS_gamePatchUrl = URL\.createObjectURL/)
  assert.match(source, /window\.EJS_CacheLimit = 0/)
})
test('RNG metadata reflects prepared ROM instead of descriptor patch presence', () => {
  const start = source.indexOf('function rngContext()'), end = source.indexOf('async function observedSoftReset()', start)
  const context = { sessionId: 's', profileId: 'p', emulatorGameId: 'g', launchDescriptor: { patchSha256: 'registered', romSha256: 'original' },
    preparedRom: { patchApplied: false, effectiveRomSha256: 'actual' }, threadDecision: null, fastForwardRequest: {}, oddsClock: {} }
  runInNewContext(source.slice(start, end), context)
  assert.equal(context.rngContext().patchApplied, false)
  assert.equal(context.rngContext().effectiveRomSha256, 'actual')
})
