---
title: Generation III regional transfer gates
date: 2026-09-19
tags: [spec, pokemon, hub, generation-iii, transfers, regional-dex]
status: proposed
amends: [029-pokemon-hub-canonical-session-snapshot.md]
---

# Spec 035 — Generation III regional transfer gates

## Goal

Make Pokémon Hub refuse a cross-save Generation III move that the original
Game Boy Advance games would not permit because either save has not reached
the necessary Pokédex or story progression. The first supported titles are
Pokémon Ruby, Sapphire, Emerald, FireRed, and LeafGreen.

The rule is about the *save*, not just its ROM title. Two Emerald saves may
have different eligibility, as may two FireRed saves. A valid Hub move must be
legal for both the departing and receiving save at their recorded progress.

## Scope

- Validate a Pokémon Hub move between two attached game-save sources for the
  five listed Generation III titles.
- Define the two regional allowlists, each title's unlock conditions, and the
  exact pairwise compatibility matrix.
- Preserve the existing canonical-session ownership, placement, revision,
  flush, and lease rules from Specs 029 and 030. This spec adds a precondition
  to an otherwise valid cross-save move; it does not change its persistence
  lifecycle.

## Non-goals

- Detecting, editing, or synthesizing the game save flags described here.
- UI for displaying progress, requesting an unlock, or explaining a rejected
  move.
- Emulating cable, Wireless Adapter, Union Room, trading animation, items,
  held-item effects, friendship, evolution, or trade history.
- Support for Colosseum, XD, events, Generation I/II, Generation IV+, ROM
  hacks, language/version compatibility, corrupted saves, or a Pokémon whose
  native Generation III record cannot otherwise be materialized.
- Changing same-source rearrangement or a move into/from a Hub-profile source.
  Those flows do not represent a cartridge-to-cartridge trade and remain under
  their existing contracts.

## Terms and decision boundary

- **Game save** means one attached Pokémon game source, identified by its
  existing `(profileId, gameId)` identity.
- **Cross-save move** changes a Pokémon's owner source from one game save to a
  different game save. The drag direction defines `source` and `destination`.
- **Species** is the base National Pokédex species represented by the native
  Generation III record. The regional rule is species-based; it does not use
  the Pokémon's met location, original trainer, current box, nickname, or
  whether the species is locally catchable in that title.
- **Egg** is a native record marked as an Egg. It never counts as a regional
  species for the Emerald or FireRed/LeafGreen pre-National-Dex exception.
- **Ordinary trade readiness** is a separate baseline: the save has acquired
  its Pokédex and has at least two non-Egg party Pokémon. This spec records it
  as a prerequisite but does not prescribe its extraction yet.
- **Unrestricted** below means unrestricted only by this regional-progress
  rule. All existing Hub validation and baseline trade readiness still apply.

The validator evaluates the original-game gate as if the move were a direct
trade. It must not try to make a blocked destination legal by first accepting a
different Pokémon, upgrading a Dex, or mutating any progression state.

## Save-level capabilities

Every participating game-save source needs the following logical capability
snapshot. Its storage, native-save extraction, and mutation are intentionally
deferred; this is the contract that a later implementation must supply.

```ts
type GenerationIIITransferCapabilities = {
  game: 'pokemon-ruby' | 'pokemon-sapphire' | 'pokemon-emerald'
      | 'pokemon-firered' | 'pokemon-leafgreen';
  ordinaryTradeReady: boolean;
  nationalDexUnlocked: boolean;
  networkMachineRestored: boolean | null;
};
```

`networkMachineRestored` is meaningful only for FireRed and LeafGreen. It is
`null` for Ruby, Sapphire, and Emerald; a non-null value for those games is
invalid capability data. It represents Celio receiving both the Ruby and
Sapphire Key Items and the Network Machine reaching Link Level 2, not merely
obtaining the National Dex or the Rainbow Pass.

The regional dex is derived from `game`, rather than stored separately:

| Save title | Regional allowlist | Extra cross-region link gate |
| --- | --- | --- |
| Ruby / Sapphire | Hoenn | None |
| Emerald | Hoenn | None |
| FireRed / LeafGreen | Kanto | Network Machine restored |

