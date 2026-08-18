# First-Play Retention Teardown

**Symptom (playtest telemetry):** the largest drop-off bucket is **0–1 min on the
first session**. Players are leaving before they ever reach a payoff screen.

**Verdict:** this is not a difficulty problem or a "game isn't deep enough"
problem. In the current build a brand-new player spends roughly the **first
15–20 seconds looking at loading bars and an empty graveyard**, then the next
~25 seconds being **stopped five times** by tutorial cards, and does not reach a
single reward moment until **~2 minutes in**. The 0–1 min bucket is almost
exactly the window in which the game shows the player nothing worth staying for.

Everything below is measured against the code, not guessed. File and line
references are to `zombie-motorworks/` at `9250163`, which is the build the
teardown describes.

## Status

Sections 2.1, 2.2, 2.3 and 2.5 have since been implemented, plus the reward
work from 2.6.

2.3 went further than this teardown proposed: the coach does not stop the world
at all any more. Cutting five time-stops to three was the wrong shape of fix —
the first thing the game did was still take the controls away. The three
remaining steps are a banner along the top edge that the wave runs underneath,
dismissed by doing the thing or ignored and timed out.

Still open:

- **2.4 — no combat music.** Still the single biggest lever left, and still one
  audio file plus a `startCurrentWave` hook away. Nothing here touches it.
- **2.6 — wave length.** Milestone rewards landed and kill streaks now pay out
  in every wave; the first wave is still 35 bodies, so the victory card is
  still further out than it should be.
- **2.7 — the post-tutorial power cliff.** Softened rather than solved: every
  starter Build now ships a base-level Zombie Blaster, so minute two has a gun
  that fires itself, and the milestone bonuses put a slightly fuller wallet
  into the first shopping trip.

---

## 1. The first 60 seconds, measured

| t (approx)  | What the player sees                                                                                                                                                                          | Where it comes from                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0.0s        | Black screen, `SCRAP RIG` wordmark, progress bar                                                                                                                                              | `index.html:127` inline splash                                                                  |
| 0.5–1.5s    | Key art fades in behind the bar                                                                                                                                                               | `index.html:151`                                                                                |
| ~3–8s       | Still the boot bar. Cold transfer is ~1.5–2 MB gzipped: `three` 660 KB, `App` 800 KB, `rapier_wasm3d` 1.4 MB, 196 KB CSS, 140 KB fonts, 93–126 KB splash webp — then wasm compile             | `src/app/main.ts:25`, `dist/assets/`                                                            |
| ~8s         | Boot splash dies… and a **second full-screen loading scrim** appears: `ROLLING OUT`, new key art, new progress bar                                                                            | `SurvivalMode.ts:1673–1704`                                                                     |
| ~8–14s      | Waits on every graveyard GLB (1.4 MB, ~20 files + props) and the voxel placer. Hard timeout **12s**                                                                                           | `SurvivalMode.ts:212`, `ArenaBuilder.ts:207`                                                    |
| ~14s        | Scrim lifts. **3-second countdown** over the arena                                                                                                                                            | `SurvivalMode.ts:203`, `:3065`                                                                  |
|             | The arena behind the countdown contains **zero zombies** — `stepFixed` only spawns during `phase === 'active'`                                                                                | `SurvivalMode.ts:2558`                                                                          |
| ~17s        | Countdown ends → `startCurrentWave()` → `firstPlay.begin()` **freezes the world on the same frame**                                                                                           | `SurvivalMode.ts:3088–3096`                                                                     |
| ~17s        | Card #1: **"DRIVE — Steer with W A S D"**, over a still-empty graveyard. `startWave()` only _queues_ the spawn order; nothing spawns until a physics step runs, and the coach blocks the step | `WaveManager.ts:492`, `SurvivalMode.ts:2514`                                                    |
| ~17.3s+     | 320 ms input lockout, then the player presses W                                                                                                                                               | `FirstPlayCoach.ts:36`                                                                          |
| ~17.5s      | World unfreezes. 35 bodies burst-spawn — **on a ring 40–50 m from the rig**, in ~5 clumps of ≤8 scattered over 3.5 m each, "among the farthest half" of 20 anchors                            | `graveyard.ts:12,365`, `ArenaBuilder.ts:829`, `ZombieSystem.ts:2342`, `zombieConfig.ts:214–215` |
| ~17.5–22.5s | 5 s of live play. Camera is 20 m up / 12 m back at 55° fov — it sees maybe 30 m of ground. **Most of the horde is off-screen.** Player drives across empty ground hunting for a target        | `FollowCamera.ts:14`, `SurvivalMode.ts:1113`                                                    |
| ~22.5s      | **Freeze #2** — "SHOOT: point at a zombie and hold left click" (may land before a zombie is on screen)                                                                                        | `firstPlay.ts:78`                                                                               |
| ~28.5s      | **Freeze #3** — "SHIELD"                                                                                                                                                                      | `firstPlay.ts:87`                                                                               |
| ~34.5s      | **Freeze #4** — "YOUR TRUCK" (health bar revealed)                                                                                                                                            | `firstPlay.ts:96`                                                                               |
| ~38.5s      | **Freeze #5** — "CLEAR IT" (wave timeline revealed)                                                                                                                                           | `firstPlay.ts:105`                                                                              |
| ~39s        | First moment of uninterrupted play. **This is where most of the drop-off has already happened.**                                                                                              |
| ~39s–2min+  | Grind 35 walkers + 5 throwers, no music, no progress card                                                                                                                                     |
| ~2min+      | First actual reward: First Play Victory card                                                                                                                                                  | `FirstPlayVictory.ts`                                                                           |

