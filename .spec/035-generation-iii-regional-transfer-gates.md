---
title: Generation III regional transfer gates
date: 2026-09-19
tags: [spec, pokemon, hub, generation-iii, transfers, regional-dex]
status: proposed
amends: [029-pokemon-hub-canonical-session-snapshot.md]
---

# Spec 035 — Generation III regional transfer gates

## Goal

Make Pokémon Hub refuse a cross-save Generation III trade that the original
Game Boy Advance games would not permit because either save has not reached
the necessary Pokédex or story progression. The first supported titles are
Pokémon Ruby, Sapphire, Emerald, FireRed, and LeafGreen. Exact same-title
trades have the separately stated final-population rule below.

The rule is about the *save*, not just its ROM title. Two Emerald saves may
have different eligibility, as may two FireRed saves. A valid Hub move must be
legal for both the departing and receiving save at their recorded progress.

## Scope

- Validate a Pokémon Hub move between two attached game-save sources for the
  five listed Generation III titles.
- Validate the equivalent export and import gates at the Hub-profile boundary
  so the Hub cannot be used to bypass those title and progression rules.
- Define the two regional allowlists, each title's unlock conditions, and the
  exact pairwise compatibility matrix.
- Read the verified native Generation III save sectors needed to project those
  conditions for Ruby, Sapphire, Emerald, FireRed, and LeafGreen.
- Preserve the existing canonical-session ownership, placement, revision,
  flush, and lease rules from Specs 029 and 030. This spec adds a precondition
  to an otherwise valid cross-save move; it does not change its persistence
  lifecycle.

## Non-goals

- Editing, repairing, or synthesizing the game save flags described here.
- UI for displaying progress, requesting an unlock, or explaining a rejected
  move.
- Emulating cable, Wireless Adapter, Union Room, trading animation, items,
  held-item effects, friendship, evolution, or trade history.
- Support for Colosseum, XD, events, Generation I/II, Generation IV+, ROM
  hacks, language/version compatibility, corrupted saves, or a Pokémon whose
  native Generation III record cannot otherwise be materialized.
- Changing same-source rearrangement, trading animation, or any native save
  progression state. Hub-profile boundary checks are in scope only to preserve
  transfer compatibility; the Hub remains storage, not a simulated cartridge.

## Terms and decision boundary

- **Game save** means one attached Pokémon game source, identified by its
  existing `(profileId, gameId)` identity.
- **Cross-save trade** changes a Pokémon's owner source from one game save to
  a different game save. The drag direction defines `source` and
  `destination`.
- **Exact same-title trade** is a trade between two saves of the same title:
  Ruby↔Ruby, Sapphire↔Sapphire, Emerald↔Emerald, FireRed↔FireRed, or
  LeafGreen↔LeafGreen. Its only title/progression constraint is that the
  completed transaction must leave at least one Pokémon in each participating
  save. It does not require ordinary trade readiness, National Dex, or the
  Network Machine.
- **Hub passport** is immutable transfer provenance attached to a Pokémon when
  it first enters a Hub profile. It records the title family of the save that
  admitted the Pokémon and whether that entry came from a Hoenn title. A later
  withdrawal, play session, or re-admission must not loosen this passport.
- **Hub export** moves a Pokémon from a game save to a Hub profile. It is an
  outbound compatibility check on the game save, not a direct cartridge trade.
- **Hub import** moves a Pokémon from a Hub profile to a game save. It is an
  inbound compatibility check on the destination game save, not a direct
  cartridge trade.
- **Species** is the base National Pokédex species represented by the native
  Generation III record. The regional rule is species-based; it does not use
  the Pokémon's met location, original trainer, current box, nickname, or
  whether the species is locally catchable in that title.
- **Egg** is a native record marked as an Egg. A Generation III native record
  carries an Original Trainer ID, an original-game identifier, and an Egg
  flag; therefore its Egg state and Gen III title of origin are trackable.
  Egg eligibility is pair- and progress-dependent: Eggs are allowed for
  exact same-title trades and Ruby↔Sapphire, but never satisfy a pre-National-
  Dex regional-species exception for Emerald or FireRed/LeafGreen.
- **Ordinary trade readiness** is a separate baseline: the save has acquired
  its Pokédex and has at least two non-Egg party Pokémon. It applies to
  different-title trades only; exact same-title trades use the final-population
  rule instead. This spec records the capability but does not prescribe its
  extraction yet.
- **Unrestricted** below means unrestricted only by this regional-progress
  rule. All existing Hub validation still applies; ordinary trade readiness
  applies only to different-title trades as defined above.

