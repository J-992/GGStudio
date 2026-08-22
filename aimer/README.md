# AIMER

A fast-paced portrait-mode aim trainer with roguelite gun progression, built with
Phaser 4 + TypeScript + Vite, and built to ship on **Poki**.

**Loop:** tap targets → build combos → clear the level → pick 1 of 3 gun upgrades →
next level. 20 levels, ~10–20 seconds each.

## Run it

```bash
bun install
bun run dev          # http://localhost:8080 (also on the LAN, for phones)
bun run build        # Poki build -> dist/
bun run build:web    # standalone build, no SDK -> dist/
bun run package      # build + preflight checks + aimer-poki.zip
bun run check        # typecheck + build
```

Desktop mouse works for testing; the game is designed for a 9:16 phone screen
(540×960 internal resolution, scaled to fit).

Shipping it is documented separately in [POKI.md](POKI.md) — SDK integration, ad
placement, the preflight the packager runs, and the checklist that needs a real
phone.

## What's in it

- **20 data-driven levels** (`src/game/data/levels.ts`) — every knob (duration,
  goal, spawn rate, target size, lifetime, speed, spawn weights) lives in one
  table. Level 20 spawns a boss.
- **10 target types** — normal, small, fast, armored, golden, bomb (don't tap),
  time, coin, multiplier, boss. Introduced progressively via spawn weights.
- **22 stacking upgrades** (`src/game/data/upgrades.ts`) — fire rate, damage,
  crit, multishot, pierce, explosions, chain lightning, economy, combo and
  utility perks. Three weighted offers after every level.
- **Combo / streak system** — streak milestones at 5/10/20/30/50/80 grant score
  multipliers; the HUD always shows progress toward the next one.
- **5 permanent upgrades** bought with coins on the menu, saved to localStorage
  along with best score, best level and rank XP.
- **The mystery present** (`src/game/data/gifts.ts`, `scenes/GiftScene.ts`) — a
  wrapped box after the first run ever finished, and one every 3 runs after
  that. It arrives **before** the results card, not after it -- a card of
  statistics is where a session ends, and a reward on the far side of it is a
  reward most players never reach. Tapping the box pops the lid and spins a
  reel of skins, boosts and coin bags that stops on what they got. The first
  box is not a roll: it is always a photo skin they do not own, and it is worn
  the moment it lands. The results card and the menu both say how many runs the
  next one is away.
- **Photo skins** (`public/skins`, `core/photoskins.ts`) — the one thing that is
  a file rather than drawing code. `art-src/crop.py` frames the originals and
  writes the 256px files the game ships.
- **Everything else is drawn.** Every other graphic is a Phaser shape or a
  runtime-generated canvas texture, and every sound effect is synthesised with
  WebAudio (`src/game/core/audio.ts`). The whole build is ~765 KB gzipped, and
  the only request that leaves the page is Poki's own SDK.
- **The store stops you twice** (`src/game/objects/StoreModal.ts`) — tapping a
  skin or boost you cannot afford raises a card offering it for a video instead
  of shaking the row, and buying a skin blacks the store out for a two-second
  wind-up -- yellow spokes spinning up out of a point of light, rings falling
  inwards, a rising tone -- before the skin lands under two words and a button
  that starts a run wearing it. Tapping skips the wind-up.
- **Five rewarded videos** — an extra life when the clock runs out (once per
  level, board and score intact), double the run's coins on the results card,
  reroll the three upgrade cards as often as you like, one extra present on the
  reveal, and unlocking a store skin or boost you are short of — all opt-in, all
  free to decline.

## Layout

```
src/game/
  core/      theme (palette, layout), audio, fx (particles/tracers/popups),
             icons, state (run + save), lifecycle (freeze gate + gameplay
             reporting), ads (placement policy), adButton (rewarded video UI)
  data/      levels.ts, upgrades.ts, skins.ts, boosts.ts, gifts.ts
  objects/   Target.ts, Turret.ts, StorePanel.ts, StoreModal.ts, PrizeTile.ts
  platform/  pokiSdk.ts (the only file that knows Poki exists), platform.ts
  scenes/    Boot, MainMenu, GameScene, UpgradeScene, ResultScene, GiftScene
```

Nothing outside `platform/` names a portal, and every platform verb is safe to
call on a build that has none.

## Balancing

Base damage is scaled so a plain target is **always** a one-tap kill
(`Run.stats()` multiplies damage by `unitHp(level) / unitHp(1)`). Difficulty
comes from target count, size, speed and lifetime — never from HP walls — and
every upgrade is pure upside on top.
