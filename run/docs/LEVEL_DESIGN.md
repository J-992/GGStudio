# Tether Run — level design

Two robots, one elastic tether, a square tunnel that can turn under you. This is
the reference for how a level is written and how the twenty of them are paced.

See [CAMPAIGN_RESEARCH.md](CAMPAIGN_RESEARCH.md) for the revised curriculum,
visual language and research. [ELASTIC_VERSION.md](ELASTIC_VERSION.md) describes
the implemented elastic campaign and the remaining prototype scope.

## Reading a level

A level is a list of slices. One slice is 2 units of tunnel; the pair covers
4.5 slices a second, so a 90-slice level runs about twenty seconds.

Each slice gives a five-character pattern to any of the four faces — `f` floor,
`c` ceiling, `l` and `r` walls. A face you leave out is solid all the way across.
Columns run left to right on the floor and ceiling, and bottom to top on the two
walls, so a `>` belt on the left wall pushes you up it.

```
#   solid panel
M   powered magnetic rail — hold grip to anchor sideways while moving forward
.   nothing — a hole in that face
~   crumble tile, drops a beat after weight lands on it
^   launch pad, throws you about five units off the face
<   conveyor toward column 0
>   conveyor toward column 4
=   ferry — a platform tracking back and forth across its lane
+   ferry running half a cycle behind "="
!   shutter — a barrier that rises out of the face and kills while it is up
?   shutter half a cycle behind "!", so a "!?" pair always leaves one lane open
```

Gravity rolls change the chosen face. Courses with `drum: { speed }` also rotate
their actual terrain and kinematic collision bodies continuously around Z.
Speed is signed radians per simulation second; scenery stays fixed. Drum
courses currently use rigid panels and magnetic rails only, not crumbles,
spinners, ferries, belts, launch pads or shutters.

## Rules that come from the physics

**A jump clears about two slices, a launch pad about five.** Jump height is
~2.1 units held, giving roughly a second of air. A pad gives 5.25 units and
about 1.2 seconds, which lands you five and a half slices downrange. Put solid
ground where that lands: a pad, then three slices of void, then floor.

**Three blank slices on a face means "roll", one or two means "jump".** A face
that is fully `.....` for three slices or more reads as an instruction to get
onto another face. Shorter holes are gaps you clear on foot, and they work on
walls and ceilings the same as on the floor.

**Every face hand-off needs an overlap.** A roll is instantaneous, so the face
you are rolling onto has to be under you at that moment, not four slices later.
Narrow the old face toward the exit, bring the new one in while the old one is
still there, and only then take the old one away:

```ts
rep(4, { f: E, r: E, c: E, l: pat("###..") }),           // walk down the wall
rep(4, { f: pat("##..."), r: E, c: E, l: pat("###..") }),// both exist — roll here
rep(8, { f: pat("##..."), l: E, r: E, c: E }),           // wall gone
```

**A void is all four faces at once.** `voidRun(n)` removes the floor, both walls
and the ceiling, so rolling is not an escape and the gap has to be jumped or
crossed on a pad. Use it to make a pad mandatory rather than optional.

**The tether is eight units at full stretch.** Two lanes at columns 0 and 4 put
the pair exactly at that limit and the spring will throw somebody. Edge-only
patterns like `#...#` are a late-game tool, not an early one.

**A ferry never drops a centred robot.** Sliders travel half a tile each way,
which is the largest sweep where a platform still covers its own lane at both
ends of its stroke. Standing on the middle of a ferry is safe; standing on its
lip is not.

**A barrier only kills inside its own lane.** The lethal box tests the robot's
centre against the barrier's tile, so stepping one column across is genuinely
safe. Barriers have no collider — they are light, not walls.

## The twenty

Five acts of four. Each act opens by teaching one verb on ground where failing
is hard, then spends the rest of the act combining it with everything already
learned.

| # | Name | Teaches | Adds |
|---|------|---------|------|
| 1 | Warmup Conduit | move, jump | — |
| 2 | Step Up | crumble | landing on tiles that fall |
| 3 | Catch Me | grip, partner catch | explicit recovery |
| 4 | Pendulum Run | swing | moving forward while anchored |
| 5 | Wall Roll | rolling onto a wall | the tunnel turns |
| 6 | Two Turn | roll and roll back | the ceiling holds you |
| 7 | Slingshot Alley | stretch, jump inward, release | retained spring momentum |
| 8 | Leapfrog | alternate anchors | shorter regroup windows |
| 9 | Slow Revolution | real rotating terrain | floor → wall → ceiling |
| 10 | Follow the Opening | four-face drum route | opposite rotation direction |
| 11 | Orbit Partners | rotating magnetic anchors | all four faces |
| 12 | Carousel Rescue | combine grip and rotation | faster reverse rotation |
| 13 | Split Current | conveyors plus rails | counterflow |
| 14 | Springboard Relay | launch pads plus rails | true voids |
| 15 | Ferry Handoff | moving decks plus rails | opposite-phase transfers |
| 16 | Shutter Partners | shutters plus rails | timing |
| 17 | Elastic Overdrive | conveyors and barriers | optional anchors |
| 18 | Helix Handoff | four faces and moving decks | anchor handoffs |
| 19 | Longfall Catch | pads, ferries and shutters | recovery opportunities |
| 20 | Carousel Finale | faster rotating anchors | mandatory four-face route |

Introductions give players space to read the next demand, then narrow or combine
it after practice. The back four keep the hardest combinations, with recovery
space at face transfers and landings. Levels 10–12, 18 and 20 require all four faces;
unused faces disappear so the intended circuit cannot be skipped on the opposite
wall. Automated completion is a traversal check, not evidence of human fairness.

## Verifying a level

`scripts/levels-qa.mjs` plays every level with the headless bot driving both
robots independently and reports where each death happened:

```
node scripts/levels-qa.mjs all            # every level, twice through
node scripts/levels-qa.mjs 13-16 --trace  # a range, with the bot's decisions
node scripts/levels-qa.mjs 20 --speed 3   # faster than real time, for iterating
node scripts/levels-qa.mjs all --collide  # with robot-on-robot collision on
```

A failure prints the cause, the slice and which robot died — `fell-out @ slice
48 on Floor (P2)` — which is usually enough to find the offending pattern
without opening the game. A fall is reported where the robot finally dies, not
where it stepped off, so look a few slices upstream.
