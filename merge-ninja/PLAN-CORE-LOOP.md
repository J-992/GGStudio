# Merge Ninja — Core Loop Depth Plan (Web Fit Test)

> Binding build plan for the five core-loop features chosen from the Poki player
> fit test funnel (`progress-events.csv`, 584 loads). Written to be worked
> top-to-bottom; each phase ends green (typecheck + lint + unit + build) and is
> committed on its own. Companion to `DECISIONS.md`.

## Why these five

The funnel says the game is not too hard — it is too flat. Zero fails across
584 players and 100 stages. Per-stage churn peaks at **5.8%/stage across stages
10–19**, and mid-stage quits (`lefts`) peak at **8.7% inside stage 19**, then
fall away. Players who reach stage ~37 never leave. Everything below targets
stages 8–30, the band where the loop runs out of new information.

Three structural causes, and which feature answers each:

| Cause | Evidence | Feature |
|---|---|---|
| One decision, and `mergeHint` gives the answer away | `GameCore.ts:225` | F1 Reward Draft |
| 100 identical fights, bigger numbers only | mid-stage lefts peak at 19 | F2 Boss Archetypes |
| Sim and arena never touch; boss cannot kill | `maxHitShare: 0.013` | F3 Debris Tiles |
| Rewards on a clock, not earned; tap streak pays nothing | `powerups.ts` cadence, `CombatDirector.ts:191` | F4 Merge Combo |
| Board never under pressure | `balance.ts:27`, 12 slots | F5 Slot Unlocks |

---

## Binding constraints

These are not suggestions. Every phase is reviewed against them.

1. **No new boot-time assets.** The loader already loses 8.4% of players.
   Anything new is either an added frame in the existing atlas (`ATLAS_KEY`),
   a re-tint of one of the seven authored strips in `src/data/vfxAssets.ts`, or
   drawn with `Phaser.GameObjects.Graphics`. Zero new files in `BootScene`.
   Any exception costs a matching deletion elsewhere.
2. **No new tutorial gates.** The tutorial chain already loses 9.7% at the
   merge teach alone. Every mechanic here teaches itself: the first instance is
   trivially winnable, and the only words allowed are one line through the
   existing `StageBanner`. No modal, no hand prompt, no gate.
3. **Layer discipline holds.** `src/data` (pure) → `src/systems` (pure,
   Phaser-free) → `src/core/GameCore` (sim, owns `EventBus`) → `src/ui`,
   `src/effects`, `src/arena` (Phaser). Sim never imports Phaser; presentation
   never mutates sim state. Every new rule lands in a pure module with a unit
   test before any sprite exists.
4. **Skin-aware or it does not ship.** Every new UI surface reads
   `core.equippedDojoStyle` for its colours and re-tints on `dojoStyleEquipped`
   (wired at `GameScene.ts:281`). No literal hex in a UI file except where
   `theme.colors` already does it. New palette needs go in `DojoStylePalette`
   and get a value in **both** Classic and Crimson.
5. **Layout is derived, never hardcoded.** Positions come from `theme.layout`
   via `configureLayout`; every new container implements `relayout()` and is
   checked at 390×844 portrait and 1440×720 landscape.
6. **Arena VFX stay in the arena.** `VFXManager` is geometry-masked to
   `theme.layout.arena` on purpose. Board-side feedback goes through `Fx` /
   `MergeFX`. Nothing bleeds across the seam.
7. **PEGI 12 and kid-safe.** New pressure costs *space and time*, never
   progress. No mechanic deletes a ninja the player bought, and no boss
   archetype can kill a player who is merging at all.

---

## Phase 0 — Foundations (~4 h)

Everything downstream depends on this landing first. One commit.

1. **`src/data/balance.ts`** — add four config blocks, all commented in the
   existing house style (say *why* the number is that number):
   `draft`, `archetypes`, `debris`, `combo`, `slots`.
