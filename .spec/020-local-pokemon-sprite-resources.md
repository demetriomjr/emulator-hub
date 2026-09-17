---
title: Local Pokemon Sprite Resources
date: 2026-09-17
tags: [spec, pokemon, frontend, sprites, resources, offline]
status: active
---

# Spec 020 — Local Pokemon Sprite Resources

## Goal

Make the Pokemon Hub's artwork catalog available as local static frontend resources. The browser must render Pokémon art without requesting an external sprite service at runtime.

The initial resource acquisition begins in the background while the frontend development server starts. Once the resource catalog is complete, later frontend starts perform no network retrieval and do not rewrite existing image files. A separately invoked update command is the only normal path that checks the upstream collection for changes.

## Included artwork

The catalog contains:

1. one normal image and one shiny image for every current base Pokémon species; and
2. one normal image and one shiny image for every current regional form from Alola, Galar, Hisui, or Paldea.

This explicitly excludes Mega Evolutions, Gigantamax forms, battle-only transformations, cosmetic patterns, costumes, gender-only variants, and all other non-regional alternate forms.

## Local resource contract

All generated files live in exactly one static directory:

`apps/frontend/public/resources/pokemon/`

The public URL for every image begins with `/resources/pokemon/`. No region-specific subdirectory, source-specific directory, or second image root is allowed.

File names use the National Pokédex number and lowercase region label:

| Variant | Filename example | Public URL example |
| --- | --- | --- |
| Base, normal | `6.png` | `/resources/pokemon/6.png` |
| Base, shiny | `6-shiny.png` | `/resources/pokemon/6-shiny.png` |
| Regional, normal | `26-alola.png` | `/resources/pokemon/26-alola.png` |
| Regional, shiny | `26-alola-shiny.png` | `/resources/pokemon/26-alola-shiny.png` |
| Regional subvariant, normal | `128-paldea-combat-breed.png` | `/resources/pokemon/128-paldea-combat-breed.png` |
| Regional subvariant, shiny | `128-paldea-combat-breed-shiny.png` | `/resources/pokemon/128-paldea-combat-breed-shiny.png` |

`manifest.json` resides in the same directory. It records the catalog schema version and the exact resources generated, including each National Pokédex number, optional region label, optional regional subvariant, normal filename, shiny filename, and upstream source identity. React may use it to resolve a safe local URL; it must not expose or request the upstream URL.

## Synchronization behavior

`apps/packages/` owns the reusable selection, filename, completeness, and synchronization logic. The frontend package owns only the start-command hook and the static public target.

Before `npm run dev` launches Vite, a `predev` hook checks the local catalog only. It exits immediately when the manifest is complete; otherwise, it starts one detached synchronizer and then allows Vite to launch.

1. If the local manifest validates and every required file is present, the pre-start hook exits successfully without contacting the network.
2. If the catalog is absent or incomplete, the pre-start hook launches one background synchronizer; Vite does not wait for its retrieval to finish.
3. A local lock prevents repeated frontend starts from starting a second synchronizer while the first is active.
4. The synchronizer obtains the current upstream catalog, selects only the included artwork, and writes a complete replacement catalog atomically.
5. A failed acquisition leaves an existing complete catalog unchanged. If no complete catalog exists, the frontend still starts but image resources remain unavailable until a later successful synchronization.
6. An explicit `sync:pokemon-resources` command checks the upstream catalog and refreshes it. It never runs automatically after the initial catalog is complete.

The synchronizer identifies base species and regional forms from upstream metadata, not from frontend assumptions. It uses the source's National Pokédex identity to create the public filename, so a regional form never overwrites its base species.

Before an image is written locally, the synchronizer must normalize its transparent canvas. It must find the non-transparent alpha bounds, crop away only transparent outer space, scale the visible artwork proportionally into a fixed 76×76 usable area, and center it in a transparent 96×96 PNG. This makes the largest visible dimension consistent while preserving each sprite's aspect ratio and a 10-pixel safe inset on every side. The generated manifest records a sprite-normalization version; a catalog produced by an earlier normalization version is incomplete and is rebuilt atomically on the next frontend start.

## Frontend behavior

Frontend code resolves images solely through the local naming contract. A base sprite lookup receives `{ nationalDex, shiny }`; a regional lookup also receives `region`, and a regional subvariant receives `variant`. The resolver returns a public path only when values are valid:

```text
spriteUrl({ nationalDex: 6, shiny: false })
  -> /resources/pokemon/6.png

spriteUrl({ nationalDex: 26, region: 'alola', shiny: true })
  -> /resources/pokemon/26-alola-shiny.png

spriteUrl({ nationalDex: 128, region: 'paldea', variant: 'combat-breed', shiny: true })
  -> /resources/pokemon/128-paldea-combat-breed-shiny.png
```

The first implementation introduces the catalog and resolver only. It does not change any Hub layout, save parser, API response, selector, game catalog, or existing screen until a later approved feature renders species sprites.

## Source and storage boundary

Generated PNGs and the generated manifest are local development resources and are excluded from Git. The repository tracks the synchronizer, its deterministic catalog rules, tests, and a small test fixture only. A fresh checkout can recreate the local resource directory by starting the frontend or running the explicit synchronization command.

The upstream artwork is third-party intellectual property. This feature records provenance in the local manifest and does not represent the images as project-owned or freely licensed assets.

## Acceptance criteria

1. A fresh local frontend start launches Vite without waiting for resource retrieval, while one background synchronizer creates `resources/pokemon` with the required normal and shiny PNGs plus `manifest.json`.
2. The files `6.png`, `6-shiny.png`, `26-alola.png`, and `26-alola-shiny.png` are valid examples of the enforced naming contract.
3. The catalog includes every current base species and every current Alolan, Galarian, Hisuian, and Paldean form, each in normal and shiny form. Where more than one regional subvariant shares a National Pokédex number, its subvariant follows the region in the filename and precedes the shiny suffix.
4. Mega Evolutions and every other excluded alternate-form category produce no resource file or manifest entry.
5. Starting the frontend with a complete valid catalog makes no network request and changes no existing resource file; an incomplete catalog triggers at most one background synchronizer.
6. The explicit synchronization command can refresh the catalog, and a retrieval failure preserves the previous complete catalog.
7. Browser-visible artwork URLs are local `/resources/pokemon/...` paths; the browser has no upstream sprite-service dependency.
8. Automated tests cover selection, exclusion, filename construction, manifest completeness, no-network-complete behavior, incomplete recovery, preservation after a failed refresh, and alpha-bound crop/scale/centering. No project build is run.
