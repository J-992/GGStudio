# Asset licenses — NINJA FLOW

Every asset in the shipped build is listed here. Nothing is loaded at runtime
from outside the bundle except the Poki SDK script, which the platform requires.

## 3D characters (hero ninjas)

| Asset | Files | Source | License |
| --- | --- | --- | --- |
| Fox ninja (rigged, animated) | `public/models/fox.glb`, `public/anims/fox.glb` | Generated with Meshy AI from the project owner's account | Owned by the project owner under Meshy's paid-plan terms; usable in commercial projects |
| Cat ninja (rigged, animated) | `public/models/cat.glb`, `public/anims/cat.glb` | Generated with Meshy AI | Same as above |
| Bunny ninja (rigged, animated) | `public/models/bunny.glb`, `public/anims/bunny.glb` | Generated with Meshy AI | Same as above |
| Masked ninja (rigged, animated) | `public/models/masked.glb`, `public/anims/masked.glb` | Generated with Meshy AI | Same as above |

The shipped GLBs are processed derivatives (mesh quantization, 1024px WebP
textures, animation resampling) produced by `tools/build-assets.mjs` from the
original exports. Originals are kept outside the repository.

## 3D environment

| Asset | Files | Source | License |
| --- | --- | --- | --- |
| Japanese bridge garden | `public/models/japanese_bridge_garden.glb` | Supplied by the project owner; converted from spec/gloss to metal/rough for Three.js compatibility | Confirm the source asset's distribution rights before publishing |

## 3D weapons

All three source packs are Creative Commons Attribution 4.0. CC-BY requires the
credit to travel with the work, so the same three lines appear in-game behind
CREDITS on the main menu — not only in this file.

| Asset | Files | Author | Source | License |
| --- | --- | --- | --- | --- |
| Low-poly Japanese Swords (katana, wakizashi, ninjato, nagamaki, tanto) | `public/weapons/{katana,katana-ornate,wakizashi,wakizashi-serrated,ninjato,ninjato-gold,nagamaki,tanto,tanto-hooked,tanto-broad}.glb` | Brunoszwa (https://sketchfab.com/BrunoszwaPl) | https://sketchfab.com/3d-models/low-poly-japanese-swords-70f72f34bc254f8dac458b5b1e2246a2 | CC-BY-4.0 |
| Katana Low poly | `public/weapons/katana-worn.glb` | Creator (https://sketchfab.com/leimoses3) | https://sketchfab.com/3d-models/katana-low-poly-9eb2c8f7b90e42f4a10ea153442bd217 | CC-BY-4.0 |
| low-poly scifi Katana | `public/weapons/katana-scifi.glb` | Max (https://sketchfab.com/maximpuzenko22) | https://sketchfab.com/3d-models/low-poly-scifi-katana-a522335c06e7432d8ab365a991e8d138 | CC-BY-4.0 |

The shipped weapon GLBs are processed derivatives produced by
`tools/build-weapons.mjs`: split out of the packs one weapon at a time,
simplified, textures compressed to 256px WebP, and normalised so the grip sits
at the origin with the blade along +Y. Originals are kept outside the
repository in `.assets_raw/weapons/`.

## Everything else is original code in this repository

| Asset | Source | License |
| --- | --- | --- |
| Enemies (all variants) | Procedural geometry, `src/game/Enemy.ts` | Original, MIT (this repo) |
| All VFX (slashes, rings, sparks, trails) | Procedural, `src/fx/VFX.ts` | Original, MIT (this repo) |
| All sound effects and music | Synthesised at runtime with WebAudio, `src/fx/Audio.ts` — no samples | Original, MIT (this repo) |
| UI, loading screen, icons | HTML/CSS/inline SVG in `src/ui/` | Original, MIT (this repo) |
| Combat/attack animations | Procedural skeletal poses, `src/game/Poses.ts` | Original, MIT (this repo) |
| Cosmetics (hats, outfits, back pieces, footwear) | Procedural geometry, `src/game/Cosmetics.ts` | Original, MIT (this repo) |
| Roster icons | Inline SVG, `src/ui/Ninjas.ts` — no emoji, so every platform shows the same mark | Original, MIT (this repo) |
| Fonts | System font stack only — no font files shipped | n/a |

## Libraries

| Library | Use | License |
| --- | --- | --- |
| three.js | Rendering | MIT |
| Poki SDK | Platform integration (loaded from Poki's CDN as required by the platform) | Poki terms |

Author/publisher alias: **Reaper8202**