2. **`src/core/EventBus.ts`** — add the events below. Keep the union
   alphabetically near its neighbours and document each with a one-line
   comment, as the existing entries do.

   ```ts
   | { type: 'draftOffered'; stage: number; cards: readonly DraftCardId[] }
   | { type: 'draftPicked'; stage: number; card: DraftCardId }
   | { type: 'bossArchetype'; stage: number; archetype: ArchetypeId; firstSeen: boolean }
   | { type: 'bossShieldChanged'; charges: number; max: number }
   | { type: 'bossEnraged'; regenPerSec: number }
   | { type: 'bossBountyResolved'; won: boolean; bonus: number }
   | { type: 'debrisLanded'; slot: number; clearsIn: number }
   | { type: 'debrisCleared'; slot: number; cause: 'merge' | 'expire' }
   | { type: 'mergeComboChanged'; count: number; window: number }
   | { type: 'mergeComboRewarded'; id: PowerupId; count: number }
   | { type: 'slotUnlocked'; slot: number; unlockedTotal: number }
   ```
3. **`src/systems/SaveSystem.ts`** — bump `BALANCE.save.version` 5 → 6. New
   persisted fields: `unlockedSlots: number`, `debris: Array<{slot:number;msLeft:number}>`,
   `draftPicks: string[]`, and `archetypeSeen: string[]` in **`MetaState`**
   rather than the run slot — it is a "has this been taught" flag and belongs
   with `tutorialCompleted`. `valid()` accepts 5 and 6; a pre-6 save migrates
   by granting `unlockedSlots = 12` (existing players never lose board space)
   and empty arrays for the rest. Extend `tests/save.test.ts`.
4. ~~**`src/render/atlasConfig.ts`** — reserve three `FX_FRAMES` entries.~~
   **Dropped, deliberately.** The barrier, the planks and the thrown shuriken
   are all achievable from `Graphics` plus the existing `fx_star`, so the
   milestone adds zero boot-time bytes and every new surface re-tints for free
   on a skin change. See `DECISIONS.md`. Constraint 1 is now met exactly rather
   than approximately.

**Gate:** `npm run typecheck && npm run lint && npm run test:unit`.

---

## Phase 1 — F1 Boss Reward Draft (~1 day)

The cheapest fix for "no decisions", firing on every single boss kill.

### Design

On `bossDefeated`, three cards rise from the boss's death position. The sim
does **not** pause — DPS keeps ticking, the next boss still spawns on the
existing `defeatDelayMs`. If the player ignores the cards for 4 s, the left
card auto-picks and the panel slides away. No stall, no modal, no fail state.

Card pool (`src/data/draftCards.ts`, pure data, one closed union):

| id | Effect | Reads as |
|---|---|---|
| `purse` | `+reward × 1.6` coins, instant | Safe |
| `recruit` | Spawn a ninja at `buyTier + 1` into the first free slot | Tempo |
| `bounty` | Next boss pays 3× — only if killed inside 20 s | Gamble |
| `mend` | Heal 35% of max health | Defensive |
| `edge` | +40% DPS for 25 s | Aggressive |

Draw rules: three distinct cards, never three of the same *shape*; `recruit` is
suppressed when the board has no free slot; `mend` is weighted up below 50%
health so the offer reads as responsive rather than random.

### Build order

1. `src/data/draftCards.ts` — definitions + `drawCards(seed, state)`, pure.
   Unit test: distinctness, board-full suppression, low-health weighting,
   determinism under a fixed seed.
2. `src/systems/DraftSystem.ts` — Phaser-free. Owns the pending offer, the 4 s
   auto-pick timer (advanced by `dtMs`, like `BossController`), and applies the
   picked effect through callbacks. Unit test the auto-pick clock.
3. `GameCore.handleBossDefeated` (`GameCore.ts:564`) — offer after the existing
   reward is credited; emit `draftOffered`. Add `pickDraftCard(id)` to the
   public surface. Persist `draftPicks` for telemetry only.
