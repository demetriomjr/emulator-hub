# Spec 064 — Confirm header preferences when closing the player session

## Behavior

- Header preference changes continue to persist when selected.
- When the close action selects every remaining emulator, enqueue one final update containing the header's current speed, Fast Forward, mute, L2, and R2 values. Existing queued preference updates must finish first so this final snapshot wins.
- Wait for the final preference update alongside game save/close work. A preference failure uses the existing preference error display but does not prevent game saves, lease release, or closing the player session.
- Closing only some emulators leaves global preferences untouched.

## Boundaries

- Do not alter game saves, snapshots, odds counts, or the meaning of any trigger action.
- This final sync confirms the values shown in the header. It cannot detect an unintended selection that already changed those values.
