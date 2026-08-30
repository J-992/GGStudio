# Tuning Guide

Everything that shapes how the cat moves lives in one file:

```
src/physics/PhysicsConfig.ts
```

`DEFAULT_PHYSICS` holds the shipped values. `PHYSICS` is the live working copy
the game reads every step, so you can retune without a rebuild:

```js
// In the browser console, while playing:
__game // the Game instance is exposed for exactly this
```

```js
// Or import and poke the config directly from any module:
import { PHYSICS, resetPhysicsConfig } from './physics/PhysicsConfig';
PHYSICS.laneSnapRate = 4;   // sluggish, lazy lane changes
resetPhysicsConfig();       // back to shipped values
```

Press **F2** while playing to see live speed, slip, grounded state, lane,
segment, progress and chase distance. Tune with the panel open — most of these
values are much easier to judge by number than by feel.

---

## The model: prescribed, not driven

The cat is a Temple Run–style three-lane auto-runner, not a free-driving car.
`PlayerController` writes the body's yaw and horizontal velocity outright every
fixed step and leaves the vertical component alone:

- **forward** — a constant `PHYSICS.runSpeed` along the current heading.
  There is no throttle; the player never controls speed.
- **sideways** — a proportional seek toward the target lane's offset from the
  track centreline.
- **vertical** — untouched, so gravity, the jump impulse and falling off the
  world all still come from the Rapier solver for free.

The controller capsule stays a **dynamic** Rapier body rather than going
kinematic, and that is deliberate: Rapier applies no gravity to kinematic
bodies and resolves no contacts for them, so a kinematic runner would mean
reimplementing gravity, ground snapping, landing detection and wall blocking
by hand. Prescribing velocity on a dynamic body keeps all four for free, and
contact resolution still wins against a wall — the runner is stopped by
geometry, it just isn't pushed around by it.

Everything that used to be a force — throttle, steering torque, grip friction,
upright torque, tumble recovery — is gone. There is no `PlayerState.Tumbling`
any more; a bad landing or hit is a brief `Stumbling` mush, and falling or
being caught is handled through the lives system below, not a body flopping
over and recovering on its own.

---

## The pair that sets every jump: `runSpeed` and `GAP_COMPRESSION`

> **These two numbers are a matched pair. Moving one without the other makes
> levels uncompletable.**

`PHYSICS.runSpeed` (11 u/s) is constant — the player has no way to run faster
or slower — so it is also the *only* variable in how far a jump reaches. With
`gravity` at `-18` and `jumpImpulse` at `7.9`, the measured flat-to-flat jump
is **9.53 units**. That number is not a design choice made against the levels;
it is a *consequence* of `runSpeed`, `gravity` and `jumpImpulse` together, and
the levels are built to fit inside it.

Every gap in the campaign was originally authored for a much faster,
force-driven cat. Rather than re-author three levels' worth of hand-placed
buildings, `src/levels/LevelGeometry.ts` applies a pure load-time transform,
`compressGaps(level, GAP_COMPRESSION)`, wired up in `src/levels/index.ts`.
`GAP_COMPRESSION = 1/3` pulls every authored building a third of its gap
closer to the one before it, without touching the hand-placed coordinates —
so what ships is always a transformed copy, never the raw `level1`/`level2`/
`level3` exports.

If you change `runSpeed` (or `gravity` or `jumpImpulse`, which combine with it
to set jump reach), you must re-measure the flat-to-flat jump and update
`GAP_COMPRESSION` to match, or some authored gap will no longer be crossable.
`npm test` walks every level's compressed geometry and will tell you which gap
you just broke.

---

## Every parameter

### World

| Parameter | Default | Notes |
|---|---|---|
| `gravity` | `-18` | Heavier than real gravity on purpose — it makes arcs snappy and landings decisive. This feeds directly into jump reach, so changing it means re-measuring against `GAP_COMPRESSION` (see above). |
| `fixedTimeStep` | `1/60` | **Do not change.** Every other value is tuned against it, and changing it silently rescales all forces. |
| `maxSubSteps` | `5` | Catch-up steps allowed after a stall. Higher risks a death spiral on slow devices; lower makes a hitch skip time. |

### Body

