# Asset notes

Every character in the game now has real art. Nothing here is outstanding —
this file records where each piece came from and how to replace it.

## What has art

| Texture keys | Source | Rebuilt by |
| --- | --- | --- |
| `cr_*` (20 creatures) | character artwork in `art/source/` | `node tools/import-art.mjs --apply` |
| `player`, `tex_bot0`…`tex_bot4` | drawn in code, `tools/draw-characters.js` | open `/tools/draw-characters.html`, save the PNGs |

The six kids are drawn rather than sourced: one `drawKid()` function with a
different palette, headwear, face and arm pose per rival, so they read as one
family. That matters more than individual detail — at the 72px they render at,
colour and silhouette are all you actually resolve. Style follows the creature
artwork: heavy ink outline, flat fill plus a single shade, no gradients.

To change one, edit its entry in the `CAST` array at the bottom of
`tools/draw-characters.js` and re-save. To replace them with sourced artwork
instead, drop PNGs named `player.png`, `tex_bot0.png` … into `art/source/` and
run `node tools/import-art.mjs --apply` — that path wins, since it writes the
same keys.

## Still procedural (and fine)

The board itself — conveyor belt, pedestals, base floors, upgrade station,
rebirth portal, coins and particles — is drawn at boot by
`src/systems/TextureFactory.js`. It reads as background, and replacing it is
optional. If you do want art for it:

- **Conveyor belt** (`belt`) — industrial toy conveyor segment, dark rubber
  belt with chevron tread, rounded steel rails, tileable horizontally.
- **Upgrade machine** (`station`) — chunky arcade vending machine, big glowing
  screen, oversized buttons, coin slot, teal and steel.
- **Rebirth portal** (`portal`) — swirling purple vortex ring on a stone
  pedestal, floating rune chunks, soft magenta glow.

Same drop-in as everything else: PNG into `art/source/` named after the key,
then `node tools/import-art.mjs --apply`.

## 3D models

`tools/render-art.mjs` renders `.glb`/`.fbx`/`.obj` from `art/models/` to the
same sprite keys, if you ever want to swap a character for a rendered model.
See `art/README.md`.