`nationalDexUnlocked` has distinct semantics by title:

- **Ruby/Sapphire:** it is display/index mode, not a transfer permission gate.
  It activates after a trade with Emerald, FireRed, or LeafGreen, even when
  that trade carries a Hoenn species. Beating the League alone does not grant
  it. Hub must not require it for any Ruby/Sapphire transfer.
- **Emerald:** it becomes true after the player enters the Hall of Fame, resumes
  the game, leaves the Littleroot house, and Professor Birch upgrades the Dex.
  Until then Emerald can exchange only non-Egg Hoenn-Dex species with Ruby,
  Sapphire, or another Emerald, and cannot link to FireRed/LeafGreen.
- **FireRed/LeafGreen:** it becomes true only after Hall of Fame entry, owning
  at least 60 Kanto species, visiting One Island, and speaking with Professor
  Oak in Pallet Town. Until then a Kanto-to-Kanto link accepts only non-Egg
  Kanto-Dex species and cannot link to Hoenn titles.

## Regional membership data

The two allowlists are canonical membership data, not availability tables.
They include species that a particular version might require another game to
obtain, and they exclude any species absent from that regional Pokédex.

### Kanto regional dex — FireRed / LeafGreen

Kanto membership is exactly National Pokédex numbers `001..151`: Bulbasaur,
Ivysaur, Venusaur, Charmander, Charmeleon, Charizard, Squirtle, Wartortle,
Blastoise, Caterpie, Metapod, Butterfree, Weedle, Kakuna, Beedrill, Pidgey,
Pidgeotto, Pidgeot, Rattata, Raticate, Spearow, Fearow, Ekans, Arbok, Pikachu,
Raichu, Sandshrew, Sandslash, Nidoran♀, Nidorina, Nidoqueen, Nidoran♂,
Nidorino, Nidoking, Clefairy, Clefable, Vulpix, Ninetales, Jigglypuff,
Wigglytuff, Zubat, Golbat, Oddish, Gloom, Vileplume, Paras, Parasect, Venonat,
Venomoth, Diglett, Dugtrio, Meowth, Persian, Psyduck, Golduck, Mankey,
Primeape, Growlithe, Arcanine, Poliwag, Poliwhirl, Poliwrath, Abra, Kadabra,
Alakazam, Machop, Machoke, Machamp, Bellsprout, Weepinbell, Victreebel,
Tentacool, Tentacruel, Geodude, Graveler, Golem, Ponyta, Rapidash, Slowpoke,
Slowbro, Magnemite, Magneton, Farfetch'd, Doduo, Dodrio, Seel, Dewgong,
Grimer, Muk, Shellder, Cloyster, Gastly, Haunter, Gengar, Onix, Drowzee,
Hypno, Krabby, Kingler, Voltorb, Electrode, Exeggcute, Exeggutor, Cubone,
Marowak, Hitmonlee, Hitmonchan, Lickitung, Koffing, Weezing, Rhyhorn, Rhydon,
Chansey, Tangela, Kangaskhan, Horsea, Seadra, Goldeen, Seaking, Staryu,
Starmie, Mr. Mime, Scyther, Jynx, Electabuzz, Magmar, Pinsir, Tauros,
Magikarp, Gyarados, Lapras, Ditto, Eevee, Vaporeon, Jolteon, Flareon, Porygon,
Omanyte, Omastar, Kabuto, Kabutops, Aerodactyl, Snorlax, Articuno, Zapdos,
Moltres, Dratini, Dragonair, Dragonite, Mewtwo, and Mew.

### Hoenn regional dex — Ruby / Sapphire / Emerald

Hoenn membership is this exact 202-species set in the original Generation III
Hoenn-Dex order (not “all Generation III species”):