The validator evaluates the original-game gate as if the move were a direct
trade. It must not try to make a blocked destination legal by first accepting a
different Pokémon, upgrading a Dex, or mutating any progression state.

## Hub-profile boundary rules

The Hub is a compatibility boundary, not a neutral bypass. Its rules are
deliberately split by direction and do not require a second participating save.
`ordinaryTradeReady` is a direct-trade baseline and does not apply to either
Hub export or Hub import.

### Game save → Hub export

The source save must be permitted to export the offered record at its current
progress, and the export must leave at least one Pokémon in that save:

| Source save state | Hub export allowance |
| --- | --- |
| Ruby or Sapphire | Any species or Egg |
| Emerald without National Dex | Non-Egg Hoenn species only |
| Emerald with National Dex | Any species or Egg |
| FireRed or LeafGreen without National Dex | Non-Egg Kanto species only |
| FireRed or LeafGreen with National Dex | Any species or Egg |

On the first Hub admission, persist the Hub passport. Later returns to the Hub
preserve its original passport rather than deriving a more permissive one from
an intermediate game save.

### Hub profile → game save import

The destination alone defines whether it can receive the offered record. The
exact same-title direct-trade exception does **not** apply here: a Hub import
always uses the destination's current receiving rule.

| Destination save state | Hub import allowance |
| --- | --- |
| Ruby or Sapphire | Any species or Egg |
| Emerald without National Dex | Non-Egg Hoenn species only |
| Emerald with National Dex | Any species or Egg |
| FireRed or LeafGreen without National Dex | Non-Egg Kanto species only |
| FireRed or LeafGreen with National Dex, Hub passport from Ruby/Sapphire/Emerald | Any species or Egg only when `networkMachineRestored === true` |
| FireRed or LeafGreen with National Dex, all other Hub passports | Any species or Egg |

The Network Machine condition above is derived from the immutable Hub passport,
not merely the Pokémon's original-game field. It prevents an item admitted
from a Hoenn save from being made eligible for a Network-Machine-incomplete
FireRed/LeafGreen save by passing through a more advanced intermediate save.

When either boundary check rejects a record, it remains in its authoritative
current location: Hub export leaves it in the source save; Hub import leaves it
in the Hub profile. No rejection may change a placement, revision, native save,
snapshot slot, lease, or Hub passport.

## Shared rule assets and staged delivery

All policy data lives in `apps/packages/rules/` as versioned JSON. Backend and
frontend consume the same assets through a shared package evaluator; neither
application may duplicate a title matrix, regional membership set, Hub rule, or
Portuguese rejection message.

1. `pokemon-gen3-regional-dexes.json` owns the Kanto and exact 202-member
   Hoenn National-Dex allowlists.
2. `pokemon-gen3-transfer-rules.json` owns the five titles, direct-trade and
   Hub-boundary constraints, directional pair groups, immutable-passport rule,
   stable rejection codes, and display messages.
3. A subsequent shared evaluator resolves a candidate from those JSON assets
   and returns either `{ allowed: true }` or
   `{ allowed: false, reason: { code, message } }`. The server is authoritative;
   the frontend uses the same result only to prevent an obviously impossible
   interaction.

### Snapshot correction notice

When authoritative snapshot validation rejects a placement change, it retains
the existing correction behavior and returns the authoritative snapshot. The
correction additionally carries the evaluator's stable `{ code, message }`
reason. The reason is informational only: it does not become part of canonical
snapshot state, alter idempotency, or weaken the rollback guarantee.

### Capability-projection prerequisite

The Gen III adapter must project the save-progression signals required by these
policies: `ordinaryTradeReady`, `nationalDexUnlocked`, and
`networkMachineRestored`. Snapshot enforcement becomes authoritative only when
this projection comes from the validated native save selected by the adapter.
It must never infer a positive progression state from a title, source key, or
client request. A missing, invalid, or internally inconsistent native save does
not grant a capability.

### Native Generation III save capability extraction

This is a read-only projection. It reuses the adapter's existing validation and
newest-copy selection for the 128 KiB Generation III save, then reads logical
save sections from that selected sector set. It does not use PKHeX as a runtime
dependency and does not write a byte to the save.

```text
verified ROM/catalog title
  -> validated newest native save copy
    -> section 0 (Small) and sections 1..4 (Large)
      -> GenerationIIITransferCapabilities
        -> shared transfer-rule evaluator
```