**Total run of live, uninterrupted gameplay in the first 40 seconds: 21 seconds**
(`runSeconds` = 5 + 6 + 6 + 4 + 0, `firstPlay.ts`), split into four fragments by
four hard time-stops.

---

## 2. Root causes, in order of how much they're costing you

### 2.1 Three sequential wait gates before anything happens (biggest single cost)

The player waits behind **boot splash → `ROLLING OUT` scrim → 3-second
countdown**, back to back. Each one is individually well-built (the inline
splash paints on first parse, the arena bar is progress-driven, the countdown
tells you a wave is coming). Stacked, they are 15+ seconds of _"please wait"_
in a genre where a portal player gives you about ten.

Worse: gates 2 and 3 are both **over a completely empty arena**. The
`ROLLING OUT` scrim's own comment says it exists so "a half-built arena is never
the first thing a player sees of a level" — but what it's protecting is a level
with no enemies in it, so the reveal it buys is anticlimactic.

**Fixes, cheapest first:**

- **Kill the countdown on the first wave only.** Three seconds of "WAVE
  STARTING" is meaningful on wave 7 when you're repositioning after a repair. On
  a first boot, the player has no context to use it, and it's pure dead air.
  Gate it: `COUNTDOWN_SECONDS` → 0 when `run.firstPlay === true`
  (`SurvivalMode.ts:3032`). **~5 lines. Saves 3s.**
- **Spawn the horde before the coach freezes.** Call one `waves.update()` /
  `spawnOneHorde()` pass — or move `firstPlay.begin()` to after the first
  physics step — so card #1 sits over a graveyard that already has 35 zombies
  standing in it, mid-stride, frozen. This costs nothing and converts the single
  most-viewed frame in the game from "empty field + text" to "oh, _that's_ the
  game." **High impact, low effort.**
- **Merge the two loading screens.** The boot splash already owns the screen and
  is already progress-driven. Have `SurvivalMode` report arena progress into
  `window.__bootSplash` on the first mount instead of standing up a second
  full-bleed scrim, and only dismiss the boot splash when the arena is ready.
  One wait, one bar, one piece of key art — instead of two screens that look
  almost identical and make the load feel twice as long.
- **Shrink or defer the first-load payload.** `rapier_wasm3d_bg.wasm` is 1.4 MB
  and `three` is 660 KB. Worth checking whether the graveyard prop GLBs
  (1.4 MB) can stream in _behind_ a playable arena instead of gating it —
  `VoxelAssetLoader` already falls back to placeholders, so the arena is
  playable either way (`SurvivalMode.ts:204–212` says as much). Consider
  starting the wave at, say, 60% placement and letting the rest pop in; props
  appearing behind you is far cheaper than 6 seconds of bar.

### 2.2 The horde spawns off-screen, so "drive" has no target

