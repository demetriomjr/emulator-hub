# Pokemon Hub Save Profile Selection Implementation Plan

> **Status: superseded.** The workspace-only catalog request described below is
> no longer authoritative. The active contract in
> `.spec/017-pokemon-hub-save-profile-selection.md` reuses the application-wide
> `GET /api/games` state, derives Save choices through
> `apps/packages/save-profile-catalog.mjs`, and validates the HTTP envelope
> through `apps/packages/game-catalog-contract.mjs`. Keep the legacy
> `/api/pokemon-hub/save-profile-games` route for compatibility only; do not use
> it from new frontend flows.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each Pokemon Hub pane select a trusted ROM with profiles and then one existing save profile for that ROM, without loading box content.

**Architecture:** The backend adds one read-only catalog projection that filters ready ROMs to those with persisted generic profiles. React obtains that projection only after the pane chooses `Perfil de Save`, then uses the existing per-game profile route for the selected ROM. Complete `{ kind: 'game', gameId, profileId }` sources remain the only identity reserved across workspace panes.

**Tech Stack:** Node.js built-in HTTP server and `node:test`; shared ES modules; React; Ant Design `Select`.

**Spec:** `.spec/017-pokemon-hub-save-profile-selection.md`

## Global Constraints

- Do not run a project build.
- A save profile is the existing generic profile scoped by `gameId`; do not create a new profile document or global profile endpoint.
- Expose only trusted, currently `ready` ROMs with one or more persisted profiles; never expose ROM bytes, save bytes, hashes, paths, or registry payloads.
- Keep browser state to identifiers and safe display projections. Do not call the inventory/transfer endpoint for navigation and do not render boxes, slots, Pokemon records, or transfer controls in this slice.
- Shared logic belongs in `apps/packages/`; preserve the existing maximum of three in-memory panes and exact-pair source uniqueness.

---

## File structure

| File | Responsibility |
| --- | --- |
| `apps/backend/server.mjs` | Route recognition and read-only eligible-ROM projection, using the trusted catalog, existing ROM verification, and generic profile store. |
| `apps/backend/test/server.test.mjs` | HTTP coverage for ready/profile filtering and response shape. |
| `apps/packages/hub-client.js` | Validated browser helper for the new eligible-ROM route. |
| `apps/packages/hub-client.test.mjs` | Request and invalid-response coverage for the new helper. |
| `apps/packages/pokemon-hub-workspace.test.mjs` | Regression coverage for incomplete sources and same-ROM/different-profile identities. |
| `apps/frontend/src/main.jsx` | Per-workspace catalog cache, per-ROM profile caches, two-step pane controls, and loaded-source header. |
| `apps/frontend/src/styles.css` | Only the narrow styles needed for selector feedback and the loaded-source header. |
| `.spec/README.md` | Discoverability link for Specs 017 and its implementation plan. |

### Task 1: Read-only eligible-ROM endpoint

**Files:**
- Modify: `apps/backend/server.mjs:112-210,389-421`
- Test: `apps/backend/test/server.test.mjs`

**Interfaces:**
- Consumes: `loadAvailableCatalog(config)`, `normalizeEntry(entry, index)`, `verifyRom(entry, config.romsDirectory)`, and `config.profileStore.list(gameId)`.
- Produces: `GET /api/pokemon-hub/save-profile-games -> { games: SaveProfileGame[] }`, where `SaveProfileGame` is `{ id, title, system, region?, coverUrl? }`.

- [ ] **Step 1: Write the failing HTTP test**

Add a server fixture with these catalog entries: a ready `pokemon-emerald` ROM with profile `May`, a ready `pokemon-firered` ROM with no profile, and an unavailable `pokemon-ruby` ROM with profile `Brendan`. Create the two profiles through the existing `POST /api/games/:gameId/profiles` route. Assert that a `GET /api/pokemon-hub/save-profile-games` response is `200` and exactly:

```js
{
  games: [{
    id: 'pokemon-emerald',
    title: 'Pokemon Emerald',
    system: 'gba',
  }],
}
```

