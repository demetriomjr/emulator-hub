import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

test('save logger keeps material decisions and failures without per-poll success spam', async () => {
  const source = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  const begin = source.indexOf('function logSavePipeline(')
  const end = source.indexOf('function setPlayerLoading(', begin)
  const records = []
  const telemetry = []
  const log = runInNewContext(`${source.slice(begin, end)}\nlogSavePipeline`, {
    id: 'game', profileId: 'profile', emulatorGameId: 'runtime', Date,
    console: { info: (...args) => records.push(['info', ...args]), warn: (...args) => records.push(['warn', ...args]), error: (...args) => records.push(['error', ...args]) },
    snapshotTelemetry: { info: (...args) => telemetry.push(['info', ...args]), warn: (...args) => telemetry.push(['warn', ...args]), error: (...args) => telemetry.push(['error', ...args]) },
  })
  log('save.front.bytes-observed', { sizeBytes: 4 })
  log('save.front.deduplicated', { sizeBytes: 4 })
  log('save.front.runtime-state-ignored', { sizeBytes: 4 })
  log('save.front.upload-accepted', { revision: 3 })
  log('save.front.sync-failed', { code: 'SAVE_REVISION_CONFLICT', error: 'conflict' })
  assert.deepEqual(records.map(([level, , record]) => [level, record.event]), [['info', 'save.front.upload-accepted']])
  assert.deepEqual(telemetry.map(([level, event]) => [level, event]), [['info', 'runtime-state-save-ignored'], ['error', 'save-sync-failed']])
})