```text
001–025 Treecko, Grovyle, Sceptile, Torchic, Combusken, Blaziken, Mudkip,
        Marshtomp, Swampert, Poochyena, Mightyena, Zigzagoon, Linoone,
        Wurmple, Silcoon, Beautifly, Cascoon, Dustox, Lotad, Lombre, Ludicolo,
        Seedot, Nuzleaf, Shiftry, Taillow,
026–050 Swellow, Wingull, Pelipper, Ralts, Kirlia, Gardevoir, Surskit,
        Masquerain, Shroomish, Breloom, Slakoth, Vigoroth, Slaking, Abra,
        Kadabra, Alakazam, Nincada, Ninjask, Shedinja, Whismur, Loudred,
        Exploud, Makuhita, Hariyama, Goldeen,
051–075 Seaking, Magikarp, Gyarados, Azurill, Marill, Azumarill, Geodude,
        Graveler, Golem, Nosepass, Skitty, Delcatty, Zubat, Golbat, Crobat,
        Tentacool, Tentacruel, Sableye, Mawile, Aron, Lairon, Aggron, Machop,
        Machoke, Machamp,
076–100 Meditite, Medicham, Electrike, Manectric, Plusle, Minun, Magnemite,
        Magneton, Voltorb, Electrode, Volbeat, Illumise, Oddish, Gloom,
        Vileplume, Bellossom, Doduo, Dodrio, Roselia, Gulpin, Swalot, Carvanha,
        Sharpedo, Wailmer, Wailord,
101–125 Numel, Camerupt, Slugma, Magcargo, Torkoal, Grimer, Muk, Koffing,
        Weezing, Spoink, Grumpig, Sandshrew, Sandslash, Spinda, Skarmory,
        Trapinch, Vibrava, Flygon, Cacnea, Cacturne, Swablu, Altaria, Zangoose,
        Seviper, Lunatone,
126–150 Solrock, Barboach, Whiscash, Corphish, Crawdaunt, Baltoy, Claydol,
        Lileep, Cradily, Anorith, Armaldo, Igglybuff, Jigglypuff, Wigglytuff,
        Feebas, Milotic, Castform, Staryu, Starmie, Kecleon, Shuppet, Banette,
        Duskull, Dusclops, Tropius,
151–175 Chimecho, Absol, Vulpix, Ninetales, Pichu, Pikachu, Raichu, Psyduck,
        Golduck, Wynaut, Wobbuffet, Natu, Xatu, Girafarig, Phanpy, Donphan,
        Pinsir, Heracross, Rhyhorn, Rhydon, Snorunt, Glalie, Spheal, Sealeo,
        Walrein,
176–202 Clamperl, Huntail, Gorebyss, Relicanth, Corsola, Chinchou, Lanturn,
        Luvdisc, Horsea, Seadra, Kingdra, Bagon, Shelgon, Salamence, Beldum,
        Metang, Metagross, Regirock, Regice, Registeel, Latias, Latios, Kyogre,
        Groudon, Rayquaza, Jirachi, Deoxys
```

The source dataset must retain species' National Dex number as its stable key;
the numbered Hoenn positions above are documentation/display order only.

## Compatibility matrix

All rows first require `ordinaryTradeReady` on both saves. “Regional only”
means the moved record must be non-Egg and its species must be in the stated
regional allowlist. A directional move must satisfy the rule at *both ends*:
an Emerald source without National Dex cannot send an Egg or non-Hoenn species,
even where the destination would accept it.

| Save pair | Required capabilities | Allowed move before every listed capability is true | Allowed move once requirements are true |
| --- | --- | --- | --- |
| Ruby ↔ Sapphire | No National Dex requirement | Unrestricted | Unrestricted |
| Ruby/Sapphire ↔ Emerald | Emerald `nationalDexUnlocked` | Regional only: Hoenn, non-Egg | Unrestricted |
| Emerald ↔ Emerald | Both Emerald saves `nationalDexUnlocked` | A non-National-Dex endpoint limits the move to Hoenn, non-Egg | Unrestricted |
| FireRed ↔ LeafGreen (including same-title pairs) | Both saves `nationalDexUnlocked` | A non-National-Dex endpoint limits the move to Kanto, non-Egg | Unrestricted |
| Ruby/Sapphire ↔ FireRed/LeafGreen | The FireRed/LeafGreen save has `nationalDexUnlocked` **and** `networkMachineRestored === true` | No link; reject every move | Unrestricted |
| Emerald ↔ FireRed/LeafGreen | Emerald `nationalDexUnlocked`; FireRed/LeafGreen `nationalDexUnlocked` and `networkMachineRestored === true` | No link; reject every move | Unrestricted |