Add a second assertion with a fixture containing no persisted profiles and expect `{ games: [] }`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test apps/backend/test/server.test.mjs`

Expected: FAIL because the new route is not recognized and returns the existing not-found response.

- [ ] **Step 3: Add route recognition and handler**

In `handleRequest`, define an exact-path predicate for `/api/pokemon-hub/save-profile-games`, allow only `GET`, and dispatch it before the generic Pokemon Hub profile route. Implement a `listSaveProfileGames(response, config)` helper that:

```js
const eligible = []
const entries = await loadAvailableCatalog(config)
for (let index = 0; index < entries.length; index += 1) {
  const entry = normalizeEntry(entries[index], index)
  const verification = await verifyRom(entry, config.romsDirectory)
  const profiles = verification.ok ? await config.profileStore.list(entry.id) : []
  if (!verification.ok || profiles.length === 0) continue
  const game = { id: entry.id, title: entry.title, system: entry.system }
  if (entry.region && entry.region !== 'legacy') game.region = entry.region
  if (entry.coverUrl) game.coverUrl = entry.coverUrl
  eligible.push(game)
}
eligible.sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
json(response, 200, { games: eligible })
```

Handle `CATALOG_LOAD_FAILED` exactly as `listGames` already does: respond with the existing safe catalog-load error. Do not create storage, mutate a catalog entry, or call any save endpoint.

- [ ] **Step 4: Run backend tests to verify the endpoint**

Run: `node --test apps/backend/test/server.test.mjs`

Expected: PASS, including existing launch/profile/ROM tests and both new eligible-ROM cases.

- [ ] **Step 5: Commit the focused backend change**

```powershell
git add apps/backend/server.mjs apps/backend/test/server.test.mjs
git commit -m "feat: list ROMs with save profiles"
```

### Task 2: Browser client contract

**Files:**
- Modify: `apps/packages/hub-client.js:1-18`
- Test: `apps/packages/hub-client.test.mjs`

**Interfaces:**
- Consumes: `getJson(url)`.
- Produces: `getSaveProfileGames(): Promise<SaveProfileGame[]>`.

- [ ] **Step 1: Write failing client-helper tests**

Extend `hub-client.test.mjs` to import `getSaveProfileGames`. Stub `fetch` so `GET /api/pokemon-hub/save-profile-games` returns `{ games: [game] }`, then assert the helper returns `[game]` and sends exactly one `GET` request to that URL. Add an invalid-shape case returning `{ games: {} }` and assert rejection with `Invalid save-profile game response`.

- [ ] **Step 2: Run the focused client test to verify it fails**

Run: `node --test apps/packages/hub-client.test.mjs`

Expected: FAIL because `getSaveProfileGames` is not exported.

- [ ] **Step 3: Implement a response-validating helper**

Add this helper beside `getGames`:

```js
export async function getSaveProfileGames() {
  const body = await getJson('/api/pokemon-hub/save-profile-games')
  if (!Array.isArray(body.games)) throw new Error('Invalid save-profile game response')
  return body.games
}
```

The helper must return only the response's game projections and must not request profiles, an inventory, or a save file.

- [ ] **Step 4: Run the focused client test to verify it passes**

Run: `node --test apps/packages/hub-client.test.mjs`

Expected: PASS for the existing per-game profile requests and the new eligible-ROM helper cases.

- [ ] **Step 5: Commit the client contract**

```powershell
git add apps/packages/hub-client.js apps/packages/hub-client.test.mjs
git commit -m "feat: add save profile game client"
```

### Task 3: Lock source-identity behavior with regression tests

**Files:**
- Test: `apps/packages/pokemon-hub-workspace.test.mjs`

**Interfaces:**
- Consumes: `isPaneSourceAvailable(panes, index, source)` and `choosePaneSource(panes, index, source)`.
- Produces: Proven semantics that incomplete game choices reserve nothing and only a complete game/profile pair is unique.

- [ ] **Step 1: Add source-identity regression cases**

Add assertions for these exact inputs:

```js
const emeraldMay = { kind: 'game', gameId: 'pokemon-emerald', profileId: 'may' }
const emeraldDawn = { kind: 'game', gameId: 'pokemon-emerald', profileId: 'dawn' }

