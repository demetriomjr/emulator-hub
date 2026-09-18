import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceFile = new URL('./main.jsx', import.meta.url)
const stylesheet = new URL('./styles.css', import.meta.url)

test('renders every occupied slot through one pointer-transparent local sprite component', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.match(source, /import \{ getPokemonSlotSprite, hidePokemonSlotSprite \} from '\.\.\/\.\.\/packages\/pokemon-slot-sprite\.mjs'/)
  assert.match(source, /function PokemonSlotSprite\(\{ slot \}\)/)
  assert.match(source, /src=\{sprite\}/)
  assert.match(source, /draggable=\{false\}/)
  assert.match(source, /onError=\{event => hidePokemonSlotSprite\(event\.currentTarget\)\}/)
  assert.equal((source.match(/<PokemonSlotSprite slot=/g) ?? []).length, 4)
})

test('uses an absolute contained sprite plane that cannot intercept slot input', async () => {
  const css = await readFile(stylesheet, 'utf8')

  assert.match(css, /\.pokemon-hub-slot-sprite\s*\{[^}]*position:\s*absolute;/)
  assert.match(css, /\.pokemon-hub-slot-sprite\s*\{[^}]*inset:\s*8px;/)
  assert.match(css, /\.pokemon-hub-slot-sprite\s*\{[^}]*object-fit:\s*contain;/)
  assert.match(css, /\.pokemon-hub-slot-sprite\s*\{[^}]*pointer-events:\s*none;/)
  assert.match(css, /\.pokemon-hub-slot-index\s*\{[^}]*z-index:\s*2;/)
  assert.match(css, /\.pokemon-hub-slot-index\s*\{[^}]*left:\s*-1px;/)
  assert.match(css, /\.pokemon-hub-slot-content\s*\{[^}]*position:\s*absolute;/)
  assert.match(css, /\.pokemon-hub-slot-content\s*\{[^}]*top:\s*4px;/)
  assert.match(css, /\.pokemon-hub-slot-content\s*\{[^}]*right:\s*4px;/)
  assert.match(css, /\.pokemon-hub-slot-content\s*\{[^}]*z-index:\s*2;/)
})

test('prevents text selection across the Hub workspace, modals, and selector popups', async () => {
  const [source, css] = await Promise.all([readFile(sourceFile, 'utf8'), readFile(stylesheet, 'utf8')])

  assert.match(css, /\.pokemon-workspace\s*,\s*\.pokemon-workspace \*\s*,\s*\.pokemon-hub-profile-modal-container\s*,\s*\.pokemon-hub-profile-modal-container \*\s*,\s*\.pokemon-hub-select-popup\s*,\s*\.pokemon-hub-select-popup \*\s*\{[^}]*user-select:\s*none;/)
  assert.match(css, /\.pokemon-workspace[\s\S]*-webkit-user-select:\s*none;/)
  assert.equal((source.match(/pokemon-hub-select-popup/g) ?? []).length, 3)
})

test('moves only Party sprites above the fixed status strip', async () => {
  const css = await readFile(stylesheet, 'utf8')

  assert.match(css, /\.pokemon-save-party\s+\.pokemon-hub-slot-sprite\s*\{[^}]*transform:\s*translateY\(-6px\);/)
})

test('uses one DnD provider with a six-pixel pointer threshold and a session snapshot drag flow', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.match(source, /from '@dnd-kit\/react'/)
  assert.match(source, /import \{ PointerActivationConstraints, PointerSensor \} from '@dnd-kit\/dom'/)
  assert.match(source, /PointerActivationConstraints\.Distance\(\{\s*value:\s*6\s*\}\)/)
  assert.match(source, /function PokemonHubDragSlot\(/)
  assert.match(source, /function PokemonHubDragOverlay\(/)
  assert.match(source, /<DragDropProvider/)
  assert.match(source, /async function persistPokemonHubSessionMove\(source, target\)/)
  assert.match(source, /schedulePokemonHubSnapshot\(\)/)
})

test('persists cross-kind drops through one compact session snapshot', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.match(source, /function completePokemonHubDrag\(event\)/)
  assert.match(source, /onDragEnd=\{completePokemonHubDrag\}/)
  assert.match(source, /applyLocalSessionMove\(sourceSnapshot, targetSnapshot, fromSlot, toSlot, pokemonInstanceId\)/)
  assert.match(source, /await syncPokemonHubSessionSnapshot\(session\.profileId, session\.sessionId, session\.pendingSnapshot\)/)
  assert.match(source, /applyCompactSessionSnapshot\(response\.snapshot, response\.pokemonDisplay\)/)
})

test('keeps display metadata with the instance during an optimistic cross-source move', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.match(source, /const movedPokemonDisplay = sourceSnapshot\.pokemonDisplay\?\.\[pokemonInstanceId\]/)
  assert.match(source, /\? \{ \.\.\.snapshot\.pokemonDisplay, \[pokemonInstanceId\]: movedPokemonDisplay \}/)
})

test('orders compact session sources and ends the local session after a terminal snapshot error', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.match(source, /Object\.values\(snapshots\)\.sort\(\(left, right\) => left\.sourceId\.localeCompare\(right\.sourceId\)\)/)
  assert.match(source, /session\.pendingSnapshot = null/)
  assert.match(source, /endPokemonHubSessionLocally\(cause\)/)
})

test('styles read-only drag targets and the pointer-transparent overlay', async () => {
  const css = await readFile(stylesheet, 'utf8')

  assert.match(css, /\.pokemon-hub-slot\.drag-over\s*\{[^}]*outline:/)
  assert.match(css, /\.pokemon-hub-drag-overlay\s*\{[^}]*position:\s*fixed;/)
  assert.match(css, /\.pokemon-hub-drag-overlay\s*\{[^}]*pointer-events:\s*none;/)
})

test('renders only the transparent Pokémon sprite in the drag preview', async () => {
  const [source, css] = await Promise.all([readFile(sourceFile, 'utf8'), readFile(stylesheet, 'utf8')])

  assert.match(source, /pokemon-hub-drag-preview">\s*<PokemonSlotSprite slot=\{slot\} \/>\s*<\/div>/)
  assert.match(css, /\.pokemon-hub-drag-preview\s*\{[^}]*background:\s*transparent;/)
  assert.doesNotMatch(css, /\.pokemon-hub-drag-preview\s*\{[^}]*border:/)
  assert.doesNotMatch(css, /\.pokemon-hub-drag-preview\s*\{[^}]*box-shadow:/)
})
