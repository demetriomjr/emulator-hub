import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('applies the persisted fast-forward request again after the game starts', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  const gameStart = player.slice(player.indexOf('window.EJS_onGameStart = () => {'), player.indexOf('\n  }', player.indexOf('window.EJS_onGameStart = () => {')))

  assert.match(gameStart, /applyFastForward\(\)/)
})