The save alone is not the title authority. Ruby and Sapphire share the relevant
save layout, as do FireRed and LeafGreen. The existing verified ROM/catalog
metadata selects one of the five title profiles; the selected profile then
defines how its native bytes are interpreted.

The reader addresses logical sections, not their incidental physical order in
the file:

- logical section `0` is the Small block;
- logical sections `1..4` concatenate into the Large block, using `0xF80`
  bytes per section;
- event flag `n` is bit `n % 8` of `eventFlagBase + floor(n / 8)`;
- work value `n` is a little-endian `uint16` at
  `eventWorkBase + (n * 2)`.

The following table is the normative title-profile mapping. Values are native
offsets/identifiers, expressed in hexadecimal.

| Title | Ordinary-trade flag | National-Dex magic | National-Dex flag | National-Dex work | Event-flag base | Event-work base | Network Machine flag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ruby | `0x801` | Small `0x1A = 0xDA` | `0x836` | `0x46 = 0x0302` | `0x1220` | `0x1340` | n/a |
| Sapphire | `0x801` | Small `0x1A = 0xDA` | `0x836` | `0x46 = 0x0302` | `0x1220` | `0x1340` | n/a |
| Emerald | `0x861` | Small `0x1A = 0xDA` | `0x896` | `0x46 = 0x0302` | `0x1270` | `0x139C` | n/a |
| FireRed | `0x829` | Small `0x1B = 0xB9` | `0x840` | `0x4E = 0x6258` | `0x0EE0` | `0x1000` | `0x844` |
| LeafGreen | `0x829` | Small `0x1B = 0xB9` | `0x840` | `0x4E = 0x6258` | `0x0EE0` | `0x1000` | `0x844` |

`ordinaryTradeReady` is the title profile's ordinary-trade flag. This models
the Pokédex prerequisite used by each title's Cable Club flow; party-size and
party-Egg prerequisites remain transaction-level checks, not persistent save
flags.

`nationalDexUnlocked` is true only when **all three** title-profile National
Dex values match: magic byte, event flag, and work value. This mirrors the game
function rather than treating the magic byte by itself as conclusive. A partial
or modified state therefore evaluates as locked, which is also how the game
would evaluate it.

`networkMachineRestored` is the FireRed/LeafGreen flag `0x844`. It is `null`
for Ruby, Sapphire, and Emerald. The flag is deliberately independent of the
National-Dex triple: FireRed/LeafGreen may have a National Dex before Celio's
Network Machine is restored.

The Pokémon-record decoder may additionally project `isEgg` and `metGame` from
the decrypted PK3 record. Those fields are useful for classifying the offered
record, but `metGame` never replaces the immutable Hub passport as provenance.

### Layout-response projection

When the Pokémon Hub loads a game save's Party and Boxes, the backend includes
the read-only semantic projection alongside that layout:

```ts
{
  layout: { /* existing public layout metadata */ },
  transferCapabilities: GenerationIIITransferCapabilities,
  party: /* existing public slots */,
  boxes: /* existing public slots */
}
```

Raw native offsets, magic bytes, event flags, work values, sector metadata, and
save bytes never cross this boundary. The frontend retains
`transferCapabilities` with the loaded save layout so the later shared rule
evaluator can use it for advisory drag feedback. This delivery stage only reads
and projects the data; authoritative snapshot placement enforcement remains a
subsequent integration step.

### Workspace drag feedback

- With two game saves and no Hub pane, a Pokémon that cannot be placed in the
  other visible save is not draggable. Its sprite receives a red block icon.
- With a Hub pane plus one or two save panes, and with any workspace whose
  candidate destinations have different permissions, an impossible destination
  presents a black opaque overlay covering that destination container. The
  overlay centers the evaluator message. Dropping there leaves the Pokémon at
  its origin; no optimistic candidate is submitted.
- If every available destination rejects a Pokémon for the same rule, the
  sprite uses the disabled drag and red block-icon treatment instead of showing
  redundant overlays.
- Frontend feedback is advisory. Every accepted placement still passes the
  backend evaluator before canonical commit.

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
  Until then Emerald can exchange only non-Egg Hoenn-Dex species with Ruby or
  Sapphire, and cannot link to FireRed/LeafGreen. Exact same-title Emerald
  trades use the final-population rule instead.
- **FireRed/LeafGreen:** it becomes true only after Hall of Fame entry, owning
  at least 60 Kanto species, visiting One Island, and speaking with Professor
  Oak in Pallet Town. Until then a Kanto-to-Kanto link accepts only non-Egg
  Kanto-Dex species between FireRed and LeafGreen and cannot link to Hoenn
  titles. Exact same-title FireRed or LeafGreen trades use the final-population
  rule instead.

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