assert.equal(isPaneSourceAvailable([emeraldMay, null], 1, { kind: 'game' }), true)
assert.equal(isPaneSourceAvailable([emeraldMay, null], 1, { kind: 'game', gameId: 'pokemon-emerald' }), true)
assert.equal(isPaneSourceAvailable([emeraldMay, null], 1, emeraldDawn), true)
assert.equal(isPaneSourceAvailable([emeraldMay, null], 1, emeraldMay), false)
```

Then assert that `choosePaneSource` accepts `emeraldDawn` in the second pane and rejects `emeraldMay` with `This game save is already open.`.

- [ ] **Step 2: Run the workspace test**

Run: `node --test apps/packages/pokemon-hub-workspace.test.mjs`

Expected: PASS. The existing helper already encodes this contract; these tests prevent the two-step UI from accidentally treating a ROM-only choice as complete.

- [ ] **Step 3: Commit the identity regression coverage**

```powershell
git add apps/packages/pokemon-hub-workspace.test.mjs
git commit -m "test: cover partial save profile sources"
```

### Task 4: Implement two-step pane selection

**Files:**
- Modify: `apps/frontend/src/main.jsx:1-12,119-142,401-508,787-910`
- Modify: `apps/frontend/src/styles.css:77-126`

**Interfaces:**
- Consumes: `getSaveProfileGames()`, `getProfiles(gameId)`, `isPaneSourceAvailable(panes, side, source)`, and a pane's `{ kind: 'game', gameId?, profileId? }` descriptor.
- Produces: A per-pane ROM selector, dependent profile selector, safe loading/error state, and a loaded-source header without box content.

- [ ] **Step 1: Add the request and cache state**

Import `getSaveProfileGames`. In `App`, add workspace-only state for:

```js
const [saveProfileGames, setSaveProfileGames] = useState([])
const [saveProfileGamesLoading, setSaveProfileGamesLoading] = useState(false)
const [saveProfileGamesError, setSaveProfileGamesError] = useState('')
const [saveProfilesByGame, setSaveProfilesByGame] = useState({})
const [saveProfilesLoadingByGame, setSaveProfilesLoadingByGame] = useState({})
const [saveProfilesErrorByGame, setSaveProfilesErrorByGame] = useState({})
```

Reset all six values in `openPokemonHub`. Implement `loadSaveProfileGames()` to populate the game list once per open workspace, and `loadSaveProfiles(gameId)` to cache each response under its `gameId`. A response for a previous ROM is safe because it is stored by that response's `gameId`; controls read only the currently selected `source.gameId` cache entry.

- [ ] **Step 2: Make source transitions fetch only their required data**

Extend `selectPokemonHubPane(index, source)` so choosing a bare `{ kind: 'game' }` starts `loadSaveProfileGames()`. Selecting `{ kind: 'game', gameId }` first updates the pane with no `profileId`, clears transient slot selection, and starts `loadSaveProfiles(gameId)`. Selecting a complete source continues through `choosePaneSource` before committing it.

Do not call `getPokemonHub`, `transferPokemonHub`, a save route, or a launch route from these transitions. Preserve the existing Hub-profile branch and its creation/rename/delete behavior.

- [ ] **Step 3: Replace the game branch in pane controls**

Pass the new caches and loading/error values from `PokemonHubPane` to `PokemonHubPaneControls`. For `source?.kind === 'game'`, render two Ant Design selects in order:

```jsx
<Select
  aria-label="ROM com perfil"
  value={source.gameId}
  placeholder={saveProfileGamesLoading ? 'Carregando ROMs...' : 'Escolher ROM...'}
  loading={saveProfileGamesLoading}
  disabled={saveProfileGamesLoading}
  allowClear
  onChange={gameId => onSourceChange(gameId ? { kind: 'game', gameId } : { kind: 'game' })}
  options={saveProfileGames.map(game => ({ value: game.id, label: game.title }))}
