---
title: Gen III PC to Party save materialization
date: 2026-09-25
tags: [spec, pokemon-hub, gba, saves]
---

# Spec 063 — Gen III PC to Party save materialization

The Pokémon Hub must persist PC to Party placements for every supported Gen III GBA save layout (Ruby, Sapphire, Emerald, FireRed, LeafGreen) through the shared `gen3-gba-v1` adapter. The current flush omits the conversion callback required to turn an 80-byte PC core into a complete 100-byte Party record. A failed flush leaves a durable dirty source and an expired lease that is retried indefinitely.

## Contract

- Keep an existing 100-byte Party representation when a Pokémon is reordered or compacted. Party to PC keeps the first 80 native bytes.
- For a PC to Party placement, validate the encrypted 80-byte core and derive the 20 Party runtime bytes from Gen III species base stats and growth data. Never append arbitrary zeros or accept runtime bytes from the browser.
- Select data by the supported GBA title where necessary; all five titles share one conversion and save writer. An unsupported species or missing data fails before writing any save bytes.
- Materialize the entire proposed save in memory before the revision-fenced store write. Conversion failures leave the canonical `.sav` unchanged and the dirty source recoverable. The native writer updates affected sector checksums; tests reread the resulting save through the independent adapter.
- Reject a changed save snapshot that empties a previously populated Party or leaves a gap before an occupied Party slot. The UI blocks moving the last Party member into an empty Box slot, including within the same save.
- A pending dirty source from an earlier failed flush must succeed through the same path after deployment, then settle the source revision and release its expired lease. No deletion or replacement of the pending Hub placements is part of recovery.
- A deterministic materialization error must retain its concrete code and message in backend logs; recurring expired-lease retries must not emit the same error every second indefinitely.

## Data provenance

`pokemon-gen3-party-species.json` contains only the six base stats and growth group for each native species ID. These values were extracted from pret/pokeruby `src/data/pokemon/base_stats.h` at `63a8cbf0016b351a4e68f7036fa0b77e23d2f2c1`. All 386 standard species rows were compared against pret/pokeemerald `src/data/pokemon/species_info.h` at `5eff78649e7170a877b961ef0b3da13b81a16038` and pret/pokefirered at `c75f352304d529f6ba92d4f74b9cf8b5c3810788`; the seven extracted fields match. The title-specific Deoxys form base stats and the `MAIL_NONE = 0xff` initialization come from those game decompositions. Gen III growth thresholds follow pret/pokeemerald `src/data/pokemon/experience_tables.h`. This data does not come from OpenHome or PKHeX.

## Verification

Use locally authored Gen III save fixtures for each supported layout. Assert PC to Party bytes, Party count, compaction, PC slot, sector checksums, and reread identities. Exercise the real flush service with a PC-only Pokémon record, both immediately and from an expired dirty lease. Assert that invalid input never calls the save store's put method. Do not run a project build unless requested.
