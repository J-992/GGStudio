# Press kit

Everything here is generated from the running game by the three scripts in
`tools/`. Nothing is hand-drawn, and no image is checked in that a script
cannot reproduce.

| folder | what | shot by |
| --- | --- | --- |
| [`thumbnail/`](thumbnail/) | 15 square (1:1) gameplay plates, 1440² and 1024², with and without HUD, plus the 16:9 frame each was cut from | `tools/thumbshots.mjs` |
| [`assets/`](assets/) | every texture the game builds at runtime, as transparent PNGs, plus all 16 runner animation frames and a contact sheet | `tools/assetdump.mjs` |
| [`cutouts/`](cutouts/) | the runners and the cord on transparent backgrounds, for compositing | `tools/cutouts.mjs` |
| [`screens/`](screens/) | the title and level-select screens, 16:9 | `tools/thumbshots.mjs` |

All three need a static server on `:8123`, plus `playwright-core` and a
Chromium build -- the executable path is at the top of each script. The game
itself still has no dependencies, so install the driver without writing it into
`package.json`:

```
npm i playwright-core --no-save
npm run dev
node tools/thumbshots.mjs      # -> docs/thumbnail/raw + docs/screens
node tools/assetdump.mjs       # -> docs/assets
node tools/cutouts.mjs         # -> docs/cutouts
```

`ONLY=slalom,tangle node tools/thumbshots.mjs` reshoots named plates and skips
the menus, which is the fast path when one plate needs another take.

`thumbshots.mjs` writes 1440² squares into `docs/thumbnail/raw`; the curated
copies in `docs/thumbnail` (and the 1024² downscales) were sorted by hand.

## assets/

`TextureFactory` draws bolt, gear, pad glyph, shadow, clouds, spark, puff,
confetti and the touch controls into canvases at boot -- they exist nowhere as
files, so `assetdump.mjs` pulls them back out of Phaser's texture manager.
Small textures also get an `@4x` copy. The two runner sheets (`assets/runnerA
.png`, `runnerB.png`, 8 frames of 200x240 each) are the only art on disk;
`runner-frames/` splits them into single frames.

## cutouts/

`pair-leap`, `pair-launch`, `pair-chase`, `pair-run` are both runners plus the
cord; `runner-a`, `runner-b` and their `-run` variants are one runner alone.
Transparent PNGs at 3x, shot by rebuilding the game on a transparent canvas
with the course, sky and HUD hidden.
