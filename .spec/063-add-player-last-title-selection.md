# Spec 063 — Remember the last title in the add-player picker

## Behavior

- The first time the add-player picker opens in a player session, select the first ready ROM in the existing home-screen order.
- When the user chooses another ROM tile, remember that title for later openings of the same add-player picker. Show its profiles immediately, as today.
- Reopening the picker during the same player session selects the remembered title if it is still ready. Otherwise, fall back to the first ready ROM.
- Clear the remembered title when the last emulator iframe closes. A new player session starts with the first ready ROM again.

## Boundaries

- This selection is temporary frontend state. Do not write it to backend preferences, browser storage, or a save file.
- Keep the home-screen launch picker, profile selection, catalog order, and active player instances unchanged.
