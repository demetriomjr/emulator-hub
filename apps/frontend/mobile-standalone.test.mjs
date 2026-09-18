import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const frontend = new URL('./', import.meta.url)

test('declares the Hub as a standalone installable web app', async () => {
  const manifest = JSON.parse(await readFile(new URL('./public/manifest.webmanifest', frontend), 'utf8'))
  const html = await readFile(new URL('./index.html', frontend), 'utf8')

  assert.equal(manifest.name, 'Emulator Hub')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.display, 'standalone')
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/)
})

test('blocks the Hub with rotate guidance until the narrow viewport becomes landscape', async () => {
  const source = await readFile(new URL('./src/main.jsx', frontend), 'utf8')
  const css = await readFile(new URL('./src/styles.css', frontend), 'utf8')

  assert.match(css, /\.mobile-rotate-overlay\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*100;/)
  assert.match(source, /isNarrowPortrait && <div className="mobile-rotate-overlay"/)
  assert.match(source, /window\.addEventListener\('orientationchange', updateViewport\)/)
  assert.match(source, /return \{ width: window\.innerWidth, height: window\.innerHeight \}/)
})

test('offers a visible iPhone install guide instead of relying on a browser prompt', async () => {
  const source = await readFile(new URL('./src/main.jsx', frontend), 'utf8')

  assert.match(source, /className="hub-sidebar-action hub-sidebar-install"/)
  assert.match(source, /Compartilhar.*Adicionar à Tela de Início/s)
})

test('checks the frontend document revision when the installed app returns to view', async () => {
  const source = await readFile(new URL('./src/main.jsx', frontend), 'utf8')

  assert.match(source, /fetch\('\/', \{ method: 'HEAD', cache: 'no-store' \}\)/)
  assert.match(source, /document\.addEventListener\('visibilitychange', checkFrontendRevision\)/)
  assert.match(source, /window\.location\.reload\(\)/)
})
