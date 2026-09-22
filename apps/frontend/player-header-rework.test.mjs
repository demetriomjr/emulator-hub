import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('player header exposes ordered reset controls and help text', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  const soft = hub.indexOf('aria-label="Soft Reset"')
  const hard = hub.indexOf('aria-label="Hard Reset"')
  assert.ok(soft >= 0 && hard > soft)
  assert.match(hub, /title="Soft Reset"/)
  assert.match(hub, /title="Hard Reset"/)
  assert.match(hub, /title="Salvar estado"/)
  assert.match(hub, /title="Carregar estado"/)
  assert.match(hub, /title="Adicionar instância"/)
  assert.match(hub, /title=\{fullscreen \? 'Sair da tela cheia' : 'Tela cheia'\}/)
  assert.match(hub, /title="Fechar emulador"/)
  assert.match(hub, /broadcastPlayerMessage\('emulator-hub:soft-reset'\)/)
  const header = hub.slice(hub.indexOf('className="player-global-controls"'), hub.indexOf('className="player-actions"'))
  assert.ok(header.indexOf('fast-forward-control') < header.indexOf('player-header-separator'))
  assert.ok(header.indexOf('player-header-separator') < header.indexOf('aria-label="Configurar controles"'))
})

test('player runtime handles soft reset messages', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  assert.match(player, /emulator-hub:soft-reset/)
  assert.match(player, /softResetEmulator\(/)
})