Every different-title row first requires `ordinaryTradeReady` on both saves.
The exact same-title row instead requires only that the completed transaction
leave at least one Pokémon in each participating save. “Regional only” means
the moved record must be non-Egg and its species must be in the stated regional
allowlist. A directional move must satisfy the rule at *both ends*: an Emerald
source without National Dex cannot send an Egg or non-Hoenn species, even where
the destination would accept it.

| Save pair | Required capabilities | Allowed move before every listed capability is true | Allowed move once requirements are true |
| --- | --- | --- | --- |
| Exact same title: Ruby↔Ruby, Sapphire↔Sapphire, Emerald↔Emerald, FireRed↔FireRed, or LeafGreen↔LeafGreen | Completed transaction leaves at least one Pokémon in each save | Unrestricted, including Eggs | Unrestricted, including Eggs |
| Ruby ↔ Sapphire | No National Dex requirement | Unrestricted, including Eggs | Unrestricted, including Eggs |
| Ruby/Sapphire ↔ Emerald | Emerald `nationalDexUnlocked` | Regional only: Hoenn, non-Egg | Unrestricted |
| FireRed ↔ LeafGreen | Both saves `nationalDexUnlocked` | Regional only: Kanto, non-Egg | Unrestricted |
| Ruby/Sapphire ↔ FireRed/LeafGreen | The FireRed/LeafGreen save has `nationalDexUnlocked` **and** `networkMachineRestored === true` | No link; reject every move | Unrestricted |
| Emerald ↔ FireRed/LeafGreen | Emerald `nationalDexUnlocked`; FireRed/LeafGreen `nationalDexUnlocked` and `networkMachineRestored === true` | No link; reject every move | Unrestricted |

For the two mixed rows, a Ruby/Sapphire save's `nationalDexUnlocked` is never
an additional requirement. The FireRed/LeafGreen Network Machine requirement
applies whether that save is source or destination.

## Directional evaluation

A pair is not approved merely because the receiving save would accept the
record. The offered record must be legal for the `source` save to send and for
the `destination` save to receive. The final permitted set is therefore the
intersection of the two endpoint rules. This makes the final outcome symmetric
for the pairs below, while preserving the direction that identifies which
endpoint's local rule rejected an offered record.

| Direction | Source-side constraint | Destination-side constraint | Result before the relevant unlocks |
| --- | --- | --- | --- |
| Exact same title, in either direction | Final transaction may not leave this save without a Pokémon | Final transaction may not leave this save without a Pokémon | Any species or Egg is allowed when both saves retain at least one Pokémon. |
| Ruby → Sapphire; Sapphire → Ruby | Ordinary trade readiness | Ordinary trade readiness | Any species or Egg is allowed. Ruby/Sapphire National Mode is irrelevant. |
| Ruby/Sapphire → Emerald | Ordinary trade readiness | Emerald without National Dex accepts only non-Egg Hoenn species | An Egg or non-Hoenn species is rejected by Emerald as destination. |
| Emerald → Ruby/Sapphire | Emerald without National Dex may send only non-Egg Hoenn species | Ordinary trade readiness | An Egg or non-Hoenn species is rejected by Emerald as source. |
| FireRed → LeafGreen; LeafGreen → FireRed | The sending FR/LG save without National Dex may offer only non-Egg Kanto species | The receiving FR/LG save without National Dex may receive only non-Egg Kanto species | Both endpoint rules must pass; Egg and non-Kanto species are blocked. |
| Ruby/Sapphire → FireRed/LeafGreen | Ordinary trade readiness | FR/LG must have National Dex and restored Network Machine | No link until the FR/LG destination satisfies both gates. |
| FireRed/LeafGreen → Ruby/Sapphire | FR/LG must have National Dex and restored Network Machine | Ordinary trade readiness | No link until the FR/LG source satisfies both gates. |
| Emerald → FireRed/LeafGreen | Emerald requires National Dex | FR/LG requires National Dex and restored Network Machine | No link until all listed gates hold. |
| FireRed/LeafGreen → Emerald | FR/LG requires National Dex and restored Network Machine | Emerald requires National Dex | No link until all listed gates hold. |

### Emerald summary

- **Emerald↔Emerald:** as an exact same-title trade, the only constraint is
  that the final transaction retain at least one Pokémon in each save; Eggs
  are permitted.
