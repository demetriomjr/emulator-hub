# Spec 065 — Keep the add-player picker open

## Behavior

- Selecting a profile from the add-player picker launches its emulator and leaves the picker open while fewer than six player instances exist.
- The selected ROM and profile list remain visible. A newly launched profile is shown as running and cannot be launched a second time.
- The player can choose another ROM or profile without reopening the picker. After the sixth emulator launches successfully, close the picker automatically.
- The add-player picker's existing close control displays the text “Fechar” and dismisses the picker whenever the player is done adding instances.
- The home-screen profile picker continues to close after launching its first emulator.

## Boundaries

- Preserve profile lease validation, recovery, save behavior, and the six-instance limit. A failed launch leaves the picker open with its error.
- Do not add another modal or change the catalog order.
