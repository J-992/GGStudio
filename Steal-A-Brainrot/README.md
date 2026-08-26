# Steal the Brainrot

A fast, chaotic arcade-tycoon for Poki: buy Italian brainrot creatures off a
conveyor, let them print cash, rob your five AI rivals, escape the chase,
upgrade, rebirth, repeat. Phaser 3, single 1280x720 screen, no backend, no
login.

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
placeholders, so the game runs from any static server with zero assets.

## Art

Every character has real art. The 20 creatures are built from the artwork in
`art/source/`; the player and five rivals are drawn in code and rendered to
sprites at the same fidelity.

```bash
node tools/import-art.mjs --apply     # rebuild creature sprites from art/source/
node tools/import-art.mjs --manifest  # rescan sprites, rewrite the manifest
```

The board itself — belt, pedestals, station, portal — is still drawn
procedurally at boot, and reads fine as background. Any texture key without a
sprite falls back to its placeholder, so art can land one piece at a time.

Full details in [art/README.md](art/README.md) and [ASSET_PROMPTS.md](ASSET_PROMPTS.md).

## Controls

- **Move**: WASD / arrow keys (mobile: virtual joystick, left half of screen)
- **Interact**: Space or E — buy, slap, hold-to-steal, hold-to-rebirth
  (mobile: contextual action button, bottom right)
- **Lock base**: L or the LOCK BASE button
- **Collection**: C or the book button

## The loop

1. Creatures ride the central conveyor every few seconds; price and rarity
   glow tell you what's worth grabbing (7 tiers, Common → SECRET).
2. Owned creatures sit on pedestals and generate cash per second.
3. Rival bases are open unless locked — walk in, hold Space over a creature,
   and run home with it over your head (30% slower, alarm blaring, owner
   chasing). Get touched and it flies back.
4. Bots rob you too — chase them and SLAP to knock the loot loose, or lock
   your gate (20s, then cooldown).
5. Upgrade station: slots, income, lock duration, speed, slap cooldown
   (temporary). Rebirth portal: $50,000 + one Epic resets the run for
   permanent +25% income, +1 starting slot, better conveyor luck and a new
   base look.
6. Every 90–150s a dynamic event fires: Conveyor Rush, Bases Open, Golden
   Minute, Mega Brainrot, Tiny Mode.

Five bots with personalities (Sneaky, Rich Kid, Guard Dog, Chaos Kid,
Collector) buy, lock, raid, defend and fight each other, driven by four dials
each (aggression / greed / defense / risk).

## Poki SDK

`src/systems/PokiSDK.js` wraps the SDK; every call no-ops when the SDK is
absent or blocked, so the game is fully playable off-platform.

- `gameLoadingStart/Finished` around boot, `gameplayStart/Stop` on scene and
  ad transitions
- **Interstitial**: only at the rebirth confirmation (a natural break); the
  game loop sleeps and audio suspends during any ad
- **Rewarded**: the optional "x2 income for 60s" button, offered only when
  the SDK is live; nothing requires an ad
- `happyTime` on big steals, legendary buys and rebirths

## Save data

`localStorage` under `steal-the-brainrot-v1`: rebirths, discovered
collection, settings, best stats, session stats, plus a snapshot of the
current run (cash, creatures, upgrades) written every 8s and on exit. Bots
re-roll fresh each session.

## Structure

```
src/Config.js            all balance constants (prices, weights, timings)
src/data/creatures.js    18 creatures + rarity table (add entries, no code)
src/systems/             Save, Audio (procedural), Poki, Textures, Effects, Input
src/game/                Economy, Creatures, Conveyor, Bases, Steal, Player,
                         Bots, Events, Rebirth, Tutorial, HUD
src/scenes/              Boot → Menu → Game
art/                     3D models in, per-model render settings
tools/                   render-art.mjs + render-creature.py (Blender)
assets/                  manifest.json + rendered sprites (generated)
```

Each creature entry names an `art` routine in `TextureFactory.BODIES` for its
placeholder. Reusing an existing routine costs nothing; a genuinely new
silhouette is one new function there. Once a real sprite exists for a key the
placeholder stops being drawn.

## Licensing note on the characters

The Italian brainrot characters are AI-generated internet memes, not Roblox
IP — *Steal a Brainrot* popularised them but didn't create them. Several do
have identifiable original creators (Tralalero Tralala → TikTok @eZburger401,
Tung Tung Tung Sahur → @noxaasht, Graipuss Medussi → @alexey_pigeon), and
there is no clean public licence covering the names or designs.

What this build does: every sprite is drawn procedurally in
`src/systems/TextureFactory.js` from primitives — no third-party models,
textures, audio or logos are used or bundled, and `ASSET_PROMPTS.md` generates
originals rather than importing an asset pack. The remaining exposure is the
**names**, which is the thing Poki's content review is most likely to raise.
If it does, the swap is cheap: `name` in `src/data/creatures.js` is display
text only, so renaming the cast to soundalikes touches one file and nothing
else.
