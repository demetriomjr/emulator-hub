import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const frontend = new URL('./', import.meta.url)

test('uses each catalog card itself as the Pokémon Hub or game action', async () => {
  const source = await readFile(new URL('./src/main.jsx', frontend), 'utf8')
  const css = await readFile(new URL('./src/styles.css', frontend), 'utf8')

  assert.match(source, /<button className="box pokemon-hub-card" type="button" aria-label="Abrir Pokémon Hub" onClick=\{\(\) => setPokemonHubOpen\(true\)\}>/)
  assert.match(source, /<button\s+className="box"\s+key=\{game\.id\}\s+type="button"\s+aria-label=\{`Iniciar \$\{game\.title\}`\}\s+disabled=\{game\.status !== 'ready'\}\s+onClick=\{event => \{/s)
  assert.doesNotMatch(source, /className="play-button"|className="hub-button"/)
  assert.match(css, /\.box:focus-visible\s*\{[^}]*outline:\s*3px solid #ddffe9;/)
  assert.match(css, /\.box:disabled\s*\{[^}]*cursor:\s*not-allowed;/)
})
