# Pokémon Hub Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a read-only, fully hydrated Pokémon card in each Pokémon Hub pane without per-Pokémon requests.

**Architecture:** A shared Gen III projector decodes validated native records into card data. A read-only coordinator query supplies all occupied records for each loaded source; the two existing GETs return detail maps. React stores details separately from compact placement snapshots and renders one local card per pane. Assets are local and do not gate game/save flows.

**Tech Stack:** Node.js ESM, Redis-backed package contracts, React, CSS, Node test runner.

**Spec:** `.spec/078-pokemon-hub-pokemon-card-and-save-data.md`

## Global Constraints

- All non-presentation logic belongs in `apps/packages/`.
- Preserve core ROM/save launch and integrity requirements; card and icons are optional.
- No project build and no commit in this task, per AGENTS.md, because neither was requested.
- Frontend gets every Pokémon detail with profile load; no fetch on Pokémon click.
- Card reads only; no Pokémon or save writes.

## Review Focus

- Dirty save source: never attach physical Party runtime to a different logical Pokémon.
- Corrupt record: preserve layout and expose unavailable detail, never invent facts.
- Three panes: selection and close state stay independent after pane removal/reordering.
- Gen III ribbon and origin mappings: unknown IDs remain unknown, never mislabeled.
- Resource failure: missing artwork/icon never blocks profile/game/save flow.

---

### Task 1: Gen III card projector

**Files:** `apps/packages/pokemon-gen3-party-runtime.mjs`, `apps/packages/pokemon-gen3-card-data.mjs`, catalog files under `apps/packages/`, corresponding `.test.mjs`.

**Interfaces:** `projectGen3PokemonCard({bytes, kind, title, provenance, partyRuntimeValid}) -> card fields`; shared parser exposes validated Growth/Attacks/EVs/Misc. No input mutation.

- [ ] Write tests for checksum, IVs, stats, gender, shiny, moves, ribbons, origin, ball/item and unavailable context.
- [ ] Run targeted tests and confirm missing behavior fails.
- [ ] Implement shared parse/projection and offline ID catalogs.
- [ ] Run targeted tests and confirm success.

### Task 2: Read-only bulk source projection and HTTP contracts

**Files:** `apps/packages/pokemon-hub-snapshot-coordinator.mjs`, new bulk projector package, `apps/backend/server.mjs`, `apps/backend/test/server.test.mjs`, focused package tests.

**Interfaces:** `coordinator.getDetailSource({profileId,sourceKey}) -> {source,records}`; `projectPokemonHubDetailSource(...) -> pokemonDetailsById`; existing GETs gain `pokemonDetailsById`.

- [ ] Write tests for all occupied IDs, owner namespace, corrupt/dirty/unavailable records and unchanged existing GET fields.
- [ ] Run targeted tests and confirm missing behavior fails.
- [ ] Implement consistent source+record read and pure aggregate projection.
- [ ] Run targeted tests and confirm success.

### Task 3: Frontend hydration and three pane card

**Files:** `apps/packages/hub-client.js`, `apps/packages/pokemon-hub-ui.jsx`, `apps/frontend/src/styles.css`, focused frontend/package tests.

**Interfaces:** existing profile/layout calls return validated `pokemonDetailsById`; selection state is independent by pane; slot click is local.

- [ ] Write tests for validation, no per-Pokémon fetch, independent three cards, save slot keyboard click and drag distinction.
- [ ] Run targeted tests and confirm missing behavior fails.
- [ ] Implement local detail map, card, per-pane close/reconciliation and responsive style.
- [ ] Run targeted tests and confirm success.

### Task 4: Card assets and integrated verification

**Files:** card icon assets/catalog or sync script, resource tests, `.spec/078...` if implementation clarifies contract.

- [ ] Write tests for stable local icon paths, ribbon rank mapping/fallback and absent assets.
- [ ] Run targeted tests and confirm missing behavior fails.
- [ ] Implement validated local icons and ribbon asset resolution without changing sprite completeness semantics.
- [ ] Run relevant Node tests and lint, inspect changed files and `git diff --check`; do not run a project build.
