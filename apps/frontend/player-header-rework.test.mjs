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
  assert.match(hub, /dispatchReset\('emulator-hub:soft-reset'\)/)
  assert.match(hub, /aria-label="Manipulador de odds"/)
  const header = hub.slice(hub.indexOf('className="player-global-controls"'), hub.indexOf('className="player-actions"'))
  assert.ok(header.indexOf('fast-forward-control') < header.indexOf('player-header-separator'))
  assert.ok(header.indexOf('player-header-separator') < header.indexOf('aria-label="Configurar controles"'))
})

test('player runtime handles soft reset messages', async () => {
  const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
  assert.match(player, /emulator-hub:soft-reset/)
  assert.match(player, /softResetEmulator\(/)
})

test('player frame uses Ant Design controls in the requested order and groups', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  const css = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8')
  const frame = hub.slice(hub.indexOf('<header className="player-header"'), hub.indexOf('</header>', hub.indexOf('<header className="player-header"')))
  assert.doesNotMatch(frame, /<button\b/)
  assert.match(frame, /<Button\b/)
  assert.match(frame, /<Select\b[^>]*className="player-header-select player-speed-select"[^>]*suffixIcon=\{null\}/)
  assert.equal((frame.match(/className="player-header-select player-trigger-select"/g) ?? []).length, 2)
  assert.ok(frame.indexOf("'Reproduzir todos'") < frame.indexOf('aria-label="Informações do perfil"'))
  assert.ok(frame.indexOf('aria-label="Informações do perfil"') < frame.indexOf('aria-label={muted'))
  const stateControls = frame.slice(frame.indexOf('aria-label="Salvar estado"'), frame.indexOf('aria-label="Hard Reset"'))
  assert.doesNotMatch(stateControls, /player-header-separator/)
  assert.match(frame, /SearchOutlined/)
  assert.match(frame, /className="player-close-button"/)
  assert.match(frame, /className="player-add-button"/)
  assert.match(css, /\.player-trigger-select\s*\{\s*width:\s*126px;/)
})

test('player toolbar switches playback glyph and uses distinct odds and macro icons', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  const header = hub.slice(hub.indexOf('<header className="player-header"'), hub.indexOf('</header>', hub.indexOf('<header className="player-header"')))
  assert.match(header, /icon=\{<PlaybackGlyph paused=\{playerPaused\[activeSessions\[0\]\?\.sessionId\]\} className="player-play-pause-glyph"\s*\/>\}/)
  assert.doesNotMatch(header, /PlayCircleOutlined|PauseCircleOutlined|BarChartOutlined|UnorderedListOutlined/)
  assert.match(header, /icon=\{<NumberOutlined\s*\/>\} aria-label="Manipulador de odds"/)
  assert.match(header, /icon=\{<ThunderboltOutlined\s*\/>\} aria-label=\{macroRunState/)
})