| Parameter | Default | Notes |
|---|---|---|
| `mass` | `1.6` | Scales the jump impulse (`jumpImpulse * mass`) and how hard other physics props shove the cat on a collision. Prescribed horizontal motion ignores it entirely. |
| `colliderRadius` | `0.34` | Capsule radius. Bigger = catches on edges more, and eats into `maxStepUp` headroom. |
| `colliderHalfHeight` | `0.16` | Capsule cylinder half-height. |
| `linearDamping` | `0.12` | Passive velocity bleed. Since horizontal velocity is rewritten every step anyway, this mostly matters for how the vertical component (falls, jump arcs) settles. |
| `angularDamping` | `1.6` | Spin bleed on the body's angular velocity. Angular velocity is zeroed every step in `applyHeading`, so this only ever damps the single frame between writes — raise it if you ever see residual spin between steps. |

### Run

| Parameter | Default | Notes |
|---|---|---|
| `runSpeed` | `11` | **The pace of the whole game.** Constant, unthrottled forward speed, and the sole input to jump reach — see the coupling section above. Raising it makes levels *easier*, not harder, because there is no approach speed to get wrong. |
| `laneSpacing` | `2.4` | Sideways distance between adjacent lane centres. Three lanes span `2 * laneSpacing` plus the capsule; keep it inside the narrowest authored walkway. |
| `laneSnapRate` | `9` | How fast the lane seek closes the gap to the target lane, 1/s. It's a proportional controller, so this is roughly the inverse of the time constant — `9` crosses a lane in under a fifth of a second. Raise for snappier lane changes, lower for a heavier, more telegraphed feel. |
| `maxLaneSpeed` | `11` | Ceiling on sideways speed, so a lane change never outruns the animation regardless of how far off-centre the runner starts. |
| `airControl` | `0.55` | Fraction of lane-seek authority retained in the air. Above ~0.7 jumps stop being commitments; below ~0.3 you can't line up a landing. |

### Turning

| Parameter | Default | Notes |
|---|---|---|
| `turnBlendTime` | `0.22` | Seconds for the heading to sweep through a 90-degree corner once committed. Lower is a snappier, more arcade turn; too low and the camera can't keep up. |
| `turnZoneBefore` | `14` | How far before a corner (in track distance) a turn input starts being accepted. Generous by design — at `runSpeed` 11 the runner covers 10 units in under a second, so a tight window is a reaction test, not a decision. |
| `turnZoneAfter` | `4` | How far past a corner a late double-tap is still honoured. |
| `headingEaseRate` | `3.2` | How quickly the heading eases through a *soft* bend (one gentle enough to need no input), 1/s. Pure presentation — too low and the runner visibly cuts the corner off its own rooftops, too high and the camera snaps. |

A **soft** junction is crossed automatically; a **turn** junction is not — the
segment index only advances when the player lands a double-tap while
`inTurnZone` is true, so a missed corner carries the runner straight off the
roof. See `RunPath.ts` for how a junction is classified.

### Grip

| Parameter | Default | Notes |
|---|---|---|
| `lowGripDrift` | `2.6` | Sideways drift, units/s, on a surface with no grip at all. Prescribing velocity makes collider friction physically irrelevant, which would otherwise quietly erase the difference between terracotta and the metal/glass roofs levels 2 and 3 are built around — so the ground's friction coefficient is read back off the raycast each step and converted into this much outward drift plus a lane-seek penalty. |
| `fullGripFriction` | `0.85` | Friction coefficient treated as full grip. At or above this, nothing is lost. |
| `slipThreshold` | `1.2` | Sideways speed (units/s) above which the cat is considered sliding — gates the slide sound/particles and the HUD debug readout. |
| `maxStepUp` | `0.5` | **Read this one carefully.** With velocity prescribed every step, contact resolution wins outright against a vertical face, and nothing ever gives the capsule the vertical speed to climb it — so a lip taller than this is not a bump, it is a *permanent* stop. Measured: `0.3` is survivable but costs almost all forward speed, `0.4` stops the runner dead. The step-up assist in `tryStepUp()` exists specifically to lift the runner over anything up to this height so authored seams and ramp lips don't become invisible walls. Raise it only as far as the geometry needs — too generous and it starts eating real obstacles. |
| `blockedGraceTime` | `0.35` | Seconds the runner may be held near-stationary against unclimbable geometry before `detectBlocked` counts it as a crash. |

### Jump

