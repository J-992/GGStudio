# Merge Ninja

Mobile-first merge battler for kids 6–12. Buy ninjas, combine matching tiers,
build a stronger arena line, defeat 37 bosses, discover 29 ninja forms, and
survive long enough to ascend.

## Run it

```bash
npm install
npm run dev
```

Open **http://localhost:5180**. The canvas fills portrait and landscape
windows: portrait places the arena above the merge board; landscape places the
arena left and the board right.

## How to play

- **Buy:** tap the green BUY button. Its label shows the tier and current cost.
- **Merge:** drag a ninja onto the same tier to create the next tier.
- **Swap or move:** dropping onto a different tier swaps them; dropping onto an
  empty slot moves the ninja.
- **Sell:** drag onto the trash can for a partial refund.
- **Fight:** the strongest owned ninjas automatically form the arena line.
- **Survive:** boss strikes reduce the shared health bar. Potions heal it;
  reaching zero ends the run and opens the record screen.
- **Catch power-ups:** Golden Clock, Shuriken Frenzy, Smoke Bomb, Lucky Charm,
  Protective Ward, and rare tap-to-collect Coin Frenzy drops alter a run.

Progress saves locally. Offline income, daily rewards, achievements, the ninja
and boss almanac, settings, best-run records, and ascension are all active.
Music and sound volumes are independently saved.

## Arena acts

The arena changes at stages 10, 19, 28, and 37. Every act uses the stage-1
dojo as its visual-quality reference and crossfades its backdrop, perspective
floor, portal, clouds, lighting, and VFX palette together.

For focused visual checks in a development build, open:

- `?showcaseBoss=10`
- `?showcaseBoss=19`
- `?showcaseBoss=28`
- `?showcaseBoss=37`
- `?showcaseTier=14` (replace 14 with any tier from 1–29)
- `?showcaseRoster=1`

## Debug panel

Press **`** (backtick) to toggle the playtest panel. It can grant coins, spawn
a selected tier, clear the board, skip an enemy, force a boss, increase game
speed, force high-intensity effects, reset the run, or wipe meta progression.
Use accelerated speed for pacing checks only; animation timing intentionally
remains readable rather than scaling to 8×.

## Verification

```bash
npm run test:unit
npm run lint
npm run typecheck
npm run build
```

Do not use the old Playwright verification scripts for routine agent checks;
the owner validates visual and gameplay behavior by playing the game.

Gameplay rules live in `src/core`, `src/data`, and `src/systems` without Phaser
dependencies. Phaser presentation lives in `src/arena`, `src/effects`,
`src/scenes`, and `src/ui`. Balance values live in `src/data/balance.ts`.

Asset provenance is tracked in `ASSET_LICENSES.md`.
