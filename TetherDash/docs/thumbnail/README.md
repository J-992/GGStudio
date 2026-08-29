# Thumbnail plates

Square (1:1) gameplay stills, shot for building the store thumbnail. Every one
is the real game rendering the real course -- nothing is drawn by hand and no
asset is faked -- but the frames are *posed*: the pair is placed mid-leap for
one frame and then frozen, the way a promo still is staged.

```
*.png             1440x1440, no HUD -- the working plates
1024/             1024x1024 -- Poki's square thumbnail size
with-hud/         1440x1440 with the level/bolt/timer HUD left on
wide/             2880x1620, the whole 16:9 frame the square was cut from
```

Pick order, best first:

| plate | level | what it shows |
| --- | --- | --- |
| `launch-party` | 13 Launch Party | both airborne off a pink pad, cord stretched wide -- the clearest read of the hook |
| `gear-alley` | 9 Gear Alley | symmetric leap either side of a gear, gate ahead |
| `tangle` | 14 Tangle Factory | the pair split across two lanes with the cord spanning the gap |
| `cord-critical` | 9 Gear Alley | cord in its red critical state, the "you are about to be yanked" frame |
| `conveyor` | 6 Conveyor Chaos | grey conveyor deck, one runner hauling the other, bolt popping |
| `gauntlet` | 15 The Gauntlet | wide diagonal cord across gears and a gate |
| `split-ends` | 7 Split Ends | the floor diverging into two lanes under the pair |
| `divided` | 11 Divided | centre wall between the two runners |
| `wide-gate` | 4 Wide Gate | double gate, the pair heading for opposite openings |
| `narrow` | 2 Stick Together | skinny track, nothing but void either side |
| `slalom` | 12 Slalom Storm | alternating platforms |
| `speed-run` | 10 Speed Run | fastest course, bolts streaming past |
| `moving-day` | 5 Moving Day | side-to-side moving platforms |
| `bolt-rush` | 3 Bolt Rush | bolt arc over a gap |
| `first-steps` | 1 First Steps | the plain opening course -- cleanest background of the set |

## Reshooting

`tools/thumbshots.mjs` drives the game in headless Chromium: both runners get
null input, so `CompanionAI` plays for them, and the script waits until the
feature it wants is 6-12 units ahead before setting the pose and pausing.

Two knobs exist only to serve the camera, and both are per-shot state, not game
changes: `CFG.CAM_BACK` / `CFG.CAM_HEIGHT` pull the camera in tighter than play,
and the `CFG.tether` lengths are squeezed so a photogenic separation lands on
the orange "high tension" cord -- at real thresholds that separation draws the
yellow cord, which vanishes against the yellow floor.

```
npm run dev            # or any static server on :8123
node tools/thumbshots.mjs
```

It needs `playwright-core` and a Chromium build; the path is at the top of the
script. Fresh shots land in `raw/` -- the curated copies here were picked and
downscaled by hand.
