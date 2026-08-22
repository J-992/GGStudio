# Asset Licenses

Every asset shipped in this game is listed here. Nothing ships without an entry.

> ## ⚠ UNRESOLVED — BLOCKS RELEASE
>
> The character sprites in `public/assets/game.png` were supplied as two sheets
> (`assset_ninja_1.jpeg`, `asset_ninja_2.jpeg`) with **no provenance**. Their author,
> origin and license are unknown and unverified.
>
> They are fine for private playtesting. **Do not publish to CrazyGames, itch.io or
> anywhere else until each sprite is confirmed as original, CC0, or properly licensed**,
> or replaced. CrazyGames requires a license entry for every shipped asset.
>
> To fall back to the original code-drawn art at any time, set `mode: 'placeholder'`
> in `src/render/atlasConfig.ts` — no other change is needed.

## Graphics

| Asset | File | Source | License |
|---|---|---|---|
| Ninja tiers 1–12 (`ninja_t1`–`ninja_t12`) | `public/assets/game.png` | Supplied pixel-art sheets, sliced by `tools/extract_sprites.py` | **UNVERIFIED — see warning above** |
| Stage bosses (`enemy_0`–`enemy_5`) | `public/assets/game.png` | Supplied pixel-art sheets, sliced by `tools/extract_sprites.py` | **UNVERIFIED — see warning above** |
| FX frames (coin, star, puff, spark, ring, slash) | `public/assets/game.png` | Original shapes drawn by `tools/pack_atlas.py` | Original work, © Reaper8202 |
| Animated combat, merge, smoke, portal, flame, lightning and shockwave strips | `public/assets/vfx/*.png` | AI-generated via OpenAI image generation using the game's dojo, ninja and boss art as style references; chroma-matted and normalized locally into eight equal frames | Original project assets, © Reaper8202; each RGBA strip is 2048×256 with eight equal 256×256 frames |
| Fallback ninja/enemy art | generated at runtime by `src/render/PlaceholderAtlas.ts` | Original programmatic art, drawn by code at boot | Original work, © Reaper8202 |
| UI shapes, slot rings, buttons, arena scenery | drawn with Phaser Graphics at runtime | Original programmatic art | Original work, © Reaper8202 |
| Trash bin, almanac book, coin, clock, potion icons (`icon_trash`, `icon_book`, `icon_coin`, `icon_clock`, `icon_potion`) | `public/assets/game.png` | Drawn pixel by pixel in `tools/make_icons.py` | Original work, © Reaper8202 |
| Game icon / favicon (masked ninja bust) | `public/favicon.png`, `public/favicon-128.png`, `public/logo-512.png` | Drawn pixel by pixel on a 16×16 grid in `tools/make_icon.py`; every export is an integer nearest-neighbour upscale of that grid | Original work, © Reaper8202 |
| Powerup icons (Shuriken Frenzy, Smoke Bomb, Lucky Charm, Protective Ward, Coin Frenzy) | `public/assets/powerups/*.png` | AI-generated via OpenAI image generation, then cropped and point-downsampled for the game | Original project assets, © Reaper8202 |
| New Ninja ceremony set (backdrop, halo, plinth, banner, button) | `public/assets/ui/new-ninja-reveal-*.png` | AI-generated via OpenAI image generation, then cropped and point-downsampled for the game | Original project assets, © Reaper8202 |
| Achievements trophy icon (`icon_achievements`) | `public/assets/ui/icon-achievements.png` | AI-generated via Higgsfield (`nano_banana_pro`), then white-keyed to transparency, cropped and point-downsampled to 30×30 for the game | Original project assets, © Reaper8202 |
| Fifteen bespoke eight-frame boss combat cycles | `public/assets/boss-motion-a22.png`–`boss-motion-a24.png`, `boss-motion-a26.png`–`boss-motion-a37.png` | AI-assisted identity-preserving animation via OpenAI image generation; chroma-matted and packed locally | Original project assets, © Reaper8202; each RGBA strip is 2048×256 with eight equal 256×256 frames |
| Four later-act arena backdrops (Mountain Temple, Storm Sea, Rift, Dragon Shrine) | `public/assets/arena-mountain.png`, `arena-storm.png`, `arena-rift-stage.png`, `arena-shrine.png` | AI-generated via OpenAI image generation using the stage-1 dojo backdrop as the authoritative style, detail, lighting and composition reference | Original project assets, © Reaper8202 |
| Five themed perspective floor strips | `public/assets/floor-*.png` | Deterministic procedural pixel art from `tools/make_floors.py`; Storm and Rift reuse the Dragon Shrine slab construction with their own palettes | Original work, © Reaper8202 |
| Arena cloud overlay | `public/assets/arena-cloud-bank.png` | Existing project art reused as a subtle runtime atmosphere layer by `ArenaScenery` | See the pre-existing asset's provenance |

## Audio

| Asset | File | Source | License |
|---|---|---|---|
| All SFX (click, coin, pickup, merge, hit, strong hit, defeat, new-tier fanfare, boss defeat) | synthesized at runtime by `src/audio/Sfx.ts` | Original procedural WebAudio synthesis | Original work, © Reaper8202 |
| Music theme ("Merge Ninja" chiptune loop: lead, bass, arpeggio, drums) | synthesized at runtime by `src/audio/Music.ts` | Original procedural WebAudio synthesis | Original work, © Reaper8202 |

No audio files are bundled; both the sound effects and the music loop are synthesized in the browser.

## Fonts

| Asset | File | Source | License |
|---|---|---|---|
| MergeNinjaPixel bitmap font | `public/assets/font.png`, `public/assets/font.xml` | Letterforms authored pixel by pixel in `tools/make_font.py`; not derived from any existing typeface | Original work, © Reaper8202 |

The HTML shell falls back to the system UI font stack (`system-ui`, `-apple-system`, `Segoe UI`, `Roboto`, sans-serif). No TTF/OTF font files are bundled.

## Code

| Package | License |
|---|---|
| Phaser 3 | MIT |
| Vite, TypeScript, ESLint, Vitest | MIT / Apache-2.0 (see `node_modules/<pkg>/LICENSE`) |

Build tooling is not shipped to players; only Phaser is bundled into `dist/`.
