# Spec 016 — Hub layout categories

## Responsive catalog container

The fixed sidebar is excluded when centering the catalog: its content area
starts after the sidebar and is centered within the remaining viewport width.
On wide desktops, the catalog container is capped at 1400px; below that cap it
uses responsive outer gutters. Game Boy Advance cards share the available row,
with a 210px minimum that triggers wrapping only on narrower viewports. The
internal Pokemon Hub card remains compact instead of stretching across a row.

Acceptance: at a 1920px viewport the content is centered after the 64px sidebar
and the five known GBA titles appear in one row; mobile cards may wrap after
reaching their minimum width.

The category divider fills the remaining desktop container width. At the mobile
breakpoint it reverts to a 70% flex basis so the header stays compact.

## Profile picker placement

When a ready game card opens the profile picker, desktop placement is anchored
to that card instead of the viewport center. The panel left edge aligns to the
card left edge, clamped to a 16px viewport gutter; its top is offset so the
first profile row is close to the Play button and is also clamped to keep a
standard-height panel visible. This reduces pointer travel without obscuring or
changing the game card, profile, launch, or keyboard flows. At 680px and below,
the picker retains its centered modal placement because the anchored panel
would not have enough horizontal room.

Acceptance: clicking Play from either end of a wide GBA row opens the profile
picker close to the originating card while staying fully within the viewport;
clicking Play on a narrow viewport opens the existing centered picker.

The picker uses the card left edge for horizontal placement and the Play button
for vertical placement. It opens below the button when the available lower area
can fit the standard panel, otherwise it opens upward with its bottom 12px above
the button. The chosen direction has a 16px viewport safety gutter and the
panel itself never creates document scrolling.

The profile list shows at most five complete 46px profile rows (232px including
its border). A sixth or later profile activates the list's own scrollbar; the
modal container does not scroll merely because profiles are added. This keeps
the existing title text, profile actions, and creation controls unchanged.

Acceptance: a low card opens its picker upward and a high card opens it
downward; both remain inside the viewport. Five profiles fit with no list
scrollbar, and a sixth profile scrolls inside the list only.

The hub catalog is rendered in simple visual categories. The first category is
`Aplicações internas` and contains only the local Pokémon Hub card. The second
category is `Game Boy Advance` and contains every catalog game whose system is
`gba`.

`apps/frontend/src/hub-layout.json` is the temporary layout source. It stores
the GBA release-order override: Ruby, Sapphire, Emerald, FireRed, LeafGreen.
Known IDs follow this sequence; a future unlisted GBA game remains visible in
the same category after those entries, sorted by title. The JSON is not a game
catalog and does not replace backend identity or ROM validation.

Each category begins with only text and a horizontal divider. The divider has a
70% responsive flex basis, so it stays proportional rather than becoming an
unbounded line on smaller displays. Existing cards, covers, launch/profile
flows, and the Pokémon Hub modal remain unchanged.

Acceptance: the Pokémon Hub is under `Aplicações internas`; the five current
GBA cards are ordered Ruby, Sapphire, Emerald, FireRed, LeafGreen; unlisted GBA
games remain visible after the ordered entries; no other system is shown in the
GBA category; no build is required.
