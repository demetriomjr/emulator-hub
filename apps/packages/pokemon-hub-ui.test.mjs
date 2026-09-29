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

test('queues pane loads while blocking only the pane being loaded', async () => {
  const packageSource = await readFile(packageFile, 'utf8')
  const stylesheet = await readFile(new URL('../frontend/src/styles.css', import.meta.url), 'utf8')

  assert.match(packageSource, /pokemonHubPaneQueueRef/)
  assert.match(packageSource, /pokemonHubPendingPanes/)
  assert.match(packageSource, /loading=\{Boolean\(pokemonHubPendingPanes\[index\]\)\}/)
  assert.match(packageSource, /className="pokemon-workspace-pane-stale"/)
  assert.match(stylesheet, /\.pokemon-workspace-pane-stale\s*\{[^}]*inset:\s*0/)
})

test('loads a selected pane through the server-owned pane command', async () => {
  const packageSource = await readFile(packageFile, 'utf8')

  assert.match(packageSource, /loadPokemonHubSessionPane/)
  assert.match(packageSource, /session\.requestGate\.run\(\(\) => loadPokemonHubSessionPane\(session\.profileId, session\.sessionId, pane, incomingSource, signal\)\)/)
  assert.match(packageSource, /if \(incomingSource\) \{[\s\S]*loadPokemonHubSessionPane/)
})

test('fetches a Hub profile grid only when that profile is selected', async () => {
  const packageSource = await readFile(packageFile, 'utf8')
  assert.match(packageSource, /getPokemonHubProfile\(incomingSource\.hubProfileId, signal\)/)
  assert.match(packageSource, /setPokemonDetailsById\(current => \(\{ \.\.\.current, \.\.\.loadedHubProfile\.pokemonDetailsById \}\)\)/)
  assert.doesNotMatch(packageSource, /setPokemonDetailsById\(current => \(\{ \.\.\.current, \.\.\.response\.pokemonDetailsById \}\)\)/)
})

test('uses shared drag feedback for disabled sprites and blocked destination overlays', async () => {
  const packageSource = await readFile(packageFile, 'utf8')

  assert.match(packageSource, /getPokemonHubDragFeedback/)
  assert.match(packageSource, /dragDisabled=\{permission\.dragDisabled\}/)
  assert.match(packageSource, /pokemon-hub-transfer-block-overlay/)
})

test('switches pane content between Pokémon and the save item inventory', async () => {
  const source = await readFile(packageFile, 'utf8')
  const stylesheet = await readFile(new URL('../frontend/src/styles.css', import.meta.url), 'utf8')

  assert.match(source, /aria-pressed=\{activeTab === 'pokemon'\}/)
  assert.match(source, /aria-pressed=\{activeTab === 'items'\}/)
  assert.match(source, /activeTab === 'items'[\s\S]*saveLayout\.itemInventory/)
  assert.match(source, /areaView\.slots\.map\(/)
  assert.match(source, /getPokemonItemPolicy\(inventory\.title, areaId, slot\.itemKey\)/)
  assert.match(source, /policy\?\.showQuantity !== false/)
  assert.match(source, /getPreviousSaveBoxIndex\(areaView\.index, areaView\.areaIds\.length\)/)
  assert.match(source, /getNextSaveBoxIndex\(areaView\.index, areaView\.areaIds\.length\)/)
  assert.match(stylesheet, /\.pokemon-pane-tab\.is-active[^{}]*\{[^}]*background:/)
})

test('keeps compact content tabs aligned with the slot grid in save and Hub panes', async () => {
  const source = await readFile(packageFile, 'utf8')
  const stylesheet = await readFile(new URL('../frontend/src/styles.css', import.meta.url), 'utf8')

  assert.match(stylesheet, /\.pokemon-pane-tabs\s*\{[^}]*width:\s*min\(100%,\s*var\(--pokemon-save-box-row-width\)\)/)
  assert.match(stylesheet, /\.pokemon-pane-tab\s*\{[^}]*min-height:\s*34px/)
  assert.match(source, /<PokemonPaneTabs[^>]*width=\{cardRowWidth\}/)
})

test('shares the Pokémon slot frame with items and keeps item names inside it', async () => {
  const source = await readFile(packageFile, 'utf8')
  const stylesheet = await readFile(new URL('../frontend/src/styles.css', import.meta.url), 'utf8')

  assert.match(source, /function PokemonHubSlotFrame\(/)
  assert.ok([...source.matchAll(/<PokemonHubSlotFrame\b/g)].length >= 4)
  assert.match(source, /footer=\{occupied \? name : null\}/)
  assert.doesNotMatch(source, /pokemon-item-index|pokemon-item-square/)
  assert.match(stylesheet, /\.pokemon-item-area-nav\s*\{[^}]*height:\s*38px/)
})

test('keeps the item navigator minimal and gives sprites room below a compact item label', async () => {
  const source = await readFile(packageFile, 'utf8')
  const stylesheet = await readFile(new URL('../frontend/src/styles.css', import.meta.url), 'utf8')

  assert.match(source, /<h4>\{areaView\.label\}<\/h4>/)
  assert.doesNotMatch(source, /areaView\.freeSlots|livres de/)
  assert.match(stylesheet, /\.pokemon-item-quantity\s*\{[^}]*top:\s*-1px;[^}]*right:\s*-1px;[^}]*border-radius:\s*0 5px 0 7px/)
  assert.match(stylesheet, /\.pokemon-item-slot \.pokemon-slot-footer\s*\{[^}]*height:\s*19px;[^}]*font-size:\s*11\.5px/)
  assert.match(stylesheet, /\.pokemon-item-slot \.pokemon-slot-footer > span\s*\{[^}]*white-space:\s*nowrap/)
  assert.match(source, /<PokemonItemSprite itemKey=\{slot\.itemKey\}\s*\/>/)
})

test('routes item drops separately from Pokémon moves and enables empty transferable pockets as targets', async () => {
  const source = await readFile(packageFile, 'utf8')
  const stylesheet = await readFile(new URL('../frontend/src/styles.css', import.meta.url), 'utf8')

  assert.match(source, /source\?\.kind === 'item' && target\?\.kind === 'item'/)
  assert.match(source, /await persistPokemonItemReorder\(source, target\)/)
  assert.match(source, /getPokemonItemReorderIntent\(source, target, inventory\)/)
  assert.match(source, /reorderPokemonSaveItems\(session\.profileId, session\.sessionId/)
  assert.match(source, /layout: \{ \.\.\.snapshot\.layout, itemInventory: result\.itemInventory \}/)
  assert.match(source, /droppable = reorderable \|\| areaId === 'tm-hm' \|\| areaId === 'berries'/)
  assert.match(source, /droppable \? <PokemonItemDragSlot/)
  assert.match(source, /disabled: !canDrag/)
  assert.match(stylesheet, /\.pokemon-item-slot\.drag-over\s*\{[^}]*outline:/)
})

test('switches a destination save to the dragged item area and confirms a bounded cross-save transfer', async () => {
  const source = await readFile(packageFile, 'utf8')
  assert.match(source, /activeDrag\?\.location\?\.kind === 'item'/)
  assert.match(source, /setItemAreaId\(activeDrag\.location\.area\)/)
  assert.match(source, /getPokemonItemTransferIntent\(source, target,/)
  assert.match(source, /transferPokemonSaveItems\(session\.profileId, session\.sessionId/)
  assert.match(source, /sourceItemInventory/)
  assert.match(source, /destinationItemInventory/)
  assert.match(source, /role="dialog" aria-label=\{`Transferir/)
})
