# Spec 006 — Multi-instance player

## Goal

Allow a running player session to open up to four EmulatorJS instances in one floating player surface. Each instance has its own title/profile identity and runs in its own iframe.

## Scope

- The player action bar contains, in order, an add-instance control, fullscreen control, and close control. The add control opens a title picker, then the existing profile picker.
- The title picker lists the ready catalog entries. The follow-up profile picker only lists profiles not assigned to an already-running instance. Creating a new profile remains available and produces an eligible profile.
- A selected title/profile pair is verified through the existing launch endpoint before an iframe is added. The existing launch descriptor supplies the profile-scoped numeric EmulatorJS game ID.
- One instance uses a 3:2 surface. Two instances occupy one horizontal row. Three instances use the first slot of a second row. Four instances occupy a two-by-two surface. Instances touch: the player surface has no outer padding and the grid has no gap.
- Every iframe remains a separate `player.html` document. EmulatorJS documentation requires iframe embedding for single-page applications, and its numeric `EJS_gameID` separates persistent saves and cached files. This preserves the current title/profile save isolation.
- The add control is disabled when four instances are running. Close ends the whole player session, as it does today. Fullscreen applies to the complete multi-instance surface.

## Boundaries

This is frontend orchestration only. The catalog, profile validation, ROM verification, launch endpoint, and EmulatorJS loader remain unchanged. There is no per-instance close control, keyboard-routing work, cloud-save work, or mobile-specific layout in this scope.

## Acceptance

1. A running emulator exposes add, fullscreen, and close controls in that order.
2. Add asks for a title before a profile and excludes every profile already used in a running instance.
3. A verified selection creates a second EmulatorJS iframe without replacing existing instances.
4. Two instances have no space between them; the third starts a new row; the fourth fills the row beside it.
5. The player surface retains a 3:2 ratio per iframe and fullscreen affects the whole surface.
6. The fifth instance cannot be started.