4. `src/ui/DraftCards.ts` — new container, depth just under the modal band
   (`285`, beside `StickerRunway`'s 286).

### VFX and rigging spec

The card panel is a *dojo shrine offering*, not a UI popup. It must look like
it belongs beside `StickerRunway`.

- **Backing:** `Rectangle` in `palette.panelDark` at 0.95 alpha, 3 px stroke in
  `palette.accentBright` — identical treatment to `StickerRunway.backing`, so
  the two panels read as one family.
- **Card face:** rounded `Graphics` plate in `palette.plate`, 2 px
  `palette.accent` stroke, icon from the existing atlas (`FX_FRAMES.coin` for
  purse, `ninjaFrame(buyTier+1)` for recruit, the live boss frame for bounty,
  `FX_FRAMES.ring` tinted for mend/edge). Label in bitmapText `pixel` at 14 px,
  tinted `palette.accentBright`. **No new art.**
- **Entrance (240 ms):** cards start at the boss's death coordinates, scale
  0.2, alpha 0. Stagger 60 ms. `Back.easeOut` on scale to 1.0 while translating
  to their rest row. One `arenaVfx.sparks(x, y, palette.vfx, 4)` per card as it
  lands. This reuses the merge-pop language the player already knows.
- **Idle:** each card breathes on a 1.8 s `Sine.easeInOut` yoyo, ±0.015 scale,
  60 ms apart so the row shimmers rather than pulses in lockstep. The
  recommended card carries a slow `energyRing` at 0.5 Hz.
- **Hover/press:** scale 1.06 in 90 ms, `palette.slotActive` stroke — matching
  the board's own drag-target feedback in `MergeBoard`, so the affordance is
  already learned.
- **Pick (320 ms):** chosen card `fx.hitStop(45)`, scale to 1.25 and alpha 0
  while the other two fall away with a 12° rotation and 0.8 scale.
  `arenaVfx.shockwave(x, y, palette.accent, 1.4)` on the chosen one, then the
  effect's own flourish: `fx.coins()` for purse, the standard reveal pop for
  recruit, `arenaVfx.pillarOfLight` in gold for bounty, the existing potion
  heal burst for mend, `arenaVfx.energyRing` on the champion for edge.
- **Auto-pick:** a thin `palette.accent` bar drains across the panel base over
  4 s. At 3.5 s the left card pulses once so the takeover never feels stolen.
- **Audio:** `sfx` — reuse the sticker-collect cue for entrance, the merge cue
  for the pick, the fanfare only for `bounty`.

### Tests

`tests/draft.test.ts` — draw rules, auto-pick timing, each effect's state
delta, bounty win/loss resolution. `tests/save.test.ts` — `draftPicks` survives.

---

## Phase 2 — F2 Boss Archetypes (~2.5 days)

Highest raw impact. Turns 100 stages into a rotating four-verb puzzle.

### Design

`src/data/bossArchetypes.ts`, pure, one closed union:

| id | Rule | Teaches | Introduced |
|---|---|---|---|
| `bare` | No modifier. | Rest beat. | stage 1 |
| `shielded` | Takes no ninja DPS until N tap-charges are broken. N = `ceil(stage/6)`, capped 8. | Tapping matters. | stage 8 |
| `enraged` | Regenerates 2%/s unless a merge lands within the last 8 s. | Merging is urgent. | stage 14 |
| `greedy` | 3× reward, forfeited if not killed inside 20 s. | Speed matters. | stage 20 |

Rotation: `bare` until stage 8, then a deterministic cycle seeded by stage so
runs are reproducible and `tests/pacing.test.ts` stays stable. Never two
non-`bare` archetypes back to back below stage 25. First encounter of each is
always the easiest instance of that archetype (shield N=1, enrage window 12 s,
greedy timer 30 s) — that is the whole tutorial, per constraint 2.

### Build order

1. `src/data/bossArchetypes.ts` + `archetypeForStage(stage)`. Unit test the
   rotation: introduction stages, no back-to-back, determinism.
2. `src/systems/BossController.ts` — extend with `shieldCharges`, `regenPerSec`,
   `bountyMsLeft`, all advanced inside the existing fixed-tick loop so
   determinism holds. `damage()` routes tap damage to the shield first.
   `update()` applies regen and bounty expiry. New callbacks:
   `shieldChanged`, `enraged`, `bountyResolved`.
3. `GameCore` — emit the new events; feed "last merge at" into the controller
   so `enraged` can read it. `tapBoss()` returns shield progress.
4. `src/arena/CombatDirector.ts` + `src/ui/BossHud.ts` — presentation only.

### VFX and rigging spec

Each archetype must be legible in **under one second, without text**, and must
survive both skins.

**Shielded**
- A hexagonal barrier: `Graphics` ring at 1.35× the boss's drawn radius,
  stroked in `palette.bossAura`, six segments with a 4 px gap. One segment
  darkens per charge broken — the charge count is *readable from the shape*, no
  number needed.
- Idle: barrier rotates 6°/s and breathes ±3% on a 2.2 s yoyo.
- Blocked hit: `arenaVfx.impact` at the contact point tinted `palette.bossAura`,
  barrier flashes to white for 60 ms, boss does **not** flinch. The absence of
  the familiar flinch is the teaching signal.
- Charge broken: that segment shatters via three `arenaVfx.sparks` bursts along
  its arc + `fx.shake(0.004, 90)`.
- Final break: `arenaVfx.shockwave(boss.x, boss.y, palette.bossAura, 2.2)`,
  `fx.hitStop(60)`, barrier segments fly outward and fade over 280 ms, then the
  boss takes its first ninja hit. This is the payoff beat — do not under-sell it.

**Enraged**
- Boss tint lerps toward `palette.vfx` as the merge window drains; at zero, a
  `flame` strip loop from `VFX_ANIMATIONS` plays at the boss's feet, tinted
  `palette.bossAura`.
- The arena edges carry a slow red pulse — **reuse `LowHealthWarning`'s
  vignette**, driven by the enrage state rather than health, so the visual
  vocabulary stays consistent instead of inventing a second danger colour.
- A merge landing while enraged: `arenaVfx.energyRing` on the boss, tint snaps
  back over 200 ms, flame loop stops. The player feels the merge *reach across*
  into the arena — which is the entire point of the archetype.

**Greedy**
- Boss carries a gold `palette.accentBright` rim light and a slow coin drift
  using `FX_FRAMES.coin` through the existing `CoinFX` pool.
- Timer: a gold arc drains around the boss's HP bar in `BossHud` — no digits.
  Under 5 s the arc pulses at 2 Hz and the drift accelerates.
- Win: `arenaVfx.pillarOfLight(boss.x, boss.y, palette.accentBright, 3)` and a
  triple `fx.coins()` burst.
- Loss: the gold rim greys out over 400 ms and the coins scatter *downward* and
  fade. Quiet, not punitive — the player still gets the base reward.

**Announcement:** one `StageBanner` line on the first encounter only
(`SHIELDED` / `ENRAGED` / `GREEDY`), tinted `palette.accentBright`, 900 ms.
Never again after that. Add the archetype word to `flavorText.ts` so the
existing copy pipeline owns the wording.

### Tests

`tests/bossArchetypes.test.ts` — rotation, shield arithmetic across the stage
curve, regen maths, bounty expiry. `tests/combat.test.ts` — tap routes to
shield first. `tests/pacing.test.ts` — the 10-minute policy run still clears
its stage targets with archetypes live (this is the one most likely to fail;
tune `archetypes` in `balance.ts`, not the test).

---

## Phase 3 — F3 Debris Tiles (~2 days)

Couples the two layers and finally makes `attackIntervalMs` mean something.

### Design

Above stage 12, a boss swing that would have been absorbed by
`maxHitShare` instead throws a shuriken onto the board: one slot is blocked by
debris for 12 s. Rules, all binding:

- Debris never lands on an occupied slot, never on a locked slot (F5), and
  never leaves fewer than **2** free slots.
- Merging into any of the up-to-4 orthogonally adjacent slots clears it
  instantly. It also expires on its own timer, so a passive player is delayed,
  never stuck.
- Maximum 2 debris on the board at once. Suppressed entirely during the
  first-run tutorial and for 20 s after an ascension.
- Debris blocks `buy` targeting but never destroys a ninja. Costs space and
  time only — constraint 7.

### Build order

1. `src/data/balance.ts` — `debris` block: `startStage: 12`, `holdMs: 12000`,
   `maxConcurrent: 2`, `minFreeSlots: 2`, `chance` ramping by stage.
2. `src/systems/MergeSystem.ts` — add a `blocked: Set<number>` alongside
   `slots`. `firstEmpty()`, `spawn()`, `move()` and `mergePair()` all respect
   it. This is the highest-risk edit in the plan: every board invariant flows
   through this class, so it lands with tests before anything renders.
3. `GameCore` — on `bossAttack`, roll debris; tick `msLeft`; clear on a merge
   adjacent to it; emit `debrisLanded` / `debrisCleared`. Persist across reload.
4. `src/ui/MergeBoard.ts` — render and animate.

### VFX and rigging spec

The throw must be one continuous arc from boss to board. A tile that simply
appears will read as a bug.

- **Throw (420 ms):** `arenaVfx.projectile` launches a spinning
  `FX_FRAMES.debris` from the boss along a quadratic Bézier arcing over the
  arena/board seam. Because `VFXManager` is masked to the arena, the projectile
  hands off at the boundary to a board-layer sprite owned by `MergeBoard` — the
  handoff happens mid-arc at matched position, scale and angle, so it reads as
  one object. Spin: 720° over the flight.
- **Impact:** `fx.shake(0.005, 110)`, `mergeFx.flash` at the slot, a
  `FX_FRAMES.puff` ring, and the slot ring snaps to `palette.slot` desaturated.
- **Resting state:** two crossed planks in `palette.panelDark` over the slot,
  stroked `palette.accent` at 40% alpha, drawn with `Graphics` so it re-tints
  for free on skin change. The slot's own highlight is suppressed.
- **Countdown:** the slot ring drains as an arc in `palette.accent`. Last 3 s,
  the planks jitter ±1 px at 8 Hz. Legible at a glance, silent.
- **Adjacent-merge clear (260 ms):** the merge's existing shockwave visibly
  *reaches* the debris — planks splinter into four `FX_FRAMES.spark` pieces
  flung away from the merge, `arenaVfx.sparks` at the slot, slot ring pops back
  to `palette.slotActive` for 150 ms. This is the reward beat that teaches the
  clearing rule with no words at all.
- **Expiry:** planks fade over 300 ms with a single `smoke` puff. Deliberately
  duller than the merge clear, so clearing it yourself always feels better.

### Tests

`tests/debris.test.ts` — the four placement invariants, adjacency clearing,
expiry, concurrency cap, tutorial suppression. `tests/merge.test.ts` — blocked
slots are excluded from `firstEmpty`, `mergePair`, `move`. `tests/save.test.ts`
— debris and its remaining time survive a reload.

---

## Phase 4 — F4 Merge Combo → Earned Powerup (~1 day)

Turns two existing dead counters into payoffs.

### Design

- **Merge chain:** merges within 3.0 s of each other increment a chain. At 4,
  grant a powerup from `POWERUP_ORDER` (weighted to `shurikenFrenzy`), reset to
  0. The window refreshes on each merge, so the skill expression is *planning
  the next pair before you finish this one*.
- **Tap streak:** the streak already counted in `CombatDirector.ts:191` becomes
  real — at 25 taps inside its existing window, grant `shurikenFrenzy`.
- Timed spawns in `powerups.ts` stay exactly as they are. Earned grants are a
  ceiling on top, never a replacement — a player who never chains is not
  starved.

### Build order

1. `src/systems/PowerupSystem.ts` — add `grantEarned(id)` sharing the existing
   stack policies, so an earned grant stacks identically to a caught one.
2. `GameCore.drop()` — track `lastMergeAt`, maintain the chain, emit
   `mergeComboChanged` / `mergeComboRewarded`.
3. `CombatDirector` — feed its existing streak count into the same reward path.
4. `src/ui/MergeBoard.ts` — the chain meter.

### VFX and rigging spec

- **Chain meter:** four chevrons above the board title plate, in
  `palette.accent`, filling to `palette.accentBright`. Each fill pops to 1.3
  scale and settles on `Back.easeOut` in 140 ms. The whole row drains smoothly
  over the last 600 ms of the window — the player can *see* the window closing.
- **Escalation:** merge VFX intensity scales with the chain. Chain 2 adds a
  second `sparks` ring, chain 3 adds `fx.shake(0.003, 70)`, chain 4 adds
  `hitStop(50)`. The existing merge animation is untouched; it is *layered*.
- **Reward (400 ms):** the four chevrons converge into the board centre,
  `arenaVfx.energyRing` in `palette.vfx`, and the powerup icon flies from there
  to its HUD chip along the same path `PowerupPickups` already uses for a
  caught token — so an earned powerup and a caught one land identically.
- **Break:** chevrons dim to `palette.panelDark` over 200 ms, no sound, no
  shake. Missing a chain must never feel like a punishment.
- **Tap streak:** the existing label trail gains a gold tint from 20 taps and a
  `shockwave` on the 25th, reusing `CombatDirector`'s own escalation vocabulary.

### Tests

`tests/combo.test.ts` — window arithmetic, chain reset, grant at 4, weighting.
`tests/powerups.test.ts` — an earned grant obeys `maxActiveOfSame` and the
declared `StackPolicy`.

---

## Phase 5 — F5 Slot Unlocks (~half a day)

Cheap, and it places three reward moments straight into the churn band.

### Design

Start with 6 of 12 slots usable. Unlock one at stages **8, 12, 16, 20, 25,
30** — six unlocks spread across the exact stages where the funnel bleeds.
Existing v5 saves start fully unlocked (Phase 0 migration).

**The 3×4 layout does not change.** Locked slots stay in place, rendered as
boarded-over. This avoids touching `configureLayout` entirely, and a visibly
locked slot advertises the future reward in a way a smaller board cannot.

### Build order

1. `balance.ts` — `slots: { initial: 6, unlockStages: [8,12,16,20,25,30] }`.
2. `MergeSystem` — reuse the Phase 3 `blocked` set with a permanent `locked`
   set; same invariants, same call sites.
3. `GameCore.handleBossDefeated` — unlock and emit `slotUnlocked`.
4. `MergeBoard` — render and celebrate.

### VFX and rigging spec

- **Locked state:** two crossed planks — *visually distinct from debris*: thick,
  static, `palette.panel` with an `palette.panelDark` shadow, plus a small
  `FX_FRAMES.plank` nail at each end. Debris is thin, jittering and
  countdown-ringed; a lock is heavy and still. The player must never confuse a
  12-second problem with a 4-stage goal.
- **Next-unlock tease:** the slot due next carries a 0.35 Hz `palette.accent`
  glow, and the board title plate reads `NEXT SLOT · STAGE 12`. This is the
  anticipation hook — it must be visible on screen at all times.
- **Unlock (620 ms):** `fx.hitStop(50)`; planks splinter outward on a 25°
  rotation with `FX_FRAMES.spark` debris; `arenaVfx.shockwave` at the slot in
  `palette.accentBright`; slot ring draws itself on in 200 ms; a single
  `arenaVfx.pillarOfLight` column; the ring pulses `palette.slotActive` twice.
  Longest single flourish in the game after a sticker page completing — that
  ranking is deliberate.
- **Audio:** wood-crack, then the sticker-collect chime.

### Tests

`tests/slots.test.ts` — initial count, unlock stages, locked slots excluded
from every `MergeSystem` path, debris never targets a locked slot, v5 saves
land fully unlocked.

---

## Phase 6 — Integration, balance, verification (~1.5 days)

The five features interact. This phase exists because shipping them
independently green is not the same as shipping them together good.

### Interaction rules (binding)

1. Debris (F3) starts at stage 12; the last slot unlock (F5) is stage 30. With
   6 slots and 2 debris a player could sit at 4 usable slots — hence
   `minFreeSlots: 2` and `maxConcurrent: 2`. Assert this jointly, not per-feature.
2. `enraged` (F2) plus debris (F3) on the same stage is banned below stage 25 —
   an enrage window the player cannot answer because the board is blocked is
   the exact arithmetic-death the `maxHitShare` comment warns about.
3. `recruit` (F1) respects locked and blocked slots; if none are free it is
   never offered.
4. Combo chains (F4) count merges that clear debris, so the two systems
   compound in the player's favour rather than competing.

### Re-tune the curve

With four new sources of tension in stages 8–30, the existing DPS curve is now
too tight there. Lower `boss.hpGrowth` 1.30 → **1.26** for stages 8–30 only,
returning to 1.30 above it. Target from the funnel data: per-stage churn in
the 10–19 band down from 5.8% to **under 4%**, and mid-stage `lefts` at stage
19 down from 8.7% to **under 4%**.

### Verification gate

```
npm run typecheck && npm run lint && npm run test:unit && npm run build
node verify-playthrough.mjs      # 10-min compressed run, screenshots every boss
node verify-fps.mjs              # 60 FPS floor with all five features live
node verify-survival.mjs
node verify-retention.mjs
```

Additionally, by hand:

1. Screenshot every new surface in **both** dojo skins. Any hardcoded colour
   shows up immediately as a mismatch.
2. Run at 390×844 and 1440×720 and confirm no new element clips the safe-area
   insets.
3. Confirm the initial payload has not grown beyond the ~6 KB atlas addition.
   The 8.4% loader drop is the other half of this milestone and must not regress.
4. Play stages 1–20 cold, on a phone, with no prior knowledge. If any mechanic
   needs explaining out loud, its self-teaching instance is not easy enough.

---

## Sequence and estimate

| Phase | Work | Est. | Ships alone? |
|---|---|---|---|
| 0 | Foundations: balance, events, save v6, atlas frames | 4 h | no |
| 1 | F1 Reward Draft | 1 d | **yes** |
| 2 | F2 Boss Archetypes | 2.5 d | **yes** |
| 3 | F3 Debris Tiles | 2 d | needs 0 |
| 4 | F4 Merge Combo | 1 d | **yes** |
| 5 | F5 Slot Unlocks | 0.5 d | needs 3 |
| 6 | Integration, curve re-tune, verification | 1.5 d | — |

**Total ≈ 9 working days.** Phases 1, 2 and 4 are independently shippable — if
the web fit test window closes early, ship **1 + 2** and hold the rest. Those
two alone answer the two named causes of the churn.

## Telemetry to add alongside

Ship Poki progression events for the new beats, so the next fit test can
measure this plan rather than guess at it: `draft-pick-<id>`,
`archetype-<id>-cleared`, `debris-cleared`, `combo-4`, `slot-unlock-<n>`.
Wire them through the existing `RetentionFunnel` (`GameScene.ts:176`).


---

## Build log (what actually shipped)

Every phase landed. Five things came out differently from the plan above, all
driven by evidence rather than preference; the reasoning for each is in
`DECISIONS.md`.

| Planned | Shipped | Why |
|---|---|---|
| Three new atlas frames | None | Graphics plus the existing `fx_star` cover it. The loader already loses 8.4% of players; depth must not cost download. |
| Debris throw hands off at the arena mask | One unmasked board-layer sprite for the whole arc | `VFXManager` is masked to the arena; a projectile started there is clipped mid-flight. One object crossing the seam is the same picture with none of the seam. |
| `boss.hpGrowth` 1.30 -> 1.26 across stages 8-30 | No easing at all | The eased band made the twenty-minute run *worse*: the player reached stage 31 minutes early with a roster that had not merged enough to match it, stalling 21-27s. Without it the suite passes at 17.0s and 17.3s against a 20.1s bound. |
| Six starting slots | Eight | Six stalled the opening minute past the attention span in two runs out of three. |
| Chains weighted to Shuriken Frenzy | Chains grant Smoke Bomb or Protective Ward; only tap streaks pay a frenzy | Free DPS races the stage ladder ahead of the roster that has to kill it. Lucky Charm was worse still: doubling coins inflates purchase count until the shop outruns income. |

Two mechanics also gained rules the plan did not anticipate, both found by the
pacing sim rather than by reading the code:

- **The barrier decays.** A player who never taps could not pass a shielded
  boss at all -- a 566-second stall at stage 8. The barrier now sheds its
  charges evenly across nine seconds whatever the player does, so tapping is
  the fast way through rather than the only way.
- **Debris and locks had to look nothing alike.** The first cut drew both as
  crossed planks and they read as the same mechanic. Debris is now the thrown
  shuriken embedded in the slot, under a draining ring; a lock is heavy nailed
  boards that never move.

### Verification

`npm run typecheck`, `npm run lint`, `npm run test:unit` (450 tests, 73 new),
`npm run build`, and the pacing suite green five runs in a row. A new
`verify-coreloop.mjs` drives the real game through every mechanic and passes on
both 1280x900 and 390x844, with screenshots of each surface in both dojo skins
under `screenshots/coreloop/`. `verify-fps.mjs` holds 60 FPS with everything
live. The initial payload is unchanged.