/>
```

For the dependent selector, read `saveProfilesByGame[source.gameId] ?? []`, disable it without `source.gameId`, filter each profile with `isPaneSourceAvailable(panes, side, { kind: 'game', gameId: source.gameId, profileId: profile.id })`, and select via `{ kind: 'game', gameId: source.gameId, profileId }`. Render its cache-keyed error directly below that pane's selectors. Keep `allowClear`: clearing a profile keeps `gameId`; clearing a ROM returns `{ kind: 'game' }`.

- [ ] **Step 4: Render only the selected source identity**

Resolve the selected game from `saveProfileGames` and its selected profile from `saveProfilesByGame[gameId]`. When both are present, render a compact pane header containing the ROM title and profile name. Do not render the native box selector, game slot grid, Pokemon data, revision, transfer action, or a save-content request. Leave Hub-profile rendering intact.

Add only narrow CSS for the selector feedback and loaded identity; preserve the existing dark-green workspace and pane layout.

- [ ] **Step 5: Run static and focused automated checks**

Run:

```powershell
node --check apps/backend/server.mjs
node --check apps/packages/hub-client.js
node --test apps/backend/test/server.test.mjs apps/packages/hub-client.test.mjs apps/packages/pokemon-hub-workspace.test.mjs
```

Expected: syntax checks and all focused tests PASS. Do not run a project build.

- [ ] **Step 6: Manually verify the user-visible navigation**

Using the existing local development workflow, verify without invoking a build:

1. Open Pokemon Hub and choose `Perfil de Save` in one pane.
2. Confirm the first selector contains only ready ROMs that already have profiles.
3. Select a ROM and confirm the second selector lists only its profiles.
4. Select a profile and confirm the pane shows ROM and profile identity but no box content.
5. Add a pane: the same ROM with another profile is allowed; the exact same pair is absent/rejected.
6. Change ROM while a prior profile request is pending and confirm that prior profiles never appear under the new ROM.
7. Confirm that a ROM with no profile, unavailable ROM, box UI, transfer action, and raw-save request are absent.

- [ ] **Step 7: Commit the frontend slice**

```powershell
git add apps/frontend/src/main.jsx apps/frontend/src/styles.css
git commit -m "feat: select Pokemon Hub save profiles by ROM"
```

### Task 5: Register the finished specification and plan

**Files:**
- Modify: `.spec/README.md`
- Modify: `.spec/017-pokemon-hub-save-profile-selection.md`
- Modify: `.spec/017-pokemon-hub-save-profile-selection-plan.md`

**Interfaces:**
- Consumes: the implementation outcome and focused test evidence.
- Produces: discoverable, status-accurate specification records.

- [ ] **Step 1: Add index links**

Add adjacent entries in `.spec/README.md` for Spec 017 and this plan, naming the two-step ROM/profile navigation and its deferred box content.

- [ ] **Step 2: Record only verified completion evidence**

After Task 4 passes, change Spec 017's status from `active` to `implemented` and append a concise verification note with the exact focused test command and its result. Do not claim full box or transfer verification.

- [ ] **Step 3: Validate specification consistency**

Run:

```powershell
rg -n "T[O]DO|T[B]D|fill in detai[ls]|implement lat[er]" .spec/017-pokemon-hub-save-profile-selection*.md
git diff --check
```

Expected: no placeholder matches and no whitespace errors.

- [ ] **Step 4: Commit the documentation update**

```powershell
git add .spec/README.md .spec/017-pokemon-hub-save-profile-selection.md .spec/017-pokemon-hub-save-profile-selection-plan.md
git commit -m "docs: register save profile selection spec"
```

## Plan self-review

- **Spec coverage:** Task 1 implements trusted ready-ROM/profile filtering; Task 2 validates the browser contract; Task 3 protects complete-versus-partial source identity; Task 4 covers the ordered UI flow, per-pane errors, cache-keyed stale-response safety, and explicit box-content deferral; Task 5 keeps the specification discoverable and evidence-bound.
- **Placeholder scan:** The plan contains no unresolved placeholder or undefined later implementation step. Every runtime interface and verification command is named.
- **Type consistency:** The backend response uses `SaveProfileGame[]`; the client returns that same array; React stores its `id` in `source.gameId`; the existing profile response provides `profile.id`, stored as `source.profileId`; uniqueness always checks the exact `{ kind: 'game', gameId, profileId }` pair.
