# Brainrot Defense

A Plants-vs-Zombies-style lane defense for Poki: plant Italian brainrot
characters on a 6-lane lawn, tap the doge coins that Cocofanto Elefanto
trumpets out, and stop the monster horde marching in from the right. Phaser 3,
responsive portrait AND landscape, no backend, no login.

The roster is the Italian brainrot meme cast — Tralalero Tralala, Bombardiro
Crocodilo, Tung Tung Tung Sahur, Ballerina Cappuccina, La Vacca Saturno
Saturnita and friends — 20 of them across 7 rarities, drawn from real
character artwork. The enemies are a separate species -- slimes, sporelings,
imps, ghosts, ogres and a crowned Slime King -- so you can always tell your
lawn from theirs at a glance. See the licensing note at the bottom.

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
   cell, or tap the card then the cell. Every card shows its doge-coin cost
   and recharges after use. The shovel digs mistakes back up.
2. **Collect doge coins** (the PvZ sun): Cocofanto Elefanto trumpets out 25
   every 7s, the sky drops a freebie on a timer, untapped coins fade. All
   planting is paid in doge coins; they die with the level.
3. **Defend**: monsters walk right-to-left and chew whatever they hit.
   Every active lane has a one-shot **moped** parked on the left — the
   lawnmower. A breach with the moped spent loses the level.
4. **Earn coins**: every kill pays coins, banked when the level is won (plus
   a clear bonus). Coins persist.
5. **Shop & squad (HQ)**: between levels, buy new brainrots with coins and
   pick a squad of up to 6 for the next level. Locked brainrots show as
   silhouettes with price tags.
6. 10 authored levels — level 1 is the tutorial on a two-lane lawn, CYCLOMUNCH
   minibosses from level 7, THE SLIME KING at 10, endless scaling after.

## The difficulty ramp

The lawn opens **one lane at a time** — 2, 3, 4, 5, then 6 from level 5 — and
levels 1 and 2 both start with 125 coins. Lawn width, not enemy count, is what
sets early difficulty: every new lane is another column of plants to fund
before anything walks down it. Level 2 used to open four lanes on 75 coins,
which asked for twice the ground on 60% of the budget the level before it; that
was the wall players hit right after the tutorial.

Enemy types arrive one at a time too, each after a level of grunts-only
company: sporelings at 2, runners at 3, buckets at 4, ghosts at 5, ogres at 6,
the giant at 7. Levels can also override `prepMs` and `waveGapMs` (see
`src/data/levels.js`), which buys the early levels breathing room on the clock
instead of weaker enemies — the dial that does not make the game feel soft once
you are good at it.

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

## The tutorial (level 1)

`src/game/TutorialSystem.js` teaches the game with **no words at all** — no
copy to read, nothing to translate. Poki's audience is majority mobile, largely
kids and heavily non-English, and "PLANT COCOFANTO! HE MAKES BRAINZ!" asks a
player to read English, know which sprite is Cocofanto and know what a brainz
is before it teaches anything.

Each step instead dims the screen and cuts spotlight holes over exactly two
things — the card to touch and the cell to touch — then runs the gesture on a
loop: a pointing hand, a translucent ghost of the result standing on the target
cell, and chevrons crawling from one to the other. The waves are held back
(`director.holdPrep`) until the script finishes; the world is never frozen.

The one idea that has to land is **the elephant makes the money**, so it gets
its own step. The instant Cocofanto is planted the game forces a payout out of
him and floats a wordless recipe over his head — `[elephant] -> [doge coin]` —
so the player watches the economy happen instead of reading a claim about it.
The coin the collect step points at is spawned with `noExpire`, because a coin
that ages out mid-lesson leaves the hand tapping bare grass with no way on.

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
src/Config.js            all balance constants (grid, coins, waves, ads)
src/systems/Layout.js    responsive zone geometry (the only screen-size authority)
src/data/creatures.js    20 brainrots: roles, costs, hp, shop prices
src/data/enemies.js      7 monsters + the boss (their own en_* sprites)
src/data/levels.js       10 authored level recipes
src/systems/             Save, Audio (procedural), Poki, Textures, Effects
src/game/                Economy, Lawn, EnergySystem, CardBar, Combat,
                         WaveDirector, Tutorial, HUD
src/scenes/              Boot -> Menu -> HQ (squad + shop) <-> Game
tools/                   check.mjs (data + Poki gate), build-poki.mjs, packaging
assets/                  manifest.json + rendered sprites (creatures,
                         monsters, the doge coin) + the tutorial hand
```

The lawn is data (`Lawn.grid[lane][col]`); sprites hang off each unit and
never own gameplay state. Enemies stop and chew when a unit blocks their
mouth, mines detonate on contact, mopeds ride the lane once.

## Art

Everything on screen is a real rendered sprite (352x352, feet on the bottom
edge, loaded via `assets/manifest.json`); any key that fails to load falls back
to a procedural placeholder, so the game is playable with the art folder empty.

Three sources, all writing to `assets/sprites/`:

- **`tools/import-art.mjs`** — the 20 brainrots, from the artwork in
  `art/source/`. Fallbacks live in `TextureFactory.BODIES`.
- **`tools/render-art.mjs`** — the same, for `.glb` models in `art/models/`.
- **`tools/render-props.py`** — the monsters and the doge coin, which have no
  source model. It builds them out of primitives inside Blender and renders
  them through the same camera, lights and view transform as the characters,
  so they read as the same game. Fallbacks in `TextureFactory.MONSTERS` and
  `TextureFactory.propCoin`.

```bash
node tools/import-art.mjs --apply           # brainrots from art/source/
node tools/import-art.mjs --manifest        # rescan sprites, rewrite manifest
python tools/optimize-sprites.py --apply    # palette-quantise, ~80% smaller

# monsters + coin (Blender 4.2+; set BLENDER=<path> if it is not found)
blender -b --factory-startup --python tools/render-props.py -- \
    out=assets/sprites
```

`optimize-sprites.py` matters for Poki: the initial download has to stay under
5 MB and Phaser alone is 1.2 MB. These are flat-shaded toy models on a
transparent background, so a 128-colour octree palette is visually free and
roughly a 3x saving. The monster and coin renders ship quantised; running it
over the `cr_*` character renders too takes the build from ~4 MB to ~1.5 MB.

## Licensing note on the characters

The Italian brainrot characters are AI-generated internet memes. Several have
identifiable original creators (Tralalero Tralala -> TikTok @eZburger401,
Tung Tung Tung Sahur -> @noxaasht), and there is no clean public licence
covering the names or designs. Names are display text only — nothing keys off
them, so a rename is a one-line change in `src/data/creatures.js`.
