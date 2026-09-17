# Local Pokemon Sprite Resources Implementation Plan

**Goal:** Populate one local frontend resource directory with normal and shiny artwork for every base Pokémon and regional form before Vite starts.

**Architecture:** A reusable `apps/packages/` module selects eligible source records, creates deterministic local names, validates a manifest, and synchronizes missing PNGs atomically. A thin frontend script invokes that module from `predev`; React later consumes the public paths without an upstream request.

**Tech Stack:** Node.js ESM, Node `fetch`, `node:fs/promises`, Node test runner, npm lifecycle scripts, Vite static `public` directory.

**Spec:** [.spec/020-local-pokemon-sprite-resources.md](020-local-pokemon-sprite-resources.md)

## Global constraints

- Do not run a project build.
- Store all generated files in `apps/frontend/public/resources/pokemon/`.
- Name base files `{nationalDex}.png` and `{nationalDex}-shiny.png`.
- Name regional files `{nationalDex}-{region}.png` and `{nationalDex}-{region}-shiny.png`.
- Include only base species plus Alola, Galar, Hisui, and Paldea regional forms; exclude Mega and every other alternate form.
- Do not make network requests when a valid complete local manifest exists.
- Generated resources and manifest remain out of Git.

---

### Task 1: Define and test catalog selection and public naming

**Files:**
- Create: `apps/packages/pokemon-resource-catalog.mjs`
- Create: `apps/packages/pokemon-resource-catalog.test.mjs`

**Interfaces:**
- Produces `selectPokemonResources(records)` and `spriteUrl({ nationalDex, region, shiny })`.
- `selectPokemonResources` returns sorted entries with `{ nationalDex, region, sourceId, normalFile, shinyFile }`.

- [ ] Write failing tests for base names, regional names, shiny suffix placement, excluded alternate forms, collisions, and local URL validation.
- [ ] Run `node --test apps/packages/pokemon-resource-catalog.test.mjs` and confirm the tests fail because the module is absent.
- [ ] Implement the smallest catalog selector and local URL resolver that pass those tests.
- [ ] Re-run `node --test apps/packages/pokemon-resource-catalog.test.mjs` and confirm it passes.

### Task 2: Define and test complete-catalog synchronization

**Files:**
- Create: `apps/packages/pokemon-resource-sync.mjs`
- Create: `apps/packages/pokemon-resource-sync.test.mjs`

**Interfaces:**
- Produces `syncPokemonResources(options)` returning `{ status, count }`.
- A complete manifest prevents the supplied network loader from running.
- An incomplete directory is populated through injected source and file operations, then receives a complete manifest only after every file is written.

- [ ] Write failing tests for complete no-network behavior, missing-file recovery, and failed-refresh preservation.
- [ ] Run `node --test apps/packages/pokemon-resource-sync.test.mjs` and confirm the tests fail because the module is absent.
- [ ] Implement the minimal manifest validator and atomic synchronizer using the Task 1 catalog contract.
- [ ] Re-run `node --test apps/packages/pokemon-resource-sync.test.mjs` and confirm it passes.

### Task 3: Wire the frontend start and generated-resource boundary

**Files:**
- Create: `apps/frontend/scripts/sync-pokemon-resources.mjs`
- Modify: `apps/frontend/package.json`
- Modify: `.gitignore`
- Modify: `.spec/020-local-pokemon-sprite-resources.md`

**Interfaces:**
- `npm run dev` executes the synchronizer before Vite.
- `npm run sync:pokemon-resources` explicitly refreshes resources.
- Both commands target only `apps/frontend/public/resources/pokemon/`.

- [ ] Write the failing lifecycle assertion that the frontend package defines `predev` and `sync:pokemon-resources` with the local synchronizer.
- [ ] Run the focused Node tests and confirm the lifecycle assertion fails.
- [ ] Add the thin executable, lifecycle scripts, and Git ignore rule; mark the specification active.
- [ ] Run every resource-catalog and resource-sync test without running a project build.

### Task 4: Verify the executable boundary without downloading the catalog

**Files:**
- Modify: `.spec/020-local-pokemon-sprite-resources-plan.md`

- [ ] Run the focused Node test suite.
- [ ] Run the explicit sync command only with an already-complete temporary fixture, proving it takes the no-network branch.
- [ ] Inspect `git status --short` and ensure generated frontend resources were not added to Git.
- [ ] Record verification evidence in this plan.

## Verification record

- 2026-09-17: `node --test apps/packages/pokemon-resource-start.test.mjs apps/packages/pokemon-resource-catalog.test.mjs apps/packages/pokemon-resource-sync.test.mjs` passed: 9 tests.
- 2026-09-17: Current upstream metadata preflight found 1,351 source records, selected 1,082 local resources, including 57 regional entries, with no selected record missing a normal or shiny image.
- 2026-09-17: No project build was run. The full initial asset retrieval is triggered in the background by the next frontend `npm run dev` invocation, so Vite does not wait for it.
