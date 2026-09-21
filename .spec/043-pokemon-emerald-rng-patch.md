# Spec 043 — Pokémon Emerald RNG IPS patch

## Goal

Run the supplied RNG-fix IPS whenever, and only whenever, the backend launches
the exact original Pokémon Emerald dump for which the IPS was produced. The
base ROM remains unchanged on disk.

## Compatible content

The target is the No-Intro-recognized `Pokemon - Emerald Version (USA,
Europe).gba` dump. It is 16 MiB and has:

- SHA-1: `f3ae088181bf583e55daf962a92bb46f4f1d07b7`
- MD5: `605b89b67018abcea91e693a4dd25be3`
- SHA-256: `a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af`

The supplied IPS is `assets/ips/Pokemon Emerald.ips`, SHA-256
`9c3795241bc91199cbe14b53cd4934f009119f2bb3ba9d06c1af3931a19a24b6`.
The production image copies every IPS asset unchanged to
`apps/backend/patches/`, where the backend reads `Pokemon Emerald.ips` at
runtime.

No filename determines compatibility. A user may place the exact original
bytes in `apps/backend/roms/` with any safe filename; normal discovery and its
No-Intro validation decide whether it is a launchable ROM, and the SHA-256
above decides whether the RNG patch is attached. Other Emerald revisions,
hacks, translations, and unknown files never receive the patch.

## Runtime contract

EmulatorJS does not auto-discover adjacent same-name IPS files. Its documented
`EJS_gamePatchUrl` is configured independently of `EJS_gameUrl`. A launch
descriptor for the compatible dump adds `patchUrl` and `patchSha256`; all other
launch descriptors omit both fields.

The backend serves the patch only at `/roms/:id/patch`, after validating both
the selected ROM and the immutable patch asset. It sends `Cache-Control:
no-store`, binary content type, length, and `X-Content-Type-Options: nosniff`.
A missing, symlinked, non-regular, unsafe, or SHA-256-mismatched patch makes
the compatible game unavailable and unlaunchable; it must never silently run
unpatched.

The player fetches the optional patch with the ROM, verifies both declared
SHA-256 values, and supplies Blob URLs through `EJS_gameUrl` and
`EJS_gamePatchUrl` before `loader.js` starts. A failed patch request or hash
check prevents startup.

Snapshots and local runtime recovery retain the base `romSha256` and add an
optional `patchSha256`. A prior no-patch snapshot/recovery is incompatible with
a patched launch, and a changed patch is likewise incompatible. Battery saves
remain keyed by the stable game/profile identity because this patch changes
runtime code, not the original ROM identity.

## Boundaries and acceptance

- No ROM bytes are copied, modified, uploaded, or patched on the server.
- The product adds no catalog UI or manual patch selector.
- A non-target game has the unchanged launch descriptor and no patch endpoint.
- The compatible Emerald launch contains a verified patch URL/hash and the
  iframe configures EmulatorJS with it.
- Backend tests cover matching, missing/tampered assets, route metadata and
  descriptor shape. Player contract tests cover both Blob URLs and hash checks.
- No project build runs for this work.
