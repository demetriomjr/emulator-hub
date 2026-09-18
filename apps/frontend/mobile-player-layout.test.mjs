import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('uses a full-screen mobile player viewport with side controls', async () => {
  const css = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8')
  const mobileRules = css.slice(css.indexOf('@media (max-width: 900px) and (max-height: 500px) and (orientation: landscape)'))

  assert.match(mobileRules, /\.player-shell\s*\{[^}]*width:\s*100vw\s*!important;[^}]*height:\s*100dvh\s*!important;[^}]*grid-template-columns:\s*80px\s+minmax\(0,\s*1fr\);/)
  assert.match(mobileRules, /\.player-header\s*\{[^}]*grid-column:\s*1;[^}]*flex-direction:\s*column;/)
  assert.match(mobileRules, /\.player-panel\s*\{[^}]*grid-column:\s*2;[^}]*align-self:\s*stretch;[^}]*justify-self:\s*stretch;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*aspect-ratio:\s*auto;/)
  assert.match(mobileRules, /\.player-global-controls, \.player-actions, \.fast-forward-control\s*\{[^}]*flex-direction:\s*column;/)
  assert.match(mobileRules, /\.player-header\s*\{[^}]*border-right:\s*0;[^}]*background:\s*transparent;[^}]*overflow:\s*hidden;/)
  assert.match(mobileRules, /\.player-shell\s*\{[^}]*--mobile-player-control-height:\s*min\(42px,\s*calc\(\(100dvh\s*-\s*72px\)\s*\/\s*9\)\);/)
  assert.match(mobileRules, /\.player-control-button, \.player-actions button, \.fast-forward-button, \.global-reset-button\s*\{[^}]*width:\s*64px;[^}]*height:\s*var\(--mobile-player-control-height\);/)
  assert.match(mobileRules, /\.fast-forward-control select\s*\{[^}]*width:\s*64px;[^}]*height:\s*var\(--mobile-player-control-height\);[^}]*appearance:\s*none;[^}]*-webkit-appearance:\s*none;[^}]*text-align:\s*center;[^}]*text-align-last:\s*center;/)
  assert.match(mobileRules, /\.hub-sidebar \.hub-sidebar-action\[aria-label='Configurar controles'\], \.player-header \.player-control-button\[aria-label='Configurar controles'\]\s*\{[^}]*display:\s*none;/)
})
