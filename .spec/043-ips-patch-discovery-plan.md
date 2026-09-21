# Generic IPS patch discovery implementation plan

Spec: [043-ips-patch-discovery.md](043-ips-patch-discovery.md)

## Tasks

1. Add failing package tests for versioned registry lookup by ROM SHA-256,
   IPS-format validation, duplicate associations, unsafe/missing files, and
   integrity mismatch.
2. Implement a reusable IPS registry/validator in `apps/packages/`; remove the
   game-specific static ROM mapping.
3. Register the existing Emerald IPS through `assets/ips/manifest.json` and
   preserve production asset copying.
4. Add failing backend HTTP integration tests for generic patch discovery,
   launch descriptors, patch delivery, and optional failure fallback.
5. Update backend launch, lease, snapshot, and patch-serving paths to use the
   registry and keep the ROM launchable when an optional patch is skipped.
6. Update frontend contract tests and startup handling for patch fetch/hash
   failures and incompatible snapshots.
7. Update backend documentation and run package, backend, and frontend tests;
   do not run builds.

## Review focus

- The registry association uses verified ROM bytes, never title, game ID, or
  ROM filename.
- A malformed IPS or optional asset failure cannot mark the underlying ROM
  unavailable.
- Unsafe patch paths and symlinks never escape the patch directory.
- A failed patch fetch cannot prevent the emulator from starting unpatched.