For the two mixed rows, a Ruby/Sapphire save's `nationalDexUnlocked` is never
an additional requirement. The FireRed/LeafGreen Network Machine requirement
applies whether that save is source or destination.

## Required validation result

The later implementation must perform this check after it resolves the actual
source/destination records and before it accepts the candidate canonical
snapshot or changes any placement. A rejected candidate must leave every
placement, source revision, native save, snapshot slot, and lease untouched;
the existing canonical correction path remains responsible for returning the
authoritative state.

The validator must make a deterministic distinction between these causes:

| Code | Meaning |
| --- | --- |
| `TRANSFER_TRADE_NOT_READY` | Source or destination lacks ordinary trade readiness. |
| `TRANSFER_NATIONAL_DEX_REQUIRED` | An Emerald, FireRed, or LeafGreen endpoint has a regional rule that the Egg/species violates, or a required National Dex is absent for the game pair. |
| `TRANSFER_NETWORK_MACHINE_REQUIRED` | A FireRed/LeafGreen endpoint attempts a Hoenn link before Celio's Network Machine is restored. |
| `TRANSFER_GAME_PAIR_UNSUPPORTED` | Either save title is outside this spec's five-title set. |

`TRANSFER_NETWORK_MACHINE_REQUIRED` takes precedence over
`TRANSFER_NATIONAL_DEX_REQUIRED` only after the endpoint's National Dex is
known to be unlocked; otherwise report the missing National Dex first. A move
that is limited by a regional endpoint must be rejected as
`TRANSFER_NATIONAL_DEX_REQUIRED`, including an Egg containing a species that
would otherwise be in the regional dex.

## Acceptance criteria for the later implementation

1. The exact Kanto and Hoenn membership sets above are data-tested, including
   a Gen I/II member of Hoenn (for example, Abra), a Hoenn-introduced member,
   and a non-member such as Chikorita.
2. Ruby↔Sapphire accepts an Egg and a non-Hoenn species when both saves have
   ordinary trade readiness, regardless of either save's National Mode.
3. An Emerald endpoint without National Dex rejects a Chikorita and every Egg,
   but accepts a non-Egg Abra or Treecko when paired with Ruby, Sapphire, or
   Emerald and baseline readiness is true.
4. A FireRed/LeafGreen endpoint without National Dex accepts only non-Egg
   Kanto species with another FireRed/LeafGreen endpoint; it rejects Crobat
   and Eggs even though Zubat/Golbat are Kanto members.
5. A FireRed/LeafGreen endpoint with National Dex but without the restored
   Network Machine rejects every Ruby/Sapphire/Emerald pairing in either drag
   direction.
6. Emerald↔FireRed/LeafGreen passes only after both relevant National Dex
   conditions and the FireRed/LeafGreen Network Machine condition hold.
7. Every rejection is side-effect free and uses the existing canonical snapshot
   correction behavior; a valid transfer continues to the normal session,
   persistence, and deferred materialization path.

## Evidence

- Bulbapedia's [Generation III National Pokédex reference](https://bulbapedia.bulbagarden.net/wiki/Nat_dex)
  documents the Ruby/Sapphire National Mode trigger and the FireRed/LeafGreen
  Hall of Fame, 60-owned-Kanto-species, One Island, and Oak conditions.
- Bulbapedia's [trade reference](https://bulbapedia.bulbagarden.net/wiki/Trade)
  documents Generation III baseline readiness and the FireRed/LeafGreen
  regional, Egg, National Dex, and Network Machine gates.
- Bulbapedia's [Emerald reference](https://bulbapedia.bulbagarden.net/wiki/RSv3)
  documents its Hoenn-only/Egg restriction before National Dex and its
  FireRed/LeafGreen compatibility condition.
- Bulbapedia's [Generation III Hoenn Pokédex list](https://bulbapedia.bulbagarden.net/wiki/OHdex)
  establishes the 202-member Hoenn set; Pokémon Database's
  [RSE Pokédex list](https://pokemondb.net/pokedex/game/ruby-sapphire-emerald)
  provides an independent ordered listing.
