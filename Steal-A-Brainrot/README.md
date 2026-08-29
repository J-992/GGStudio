# Brainrot Merge Clash

A lightweight, highly addictive merge + wave-defense game for Poki: pull
Italian brainrot characters from the Brainrot Machine, merge duplicates into
5-star monsters, place them on a 3x3 battlefield and let them shred waves of
walking pizzas, angry espressos and pasta monsters. Phaser 3, responsive
portrait AND landscape, no backend, no login.

The roster is the Italian brainrot meme cast — Tralalero Tralala, Bombardiro
Crocodilo, Tung Tung Tung Sahur, Ballerina Cappuccina, La Vacca Saturno
Saturnita and friends — 20 of them across 7 rarities, drawn from real character
artwork. See the licensing note at the bottom before shipping.

## Run it

Serve the folder with any static server and open it:

```bash
npx http-server -p 8091 -c-1 .
```

Audio is synthesised at runtime and the art falls back to procedurally-drawn
placeholders, so the game runs from any static server with zero assets. Add
`?settimeout` to the URL in webviews that never deliver requestAnimationFrame.

## The loop

1. **Pull** the Brainrot Machine (coins): a capsule bounces through a mini
   plinko and reveals a brainrot — rarity ceremonies scale from a simple pop
   to a machine-shaking legendary reveal. Machine can also pay out coins,
   doubles, rare capsules and jackpots.
2. **Merge** two identical same-star brainrots by dragging them together:
   star up (max 5), each star multiplies damage x2.4 — a merge is always a
   +20% board upgrade over the pair it consumed.
3. **Deploy** onto the 3x3 battlefield (rows = lanes). Units auto-attack by
   archetype: dash, slam, spin, airstrike, rapid, snipe, knockback, orbit.
4. **Defend**: enemies march right-to-left; 3 lives per stage. 10 authored
   stages, boss every 5th (MEGA ESPRESSO), endless scaling after stage 10.
5. Bosses pay **tickets** — a ticket buys a guaranteed rare-or-better pull.
6. Fill the **BRAINDEX**: every brainrot, its best star level, silhouettes
   for the undiscovered.

Drag to an occupied slot swaps; same-star pairs merge; the trash bin sells.
A max-star pair trades places instead of refusing silently.

## Controls

Everything is drag-and-drop / tap. No keyboard needed (Space/Enter start the
game from the menu).

## Responsive layout

`src/systems/Layout.js` derives a design resolution from the window aspect
(720-wide portrait, 1440-wide landscape), Phaser FITs it, and every widget
re-anchors in `relayout()` when the window resizes or rotates. Portrait:
battlefield top ~57%, bench + machine below (the design doc split). Landscape:
battlefield left ~62%, bench + machine in a right column. Enemy speed scales
with lane length so crossing time is constant across orientations.

## Poki SDK

`src/systems/PokiSDK.js` wraps the SDK; every call no-ops when the SDK is
absent or blocked, so the game is fully playable off-platform.

- `gameLoadingStart/Finished` around boot; `gameplayStart/Stop` gated on the
  first real player input (never the first frame), and paused by any modal
- **Interstitial**: only on NEXT STAGE / RETRY transitions, never before the
  first stage — the first tap is the hook, not a natural break
- **Rewarded**: the defeat-screen revive (one per stage); nothing requires an ad
- `happyTime` on merges, rare pulls, boss kills and stage clears

## Save data

`localStorage` under `brainrot-merge-clash-v1`. Meta (braindex, best stars,
stats, tutorial, settings) never lives inside the run snapshot, so a future
"restart progress" can wipe the run without touching the collection. The run
(coins, tickets, stage, machine pulls, full board) is written every 8s and on
exit; defeat never wipes the board.

## Structure

```
src/Config.js            all balance constants (stars, machine odds, stage scaling)
src/systems/Layout.js    responsive zone geometry (the only screen-size authority)
src/data/creatures.js    20 brainrots + rarities + 8 attack archetypes
src/data/enemies.js      5 enemies + bosses
src/data/stages.js       10 authored stage recipes
src/systems/             Save, Audio (procedural), Poki, Textures, Effects
src/game/                Economy, BoardModel, Gacha, Combat, StageDirector,
                         BoardUI, MachineUI, Braindex, Tutorial, HUD
src/scenes/              Boot -> Menu -> Game
tools/                   check.mjs (data + Poki gate), build-poki.mjs, packaging
assets/                  manifest.json + rendered creature sprites
```

The board is data (`BoardModel`: one flat 17-slot array, 0-8 battlefield,
9-16 bench); `BoardUI` mirrors it and never owns gameplay state. A merge
destroys both unit ids and mints a new one, which is what drives the
destroy-and-respawn merge animation. `tools/check.mjs` enforces the design
rules: dps must climb with rarity, a merge must beat the pair it consumed,
every 5th stage carries a boss, and both orientations must produce
non-overlapping zones.

## Art

The 20 creatures are real rendered sprites from `art/source/` (352x352,
feet on the bottom edge, loaded via `assets/manifest.json`); any key that
fails to load falls back to its procedural placeholder in
`TextureFactory.BODIES`. Enemies are drawn procedurally (`ENEMY_BODIES`) and
can be upgraded to real art later through the same manifest path (`en_<id>`).

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