| Parameter | Default | Notes |
|---|---|---|
| `jumpImpulse` | `7.9` | Jump height and, combined with `runSpeed` and `gravity`, jump *reach*. See the coupling section above before changing this. |
| `coyoteTime` | `0.1` | Grace period after leaving a ledge. `0.1s` is the sweet spot; above `0.2` it starts to feel like cheating. |
| `jumpBufferTime` | `0.14` | Early presses are remembered this long. Raise if landing-and-jumping feels unresponsive. |
| `jumpCooldown` | `0.18` | Minimum spacing between jumps. Note this is *not* what prevents air jumps — a latch cleared only by a genuine landing does that. The ground probe reaches below the cat, so "grounded" stays true briefly into a rise, and a timer alone would let a held jump button stack impulses. |

### Ground detection

| Parameter | Default | Notes |
|---|---|---|
| `groundRayLength` | `0.62` | How far below the capsule counts as standing. Too long and the cat "sticks" to ground it has left. |
| `groundProbeExtra` | `0.5` | Extra ray length used only for coyote/landing prediction, not for the grounded test itself. |
| `maxSlopeAngle` | `52` | Steeper surfaces are treated as walls, not floors — this is also what `probeWall`/`wallAhead` uses to decide a face ahead is unclimbable. Raise to let the cat run up steeper roofs. |

### Stability & recovery

| Parameter | Default | Notes |
|---|---|---|
| `hardLandingSpeed` | `13` | Downward impact speed above which a landing triggers a stumble. |
| `stumbleDuration` | `0.45` | Seconds of reduced authority (40% lane-seek gain, 75% forward speed) after a hard landing or a clipped obstacle. |
| `fallThreshold` | `3.5` | How far the runner may drop below the last ground it stood on, while airborne, before `Game.ts` treats it as a fall and spends a life. Well under any authored step, well over any lip — see `maxStepUp` above for the geometry side of that distinction. |

### Collisions

| Parameter | Default | Notes |
|---|---|---|
| `collisionKnockback` | `4.5` | Sideways shove on hitting an obstacle head-on. |
| `collisionMinSpeed` | `3.5` | Below this relative speed, a collision is ignored entirely. |
| `collisionSpeedLoss` | `0.28` | Fraction of speed lost on a solid hit. |

### Camera coupling

| Parameter | Default | Notes |
|---|---|---|
| `fovExpansionSpeed` | `9` | Speed at which FOV starts widening. |
| `fovExpansionAmount` | `11` | Maximum extra FOV degrees at top speed. Above ~18 it gets nauseating. |

### Failure

| Parameter | Default | Notes |
|---|---|---|
| `killPlaneY` | `-30` | World Y below which the attempt fails outright, overridden per level (level 1 uses `-6`). Note that falling *isn't* usually what triggers this any more — `fallThreshold` above catches most falls first and spends a life instead. The kill plane is the last-resort backstop. |

---

## Lives, not instant failure

A failed obstacle, a missed turn, or a fall no longer ends the run by itself.
`Game.ts` gives the player **3 lives** per attempt (`LIVES_PER_RUN`), shown as
🐾 icons top-right, and:

- losing a life grants `INVULN_DURATION` (2 simulated seconds) of
  invulnerability, rendered as the cat cycling through transparency, during
  which contacts do nothing and a fall recovery puts the runner back on the
  track it just left;
- only the *third* loss actually fails the run, through the same
  `GameState.Failed` path that always existed.

This lives entirely in `Game.ts`, not `PhysicsConfig.ts` — there is no
tunable here for it, but it changes how you should read a fall or a hit while
testing: one bad jump is a stumble and a reset-in-place, not game over.

---

## Recipes

### Make lane changes snappier

```ts
laneSnapRate: 14      // closes the gap to a new lane almost instantly
maxLaneSpeed: 15      // let the seek actually reach that rate
```

### Make corners more forgiving

```ts
turnZoneBefore: 20     // more track to notice the corner coming
turnZoneAfter: 7        // more room to land a late double-tap
turnBlendTime: 0.32     // a slower, gentler sweep through the corner
```

### Make grip matter more

```ts
lowGripDrift: 4.2            // low-grip roofs push you around harder
fullGripFriction: 0.95       // fewer surfaces count as "full grip"
slipThreshold: 0.8           // the cat reads as sliding sooner
```

### Change chase pressure

Chase tuning is **per level**, in each level file's `chase` block — not in
`PhysicsConfig`.