- **Ruby/Sapphire↔Emerald:** both saves need ordinary trade readiness. An
  Emerald save without National Dex blocks an Egg and every non-Hoenn species
  both outbound and inbound. After its National Dex unlocks, that Emerald
  endpoint imposes no regional species or Egg restriction.
- **Emerald↔FireRed/LeafGreen:** both saves need ordinary trade readiness.
  Emerald must have National Dex in either direction; the FR/LG endpoint must
  have both National Dex and the restored Network Machine in either direction.
  After those gates hold, Eggs and all Gen III species are permitted.

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
2. Every exact same-title pair accepts any species, including an Egg, without
   ordinary trade readiness, National Dex, or Network Machine, provided the
   completed transaction leaves at least one Pokémon in each save.
3. Ruby↔Sapphire accepts an Egg and a non-Hoenn species when both saves have
   ordinary trade readiness, regardless of either save's National Mode.
4. An Emerald endpoint without National Dex rejects a Chikorita and every Egg,
   but accepts a non-Egg Abra or Treecko when paired with Ruby or Sapphire and
   baseline readiness is true.
5. A FireRed/LeafGreen endpoint without National Dex accepts only non-Egg
   Kanto species with another FireRed/LeafGreen endpoint; it rejects Crobat
   and Eggs even though Zubat/Golbat are Kanto members.
6. A FireRed/LeafGreen endpoint with National Dex but without the restored
   Network Machine rejects every Ruby/Sapphire/Emerald pairing in either drag
   direction.
7. Emerald↔FireRed/LeafGreen passes only after both relevant National Dex
   conditions and the FireRed/LeafGreen Network Machine condition hold.
8. Every rejection is side-effect free and uses the existing canonical snapshot
   correction behavior; a valid transfer continues to the normal session,
   persistence, and deferred materialization path.
9. Directional coverage proves both Ruby/Sapphire→Emerald and
   Emerald→Ruby/Sapphire reject an Egg and a non-Hoenn species when Emerald
   lacks National Dex, identifying Emerald as destination in the first case and
   source in the second.
10. Directional coverage proves Emerald→FireRed/LeafGreen and
    FireRed/LeafGreen→Emerald both require Emerald National Dex plus the FR/LG
    National Dex and Network Machine gates before any record, including an Egg,
    can cross the pair.
11. Hub export coverage proves that a pre-National-Dex Emerald or FR/LG save
    cannot place an Egg or an out-of-region species in the Hub, while Ruby and
    Sapphire can place either; no export may leave its source save empty.
12. Hub import coverage proves destination-only receiving rules: a
    pre-National-Dex Emerald accepts only non-Egg Hoenn species and a
    pre-National-Dex FR/LG accepts only non-Egg Kanto species, even when the
    Hub passport came from the same title.
13. A Hub passport first admitted from Ruby, Sapphire, or Emerald still
    requires the Network Machine when imported into National-Dex-enabled
    FireRed/LeafGreen, even after the Pokémon has been withdrawn to and
    re-admitted from an intermediate game save.
14. Fixtures for all five title profiles prove the exact ordinary-trade flag,
    National-Dex triple, and (for FireRed/LeafGreen) Network Machine flag.
15. A fixture with only the National-Dex magic byte, only its flag, or only its
    work value never projects `nationalDexUnlocked: true`.
16. Save-reader tests prove that logical section selection follows the
    validated newest sector copy, rather than a physical sector position.

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
- The reconstructed [Pokémon FireRed data structure](https://github.com/pret/pokefirered/blob/master/include/pokemon.h)
  identifies the Gen III `otId`, `metGame`, and `isEgg` fields. The exact
  same-title final-population rule is a product decision for Pokémon Hub.
- [PKHeX's Generation III save model](https://github.com/kwsch/PKHeX/blob/master/PKHeX.Core/Saves/SAV3.cs)
  documents the logical Small, Large, and storage blocks used by the reader;
  its title-specific block implementations document the event-flag and work
  bases.
- The reconstructed game sources define the actual National-Dex predicates for
  [Ruby/Sapphire](https://github.com/pret/pokeruby/blob/master/src/event_data.c),
  [Emerald](https://github.com/pret/pokeemerald/blob/master/src/event_data.c),
  and [FireRed/LeafGreen](https://github.com/pret/pokefirered/blob/master/src/event_data.c).
  FireRed/LeafGreen's [One Island script](https://github.com/pret/pokefirered/blob/master/data/maps/OneIsland_PokemonCenter_1F/scripts.inc)
  establishes the separate Network Machine progression flag.
