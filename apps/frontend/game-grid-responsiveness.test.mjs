import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('keeps five game cards in each narrow mobile row', async () => {
  const css = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8')
  const narrowViewportRules = css.slice(css.indexOf('@media (max-width: 680px)'))

  assert.match(narrowViewportRules, /\.hub-section-games \.boxes\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\);/)
})

test('keeps Pokémon Hub and game cards on the same five-column iPhone 12 Pro landscape grid', async () => {
  const css = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8')
  const landscapeRules = css.slice(css.indexOf('@media (max-width: 900px) and (max-height: 500px) and (orientation: landscape)'))

  assert.match(landscapeRules, /\.hub-section-internal \.boxes, \.hub-section-games \.boxes\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\);/s)
})

test('fits the five-card iPhone landscape catalog vertically without desktop spacing', async () => {
  const css = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8')
  const landscapeRules = css.slice(css.indexOf('@media (max-width: 900px) and (max-height: 500px) and (orientation: landscape)'))

  assert.match(landscapeRules, /\.hub-content\s*\{[^}]*min-height:\s*100dvh;[^}]*align-content:\s*center;[^}]*padding:\s*12px\s+0;[^}]*\}/s)
  assert.match(landscapeRules, /\.hub-section \+ \.hub-section\s*\{[^}]*margin-top:\s*12px;/s)
})
