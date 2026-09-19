import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceFile = new URL('../../packages/pokemon-hub-ui.jsx', import.meta.url)
const stylesheet = new URL('./styles.css', import.meta.url)

test('renders every occupied slot through one pointer-transparent local sprite component', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.match(source, /import \{ getPokemonSlotSprite, hidePokemonSlotSprite \} from '\.\/pokemon-slot-sprite\.mjs'/)
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

test('persists cross-kind drops through one canonical session snapshot', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.match(source, /function completePokemonHubDrag\(event\)/)
  assert.match(source, /onDragEnd=\{completePokemonHubDrag\}/)
  assert.match(source, /applyLocalSessionMove\(sourceSnapshot, targetSnapshot, fromSlot, toSlot, pokemonInstanceId\)/)
  assert.match(source, /createCanonicalPokemonHubSnapshot\(session, pokemonHubPanesRef\.current, pokemonHubSnapshotsRef\.current\)/)
  assert.match(source, /send: request => session\.requestGate\.run\(\(\) => syncPokemonHubSessionSnapshot\(session\.profileId, session\.sessionId, request\.snapshot, request\.idempotencyKey\)\)/)
  assert.match(source, /onCorrection: snapshot =>/)
})

test('opens a Hub profile through the canonical snapshot without the legacy attach route', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.doesNotMatch(source, /attachPokemonHubSessionSource/)
  assert.match(source, /sourceProjectionFromHubProfile\(profile\)/)
})

test('keeps display metadata with the instance during an optimistic cross-source move', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.match(source, /const movedPokemonDisplay = sourceSnapshot\.pokemonDisplay\?\.\[pokemonInstanceId\]/)
  assert.match(source, /\? \{ \.\.\.snapshot\.pokemonDisplay, \[pokemonInstanceId\]: movedPokemonDisplay \}/)
})

test('keeps canonical candidates and ends the local session after a terminal snapshot error', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.match(source, /function createCanonicalPokemonHubSnapshot\(session, panes, snapshots\)/)
  assert.match(source, /revision: session\.version/)
  assert.match(source, /createPokemonHubSnapshotFlight/)
  assert.match(source, /endPokemonHubSessionLocally\(cause\)/)
})

test('defers heartbeat behind every tracked session request', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.match(source, /requestGate: createPokemonHubRequestGate\(\)/)
  assert.match(source, /waitUntilReady: session\.requestGate\.isInFlight\(\)/)
  assert.match(source, /session\.requestGate\.waitForIdle\(\)/)
  assert.equal(source.match(/session\.requestGate\.run\(\(\) => syncPokemonHubSessionSnapshot/g)?.length, 2)
})

test('isolates heartbeat in-flight state between old and newly opened sessions', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.doesNotMatch(source, /pokemonHubHeartbeatInFlightRef/)
  assert.match(source, /heartbeatInFlight: false/)
  assert.match(source, /if \(!session \|\| session\.heartbeatInFlight\) return/)
})

test('derives Save selectors from the global catalog without a second Hub catalog request', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.match(source, /deriveSaveProfileCatalog\(games\)/)
  assert.doesNotMatch(source, /getSaveProfileGames/)
  assert.doesNotMatch(source, /loadableSaveCatalog/)
  assert.doesNotMatch(source, /loadPokemonHubSaveCatalog/)
  assert.match(source, /saveProfileGamesLoading=\{catalogLoading\}/)
  assert.match(source, /saveProfileGamesError=\{catalogError\}/)
})

test('visibly confirms an accepted empty snapshot response without changing its payload', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.match(source, /setPokemonHubSnapshotStatus\('Snapshot sincronizado\.'\)/)
  assert.match(source, /pokemonHubSnapshotStatus && <p className="pokemon-hub-snapshot-status" role="status">\{pokemonHubSnapshotStatus\}<\/p>/)
})

test('abandons the local workspace before waiting for the remote close response', async () => {
  const source = await readFile(sourceFile, 'utf8')

  assert.match(source, /async function closePokemonHub\(\)/)
  assert.doesNotMatch(source, /snapshotFlight\.beginClose\(\)/)
  assert.match(source, /const finalSnapshot = session \? createCanonicalPokemonHubSnapshot\(session, pokemonHubPanesRef\.current, pokemonHubSnapshotsRef\.current\) : null/)
  const localRelease = source.indexOf('pokemonHubSessionRef.current = null', source.indexOf('async function closePokemonHub()'))
  const remoteClose = source.indexOf('closePokemonHubSession(session.profileId, session.sessionId, finalSnapshot', source.indexOf('async function closePokemonHub()'))
  assert.ok(localRelease >= 0)
  assert.ok(remoteClose >= 0)
  assert.ok(localRelease < remoteClose)
  assert.doesNotMatch(source, /submitStructuralPokemonHubPaneChange\(\[null, null, null\]/)
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
