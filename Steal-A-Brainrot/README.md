# Brainrot Defense

A Plants-vs-Zombies-style lane defense for Poki: plant Italian brainrot
characters on a 6-lane lawn, tap the brainz that Cocofanto Elefanto trumpets
out, and stop the EVIL brainrots marching in from the right. Phaser 3,
responsive portrait AND landscape, no backend, no login.

The roster is the Italian brainrot meme cast — Tralalero Tralala, Bombardiro
Crocodilo, Tung Tung Tung Sahur, Ballerina Cappuccina, La Vacca Saturno
Saturnita and friends — 20 of them across 7 rarities, drawn from real
character artwork. The enemies are the same cast gone bad: dark-tinted
mirror versions of the sprites. See the licensing note at the bottom.

## Run it

Serve the folder with any static server and open it:

```bash
npx http-server -p 8091 -c-1 .
```

Audio is synthesised at runtime and the art falls back to procedurally-drawn
placeholders, so the game runs from any static server with zero assets. Add
`?settimeout` to the URL in webviews that never deliver requestAnimationFrame.

## The loop

1. **Plant** brainrots from the card bar onto the 6x9 lawn — drag a card to a
   cell, or tap the card then the cell. Every card shows its brainz cost and
   recharges after use. The shovel digs mistakes back up.
2. **Collect brainz** (the PvZ sun): Cocofanto Elefanto pops out 25 every 7s,
   the sky drops a freebie on a timer, untapped tokens fade. All planting is
   paid in brainz; brainz die with the level.
3. **Defend**: evil brainrots walk right-to-left and chew whatever they hit.
   Every active lane has a one-shot **moped** parked on the left — the
   lawnmower. A breach with the moped spent loses the level.
4. **Earn coins**: every kill pays coins, banked when the level is won (plus
   a clear bonus). Coins persist.
5. **Shop & squad (HQ)**: between levels, buy new brainrots with coins and
   pick a squad of up to 6 for the next level. Locked brainrots show as
   silhouettes with price tags.
6. 10 authored levels — level 1 is the tutorial on a two-lane lawn, EVIL TUNG
   TUNG minibosses from level 5, MEGA BOMBARDIRO boss at 10, endless scaling
   after.

## The roster (roles)

Every brainrot has one obvious job, PvZ-style:

- **producer** — Cocofanto Elefanto, the money elephant (the sunflower)
- **shooter** — Trippi (peashooter), Boneca (knockback), Octopussini (slow
  goo), Orangutini (double shot), Bobritto (gatling), Patapim (pierces the
  whole lane), Chimpanzini (banana barrage), Tralalero (mythic shredder)
- **wall** — Troppa Trippa, 1600 hp of tripe
- **mine** — Burbaloni bellyflop trap, arms then one-shots a pack
- **melee** — Trulimero spin, Tung Tung Tung Sahur's bat
- **lobber** — Lirili (slowing splash), Girafa (melon-pult), Bombardiro
  (bombs the densest pack anywhere)
- **ring** — Ballerina, Udin (knockback drums), La Vacca (secret, grinds
  everything near her)
- **sniper** — Cappuccino Assassino, blades the beefiest enemy on the lawn

`tools/check.mjs` enforces the data contract: valid roles and stats, free
starters that cover the tutorial (producer + shooter), shop prices that climb
with rarity, level recipes that only reference real enemies and active lanes,
and sane zone geometry in both orientations.

## Controls

Everything is drag-and-drop / tap. No keyboard needed (Space/Enter start the
game from the menu).

## Responsive layout

`src/systems/Layout.js` derives a design resolution from the window aspect
(720-wide portrait, 1440-wide landscape), Phaser FITs it, and every widget
re-anchors in `relayout()` when the window resizes or rotates. Lanes stay
horizontal in both orientations; enemy speed scales with lawn length so
crossing time is constant. The tutorial hand is the merge-ninja pointing hand
(`assets/ui/tutorial-hand.webp`), with a procedural fallback.

## Poki SDK

`src/systems/PokiSDK.js` wraps the SDK; every call no-ops when the SDK is
absent or blocked, so the game is fully playable off-platform.

- `gameLoadingStart/Finished` around boot; `gameplayStart/Stop` gated on the
  first real player input (never the first frame), and paused by any modal
- **Interstitial**: only on RETRY / back-to-HQ transitions, never around the
  tutorial's first clear — the first tap is the hook, not a natural break
- **Rewarded**: the defeat-screen lawn-clear revive (one per level); nothing
  requires an ad
- `happyTime` on boss kills and level clears

## Save data

`localStorage` under `brainrot-defense-v1`. Coins, the unlocked roster, the
last squad, the next level, tutorial flag, mute and stats. Levels are short,
so there is no mid-level snapshot — a reload restarts the level.

## Structure

```
src/Config.js            all balance constants (grid, brainz, waves, ads)
src/systems/Layout.js    responsive zone geometry (the only screen-size authority)
src/data/creatures.js    20 brainrots: roles, costs, hp, shop prices
src/data/enemies.js      7 evil brainrots + the boss (tinted roster sprites)
src/data/levels.js       10 authored level recipes
src/systems/             Save, Audio (procedural), Poki, Textures, Effects
src/game/                Economy, Lawn, EnergySystem, CardBar, Combat,
                         WaveDirector, Tutorial, HUD
src/scenes/              Boot -> Menu -> HQ (squad + shop) <-> Game
tools/                   check.mjs (data + Poki gate), build-poki.mjs, packaging
assets/                  manifest.json + rendered creature sprites + the hand
```

The lawn is data (`Lawn.grid[lane][col]`); sprites hang off each unit and
never own gameplay state. Enemies stop and chew when a unit blocks their
mouth, mines detonate on contact, mopeds ride the lane once.

## Art

The 20 creatures are real rendered sprites from `art/source/` (352x352, feet
on the bottom edge, loaded via `assets/manifest.json`); any key that fails to
load falls back to its procedural placeholder in `TextureFactory.BODIES`.
Enemies reuse the same sprites flipped and dark-tinted, so new enemy types
are one data entry.

```bash
node tools/import-art.mjs --apply     # rebuild creature sprites from art/source/
node tools/import-art.mjs --manifest  # rescan sprites, rewrite the manifest
```

## Licensing note on the characters

The Italian brainrot characters are AI-generated internet memes. Several have
identifiable original creators (Tralalero Tralala -> TikTok @eZburger401,
Tung Tung Tung Sahur -> @noxaasht), and there is no clean public licence
covering the names or designs. Names are display text only — nothing keys off
them, so a rename is a one-line change in `src/data/creatures.js`.