`MIN_SPAWN_DISTANCE_FROM_VEHICLE = 18`, spawn anchors sit on a ring at
`halfSize - 3 ≈ 49.5 m` from arena centre (minus up to 10 m variation), and
`pickSpawnPoint()` deliberately "picks among the farthest half". The rig starts
at centre. The camera shows ~30 m of ground.

Result: the tutorial says "steer with WASD", and the player steers around an
empty 105×105 m graveyard looking for the game. The `ThreatPointer` chevron is
there to help — but it's a 0.26 m ground marker that nothing has explained yet.

`FIRST_PLAY_WAVE_COMPOSITION`'s own comment says "a wall of bodies is the whole
point of the first thing a new player sees." The spawn rules currently prevent
exactly that.

**Fix:** give the first-play wave its own spawn rule — a dense arc **in front of
the rig at 25–35 m**, inside the camera frustum, rather than the "farthest half"
ring. A first-play spawn override on `ZombieSystem` (or a `spawnAhead` flag
honoured by `pickSpawnPoint`) is a contained change and it is the difference
between "where is everyone" and "oh god there are so many."

### 2.3 The coach stops the world five times in 40 seconds

The design intent here is sound and the writing is genuinely good — one line, no
Next button, dismissed by doing the thing. But **four hard time-stops inside the
first 40 seconds** means the player never gets into flow. Every freeze is a
place to bounce, and freeze #4 and #5 aren't even teaching a skill (`release:
'any'`) — they're read-only reveals that stop a fight to point at a health bar
and a wave counter.

**Fix — cut five steps to three:**

- Keep `drive`, `shoot`, `ability`. Those three teach hands.
- **Delete the `health` and `wave` freezes.** Replace them with _reveals that
  don't stop time_: slide the health bar in the first time the rig takes damage
  (with a one-shot flash and no text), and slide the wave timeline in on the
  first kill. A bar that animates in at the moment it becomes relevant teaches
  itself; a stopped world with a caption does not. **Saves two full-screen
  interruptions and ~4s of dead time.**
- Consider dropping `ability` to a non-freezing prompt too (a pulsing ability
  box + "Q" keycap), which would take the first play down to two stops.

### 2.4 There is no combat music. At all.

`dist/assets/audio/` contains exactly one music track: `garage-theme.ogg`.
`startGarageMusic` is called from `App.ts:769` and stopped on every route into
the arena (`App.ts:781, 1148, 1258`). **The entire survival mode runs silent
except for SFX.**

This is almost certainly the single largest contributor to "not cool enough."
The player's first 60 seconds of your action game have no score. A driving/horde
game with no combat music reads as an unfinished prototype no matter how good
the VFX are — and you have good VFX.

**Fix:** one looping combat track, started on `startCurrentWave()`, ducked under
the wave-clear card. Even a single 90-second loop changes the perceived
production value of the first minute more than anything else on this list per
hour of work. A second, more intense layer for boss waves is a nice-to-have; the
base loop is not.

### 2.5 UI clutter: 12+ widgets, none of them earned

During the first play, with `health` and `waveTimeline` correctly hidden
(`SurvivalMode.ts:2094`), the screen still carries:

| Corner        | Widget                                                                                                    | Does a first-time player need it in minute 1?                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Top-left      | Cash counter, big `$` readout (`SurvivalMode.ts:1580`)                                                    | **No.** The demo rig is given away at wave end and nothing here is spendable or owned. It's a number that means nothing yet.   |
| Top-left      | Pickup toast column (`:1596`)                                                                             | Only when a crate is collected — fine.                                                                                         |
| Top-right     | `Settings` button (`:1786`)                                                                               | Marginal.                                                                                                                      |
| Bottom-left   | **Driver HUD panel, 225 px** (`:1495`, `style.css:5319`) — see below                                      | Mostly **no**                                                                                                                  |
| ↳             | Speed: label + numeric + `KM/H` + 3-tier ram gauge + moving marker + 3 legend labels = **9 sub-elements** | **No.** Ram-damage thresholds are never taught by the coach and are meaningless before the player knows ramming is a mechanic. |
| ↳             | Vehicle Health bar                                                                                        | Hidden until step 4 — correct                                                                                                  |
| ↳             | Fuel bar                                                                                                  | **No.** Fuel is not a pressure in wave 1 and the tutorial rig has two upgraded tanks.                                          |
| Bottom-centre | Ability bar, 3 slots (Q/E/R) (`:1317`, `abilities.ts:507`)                                                | Two are populated, one is taught. Fine, but 3 empty-ish boxes read as clutter.                                                 |
| Bottom-centre | Buff bar (`:1316`)                                                                                        | Only when a buff is live — fine                                                                                                |
| Bottom-centre | Strike gauge (`:1321`)                                                                                    | **No.** Signature strikes are not taught in first play.                                                                        |
| Bottom-right  | Minimap (`:1285`)                                                                                         | **No.** A new player cannot read a top-down blip map while learning to steer.                                                  |
| World-space   | Threat pointer chevron + skull (`:1142`)                                                                  | Useful — but only because the horde spawns off-screen (see 2.2). Fix the spawn and this stops being load-bearing.              |
| World-space   | Damage numbers (`:1304`), scope cursor (`:1301`), warning HUD (`:1303`)                                   | Damage numbers yes; the rest, not yet                                                                                          |

**The pattern:** the HUD is built for a wave-12 player managing fuel, ram speed,
three abilities, a signature charge and a minimap. A first-timer sees an
instrument panel and reads it as complexity, not as information — exactly the
reasoning `firstPlay.ts` already applies to the health bar and the wave
timeline, just not applied to anything else.

**Fix — extend the existing reveal mechanism instead of inventing a new one.**
`FirstPlayReveal` and `firstPlayRevealed()` already do this cleanly. Add reveal
targets for `cash`, `fuel`, `speed`, `minimap`, `strikeGauge`, and gate them on
**events rather than steps**:

| Widget       | Reveal trigger                                            |
| ------------ | --------------------------------------------------------- |
| Speed gauge  | First time the rig kills something by ramming             |
| Fuel bar     | First time fuel drops below ~70%, or the first fuel crate |
| Cash counter | First kill that pays (animate the first `+$` into it)     |
| Minimap      | Wave 2 (i.e. after the garage), not on the tutorial wave  |
| Strike gauge | First time the signature block is actually owned          |
| Ability bar  | Show only the slots that are filled, not all three        |

Target for the first play: **rig, ability box, damage numbers, threat pointer.**
That's it. Everything else earns its way on.

On mobile this matters more, not less: `MobileHud.installTopBand` packs
**eleven** widgets — settings, driver HUD, boss HUD, wave timeline, cash,
minimap, buffs, pickups, warnings, prompts, scuttle banner — into a single strip
across the top of a phone screen (`MobileHud.ts:118–132`). Fewer widgets is the
only real fix there.

### 2.6 The first reward is ~2 minutes away

35 walkers + 5 throwers, burst-spawned and scattered across a 105 m arena, on a
rig that has to drive to each clump. Nothing marks progress until the wave
timeline is revealed at ~39s. The **only** payoff — the First Play Victory card
with its counted-up stats and fireworks — is at the very end.

A player who quits at 55 seconds has received **zero** positive feedback events
beyond individual kills.

**Fix — put small payoffs inside the first minute:**

- A **first-kill moment**: brief hit-stop, a louder gib burst, a `+$25` that
  flies into the (revealed-at-that-moment) cash counter. One kill, one
  celebration.
- A **10-kill milestone toast** ("10 DOWN") around the 30–40s mark. You already
  have the toast column and `ThreatAlert` presentation to reuse.
- Consider **halving the first wave's body count** (30 walkers → ~15) so the
  victory card lands at ~60–75s instead of ~2 min. The wave's stated job is "one
  short, loud fight the player finishes in well under a minute"
  (`WaveManager.ts:72–79`) — with the current count and the off-screen spawn
  ring, it isn't hitting that.

### 2.7 (1–5 min bucket) The power cliff after the tutorial

Not a 0–1 min issue, but it will be your _next_ cliff once the first minute is
fixed, so it's worth naming.

`firstPlayRig()` is six level-5 engines, level-5 monster wheels, a Heavy Cannon,
a Pyre Core, two blasters, a level-4 sawblade and a Shield Bubble
(`builds.ts:417`). It is, by design, "a demo reel with a steering wheel." The
player then hits the garage, hands it back, and picks a starter Build with a
fraction of that output.

That is a deliberate and defensible choice — but it means minute 2 feels
strictly worse than minute 1, which is the wrong shape. Mitigations worth
considering: let the player keep **one** demo part of their choosing, or have
the victory card explicitly frame the demo as "that was the endgame rig — here's
how you build it," so the drop reads as a goal rather than a takeaway.

---

## 3. Prioritized action list

Ordered by **(impact on the 0–1 min bucket) ÷ (effort)**.

| #   | Change                                                                                                          | Effort | Expected effect                                              |
| --- | --------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| 1   | **Add combat music** — one loop, started on `startCurrentWave()`                                                | S      | Largest single jump in perceived quality of the first minute |
| 2   | **Spawn the horde before the coach's first freeze** so card #1 sits over 35 frozen zombies                      | XS     | Fixes the most-viewed frame in the game                      |
| 3   | **First-play spawn arc in front of the rig at 25–35 m** instead of the far ring                                 | S      | "Drive" finally has something to drive at                    |
| 4   | **Skip the 3s countdown on the first wave**                                                                     | XS     | −3s of dead air                                              |
| 5   | **Cut coach steps 4 and 5**; reveal health on first damage, timeline on first kill                              | S      | −2 interruptions, −4s                                        |
| 6   | **Hide cash / fuel / speed / minimap / strike gauge on the first play**, reveal each on its own first-use event | M      | Kills the clutter complaint at its source                    |
| 7   | **Merge boot splash and `ROLLING OUT` into one loading screen**                                                 | M      | One wait instead of two; the load _feels_ half as long       |
| 8   | **First-kill celebration + a 10-kill milestone toast**                                                          | S      | First positive feedback moves from ~2 min to ~20s            |
| 9   | **Cut the first wave to ~15–20 bodies**                                                                         | XS     | Victory card lands inside 90s                                |
| 10  | **Start the wave before every prop has streamed in** (placeholders already exist)                               | M      | −3 to −6s on a cold load                                     |
| 11  | Reframe the demo rig on the victory card so minute 2 reads as a goal, not a downgrade                           | S      | Attacks the _next_ cliff (1–5 min)                           |

Items 1–5 and 8–9 together are roughly a day of work and should move the player's
first _actual_ gameplay moment from **~17s to ~6s**, their first zombie contact
from **~25s to ~8s**, and their first reward from **~2 min to ~20s**.

---

## 4. What to instrument before the next playtest

Right now the funnel says "they left in the first minute" but not _which screen
they were looking at_. Add four events and the next round of data will be
diagnostic instead of directional:

1. `boot_splash_dismissed` (with elapsed ms)
2. `arena_ready` (with elapsed ms, and whether the 12s timeout fired)
3. `first_play_step_opened` / `first_play_step_released` per step id — this tells
   you exactly which coach card people quit on
4. `first_zombie_contact` and `first_kill` (elapsed ms from boot)

If the drop is concentrated before `arena_ready`, it's payload and loading
(items 7 and 10). If it's between `first_play_step_opened:drive` and
`:shoot`, it's the empty-arena spawn problem (items 2 and 3). If it's after
`first_kill`, it's pacing and reward (items 8 and 9). Those are three completely
different fixes and the current data can't distinguish them.

---

## 5. Verify-this list (owner playtest, fresh profile)

Clear `localStorage` for the origin before each pass so `isFirstBoot()` is true
(`App.ts:606`).

- Time from page load to the **first frame you can steer on**. Target: under 8s
  on a warm cache, under 12s cold.
- Screenshot the frame the **"DRIVE" card** first appears on. Count the zombies
  in it. Today: zero. Target: a visible crowd.
- From pressing W, count seconds until the **first zombie is on screen**.
  Today: ~5–10s. Target: immediate.
- Count how many times the world **stops** before you're playing freely.
  Today: 5. Target: 3 or fewer.
- Play the first 60 seconds **with the volume up** and ask whether it sounds like
  a finished game.
- Screenshot the HUD at t=20s and count the distinct widgets. Today: ~12.
  Target: 4.
