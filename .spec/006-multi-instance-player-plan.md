# Multi-instance Player Implementation Plan

**Goal:** Run up to four independently profile-scoped EmulatorJS iframes in one player surface.

**Spec:** [.spec/006-multi-instance-player.md](006-multi-instance-player.md)

## Tasks

1. Replace the singular frontend player-session state with an ordered list of instances; retain the existing verified launch request for every addition.
2. Add a title-first selection step to the player action bar. Reuse the profile selector after filtering profiles already used by active instances.
3. Render the session as a zero-gap, two-column iframe grid and size its outer surface by instance count so every cell stays 3:2.
4. Verify the title/profile sequence and two-, three-, and four-instance geometry in the browser. Run the backend test suite. Do not run a project build.
