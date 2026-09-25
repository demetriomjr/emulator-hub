---
title: Party direction and trade readiness in Pokemon Hub
date: 2026-09-25
tags: [spec, pokemon-hub, party, trade]
---

# Spec 071 — Party transfer guards

Ordinary trade readiness for a Gen III save is determined by its existing in-game trade flag. The previous requirement for two non-Egg Party Pokémon is removed. Regional Pokédex, Network Machine, title-pair, and source-retention rules remain in effect. A save may therefore trade when it has one Pokémon in its Party and another in its PC.

A Pokémon can move out of a Party into the same save's PC, another save's PC, or the Hub. No Pokémon may enter a Party from a PC or Hub; this also prevents routing a PC Pokémon through the Hub into a Party. Party-to-Party moves remain available where existing transfer rules permit them. Every game save source must retain at least one occupied Party slot after the complete placement transaction, including multi-Pokémon sync requests. Enforce both direction and final occupancy in the authoritative backend; the frontend rejects forbidden drops early with the same rule.

No save or production data is changed by this spec.
