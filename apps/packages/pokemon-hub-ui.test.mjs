import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageFile = new URL('./pokemon-hub-ui.jsx', import.meta.url)
const frontendFile = new URL('../frontend/src/main.jsx', import.meta.url)

test('Pokemon Hub is a self-contained lazy UI package', async () => {
  const [packageSource, frontendSource] = await Promise.all([
    readFile(packageFile, 'utf8'),
    readFile(frontendFile, 'utf8'),
  ])

  assert.match(packageSource, /export default function PokemonHub\(/)
  assert.match(packageSource, /from '@dnd-kit\/react'/)
  assert.match(packageSource, /createPokemonHubSnapshotFlight/)
  assert.match(packageSource, /function PokemonHubPane\(/)
  assert.doesNotMatch(packageSource, /Box do jogo/)
  assert.match(frontendSource, /React\.lazy\(\(\) => import\('\.\.\/\.\.\/packages\/pokemon-hub-ui\.jsx'\)\)/)
  assert.doesNotMatch(frontendSource, /from '@dnd-kit\//)
})

test('choosing a source type leaves save and Hub profile selection explicit', async () => {
  const packageSource = await readFile(packageFile, 'utf8')

  assert.doesNotMatch(packageSource, /firstAvailableSaveSource/)
  assert.doesNotMatch(packageSource, /firstAvailableHubSource/)
  assert.match(packageSource, /onClick=\{\(\) => setSelectionDraft\(\{ kind: 'game' \}\)\}/)
  assert.match(packageSource, /onClick=\{\(\) => setSelectionDraft\(\{ kind: 'hub' \}\)\}/)
})

test('serializes structural source changes before constructing another workspace snapshot', async () => {
  const packageSource = await readFile(packageFile, 'utf8')

  assert.match(packageSource, /const pokemonHubBusyRef = useRef\(false\)/)
  assert.match(packageSource, /if \(pokemonHubBusyRef\.current\) return false/)
  assert.match(packageSource, /if \(pokemonHubBusyRef\.current\) return/)
  assert.match(packageSource, /choosePaneSource\(pokemonHubPanesRef\.current, index, source \|\| null\)/)
  assert.match(packageSource, /saveSourceKey\(pane\.profile\.gameId, pane\.profile\.profileId\)/)
})

test('loads a selected pane through the server-owned pane command', async () => {
  const packageSource = await readFile(packageFile, 'utf8')

  assert.match(packageSource, /loadPokemonHubSessionPane/)
  assert.match(packageSource, /session\.requestGate\.run\(\(\) => loadPokemonHubSessionPane\(session\.profileId, session\.sessionId, pane, incomingSource\)\)/)
  assert.match(packageSource, /if \(incomingSource\) \{[\s\S]*loadPokemonHubSessionPane/)
})

test('uses shared drag feedback for disabled sprites and blocked destination overlays', async () => {
  const packageSource = await readFile(packageFile, 'utf8')

  assert.match(packageSource, /getPokemonHubDragFeedback/)
  assert.match(packageSource, /dragDisabled=\{permission\.dragDisabled\}/)
  assert.match(packageSource, /pokemon-hub-transfer-block-overlay/)
})
