# Unshipped art

Generated roster art that nothing in `src/` loads.

These 114 files used to sit in `public/assets/`, which meant Vite copied all
4.3 MB of them into every build — a portal upload was carrying a roster no
player could ever reach. Every runtime load in the game is static and
enumerated (`BootScene.preload`, `atlasConfig`, `revealAssets`, `powerups`,
`vfxAssets`), so the set that is actually reachable can be computed exactly;
these are what was left over.

What is here:

| Group | Files | Why it is unused |
| --- | --- | --- |
| `boss-catalog-01..24`, `29..30` | 26 | `BOSS_CATALOG_PORTRAITS` wires up 25–39 only |
| `ninja-catalog-*` | 29 | superseded by the motion strips for those tiers |
| `provided-ninja-*`, `provided-boss-*` | 34 | raw drops that were never packed into a catalog slot |
| `ninja-ready-t*`, `boss-ready-*`, `boss-rig-*` | 23 | earlier pose passes, replaced by `*-motion-*` |
| `tex/tex_wall.png` | 1 | written by `tools/extract_generated.py`, never loaded |

Nothing here is deleted, because wiring a tier up later is a one-line change in
`src/render/atlasConfig.ts` — move the file back into `public/assets/`, run
`tools/optimize_assets.sh` to convert it to WebP, and add its `portrait(...)`
entry. `tests/assets.test.ts` will then hold it to existing on disk.

These are still PNG. The shipped art is WebP; see `tools/optimize_assets.sh`.
