import assert from 'node:assert/strict'
import test from 'node:test'
import { createCloudSaveSynchronizer } from './cloud-save-sync.mjs'
import { startEmulatorWithMemorySaves } from './emulator-save-filesystem.mjs'

function runtime() {
  const browserSave = new Uint8Array([9, 8, 7])
  let browserReads = 0
  let browserWrites = 0
  class GameManager {
    constructor() {
      let files = new Map()
      let persistent = false
      this.FS = {
        filesystems: { IDBFS: 'persistent', MEMFS: 'memory' },
        mount(type) { persistent = type === 'persistent'; files = new Map() },
        syncfs(read, done) {
          if (persistent && read) { browserReads++; files.set('/data/saves/Ruby.srm', browserSave) }
          if (persistent && !read) browserWrites++
          done()
        },
        writeFile(path, bytes) { files.set(path, new Uint8Array(bytes)); if (persistent) browserWrites++ },
      }
      this.mkdir = () => {}
      this.getSaveFilePath = () => '/data/saves/Ruby.srm'
      this.getSaveFile = () => files.get(this.getSaveFilePath()) ?? null
      this.loadSaveFiles = () => {}
    }
    async mountFileSystems() {
      this.mkdir('/data')
      this.mkdir('/data/saves')
      this.FS.mount(this.FS.filesystems.IDBFS, { autoPersist: true }, '/data/saves')
      await new Promise(resolve => this.FS.syncfs(true, resolve))
    }
  }
  const button = { remove() {} }
  const emulator = {
    game: { querySelector: () => null },
    elements: { parent: { querySelector: () => button } },
    startButtonClicked(selected) {
      assert.equal(selected, button)
      selected.remove()
      this.gameManager = new GameManager()
      return this.gameManager.mountFileSystems()
    },
  }
  return { emulator, GameManager, browserSave, get browserReads() { return browserReads }, get browserWrites() { return browserWrites } }
}

function synchronizer(save = null) {
  const uploads = []
  const sync = createCloudSaveSynchronizer({
    load: async () => save,
    hash: async bytes => [...bytes].join(','),
    upload: async (bytes, revision) => { uploads.push({ bytes: [...bytes], revision }); return { revision: (revision ?? 0) + 1 } },
  })
  return { sync, uploads }
}

test('a profile without a backend save never reads or uploads another profile browser save', async () => {
  const old = runtime()
  await old.emulator.startButtonClicked(old.emulator.elements.parent.querySelector())
  assert.deepEqual([...old.emulator.gameManager.getSaveFile()], [9, 8, 7])

  const current = runtime()
  await startEmulatorWithMemorySaves(current)
  const { sync, uploads } = synchronizer()
  await sync.load()
  assert.equal(await sync.restore(current.emulator.gameManager), false)
  assert.equal(current.emulator.gameManager.getSaveFile(), null)
  assert.equal(await sync.sync(current.emulator.gameManager), false)
  assert.equal(current.browserReads, 0)
  assert.equal(current.browserWrites, 0)
  assert.deepEqual(uploads, [])
  assert.deepEqual([...current.browserSave], [9, 8, 7])
})

test('backend saves load into memory and later in-game saves synchronize only to the backend', async () => {
  const current = runtime()
  await startEmulatorWithMemorySaves(current)
  const { sync, uploads } = synchronizer({ bytes: new Uint8Array([1, 2, 3]), revision: 4 })
  await sync.load()
  assert.equal(await sync.restore(current.emulator.gameManager), true)
  assert.deepEqual([...current.emulator.gameManager.getSaveFile()], [1, 2, 3])
  assert.equal(await sync.sync(current.emulator.gameManager), false)
  current.emulator.gameManager.FS.writeFile('/data/saves/Ruby.srm', new Uint8Array([4, 5, 6]))
  assert.equal(await sync.sync(current.emulator.gameManager), true)
  assert.deepEqual(uploads, [{ bytes: [4, 5, 6], revision: 4 }])
  assert.equal(current.browserReads, 0)
  assert.equal(current.browserWrites, 0)
})

test('same-game instances keep separate saves even with identical filenames', async () => {
  const current = runtime()
  await startEmulatorWithMemorySaves(current)
  current.emulator.gameManager.FS.writeFile('/data/saves/Ruby.srm', new Uint8Array([1]))
  const second = new current.GameManager()
  await second.mountFileSystems()
  assert.equal(second.getSaveFile(), null)
  second.FS.writeFile('/data/saves/Ruby.srm', new Uint8Array([2]))
  assert.deepEqual([...current.emulator.gameManager.getSaveFile()], [1])
})

test('installation rejects a runtime whose core has already started', () => {
  const current = runtime()
  current.emulator.gameManager = new current.GameManager()
  assert.throws(() => startEmulatorWithMemorySaves(current), /before.*start/i)
  assert.equal(current.browserReads, 0)
})

test('an incompatible runtime cannot fall back to persistent saves', async () => {
  const current = runtime()
  const errors = []
  const OriginalManager = current.GameManager
  current.GameManager = class extends OriginalManager {
    constructor() { super(); delete this.FS.filesystems.MEMFS }
  }
  current.emulator.startButtonClicked = function () {
    this.gameManager = new current.GameManager()
    return this.gameManager.mountFileSystems()
  }
  await assert.rejects(startEmulatorWithMemorySaves({ ...current, onError: error => errors.push(error) }), /memory.*save/i)
  assert.equal(errors.length, 1)
  assert.equal(current.browserReads, 0)
})