```ts
chase: {
  dogStartGap: 30,     // lower = dogs breathing down your neck from the start
  chefStartGap: 55,
  dogSpeed: 10.5,      // keep below runSpeed or a clean run becomes impossible
  chefSpeed: 8.5,      // must stay below dogSpeed
  catchUpSpeed: 5.5,   // rubber-band strength — how fast they close a gap
  catchUpRange: 40,    // distance over which the rubber band ramps in
  catchDistance: 2.2,  // route distance at which you are caught
}
```

- **More tension, same fairness:** raise `catchUpSpeed`, lower `catchUpRange`.
  Pursuers stay close but a runner who hits every jump and corner still
  escapes.
- **Genuinely harder:** raise `dogSpeed` toward `runSpeed` — there is no
  approach-speed margin to eat into any more, so this is a hard, direct dial.
- **Punish a stumble harder:** in `Pursuer.computeSpeed`, the `slowFactor`
  term adds up to `catchUpSpeed * 0.5` when the player is below 55% of
  `runSpeed`. Raise that `0.5` coefficient.

### Change camera damping

In `src/camera/FollowCamera.ts`, `DEFAULT_CAMERA`:

| Parameter | Default | Effect |
|---|---|---|
| `positionDamping` | `6.5` | Higher = camera glued to the cat. Lower = more lag and drama. |
| `rotationDamping` | `4.2` | How fast the camera swings to follow the travel direction. Lower feels cinematic; too low and you can't see corners coming. |
| `lookDamping` | `9` | How fast the look-at point catches up. Keep above `positionDamping`. |
| `distance` | `3.0` | Pull back for more route visibility, in for more speed sensation. |
| `height` | `1.35` | Higher shows the route better; lower is more dramatic. |
| `lookAhead` | `3.2` | How far ahead of the cat the camera aims. |
| `lookHeight` | `0.45` | Height of the aim point above the cat. Roughly its shoulder. |
| `velocityYawMinSpeed` | `2.5` | Below this the camera follows the body instead of the velocity. Since forward speed is now constant, this mostly matters right after a corner, while the heading is still sweeping. |

**Watch the character size if you touch `distance` or `height`.** The player is
a cat: about 1.1 units nose-to-tail and 0.3 at the shoulder, which is far
smaller than the humanoid these numbers are usually tuned for. The originals
(`6.2` / `2.5`) are perfectly reasonable for a person and left the cat **44
pixels tall on a 624-pixel viewport** — under 8% of screen height, too small to
read its lean, its tail or which way it was facing. The current values put it at
roughly 14%. If you pull the camera back, check the result rather than trusting
the feel of the numbers.

The camera intentionally tracks **velocity direction**, not body heading, so a
corner sweep doesn't whip the camera around ahead of the body itself.

The **Reduced Camera Motion** accessibility setting multiplies all damping by
1.8 and disables FOV expansion and shake.

### Tune mobile lane changes

Touch lane input is a single button tap, so it behaves identically to a
keyboard tap — the responsiveness knob for touch is the same `laneSnapRate`
and `maxLaneSpeed` used everywhere else. There is no separate touch-only
steering curve any more, because there is nothing continuous left to tune.

- Button size: **Settings → Touch control size**, or `settings.touchControlScale`
  (0.7–1.5). Applied live to already-mounted controls.
- There is no brake button — there is no throttle to fight.
- Layout and hit areas are pure CSS — `.touch-btn` in `src/styles/main.css`.

---

## Things that are not physics

- **Difficulty** is mostly level geometry (gap widths, platform widths, lane
  width at pinch points) and chase tuning, not `PhysicsConfig`. Reach for the
  level file first.
- **Gap sizing** is a two-step story: author against whatever felt right for
  the old force-driven cat, then let `compressGaps`/`GAP_COMPRESSION` in
  `src/levels/index.ts` do the fitting. See the coupling section above.
- **Surface friction** per material lives in `SURFACE` in
  `src/obstacles/ObstacleFactory.ts` — terracotta `0.9`, wood `0.95`, metal
  `0.35`, awning `0.28`, glass `0.15`. This is what `lowGripDrift` and the
  lane-seek grip penalty read back at runtime, so a metal roof genuinely
  changes how a corner must be taken even though nothing pushes the cat
  directly any more.
- **Lives and invulnerability** live in `Game.ts` (`LIVES_PER_RUN`,
  `INVULN_DURATION`), not `PhysicsConfig`. See "Lives, not instant failure"
  above.
- **Cosmetic cat skins never affect physics.** They only swap a texture.
