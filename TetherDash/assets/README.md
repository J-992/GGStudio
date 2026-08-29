# Meshy asset pack

## What is in here now

`runnerA.png` and `runnerB.png` are live: 8-frame walk-cycle sheets (200x240 per
frame) rendered from a Meshy biped and graded to the game palette. `BootScene`
loads them and falls back to the hand-drawn mascots if they are missing, so the
game still runs on a checkout without them.

**Both are the same rig.** Meshy produced one character; Volt is it, and Bea is
that model reproportioned (18% wider, 16% shorter) and hue-shifted to orange.
That is a stopgap, not the design: it gives two readable silhouettes today, but
Bea is supposed to have her own boxy body and ear flaps. Generating her properly
is the Bea prompt below plus one `render.py` run -- nothing in the game changes.

Still procedural: the bolt, the hazard gear, clouds, the pad glyph, all UI, and
every course surface.

The conversion pipeline and the reasoning behind its parameters is in
`tools/meshy/README.md`.

## What Meshy dropped from the prompt

Worth knowing before generating more. The model came back without the antenna
and bobble that the prompt asked for, and its colour arrived muted enough that
the grade in `pack.py` exists purely to fix it. Small protruding details and
saturated colour are the two things to check on every generation.

---

## 1. Shared style block

Paste this at the end of **every** prompt. It is what keeps twelve separately generated
models looking like one toy set.

```
low-poly stylized 3D toy, chunky rounded shapes, thick proportions, matte plastic
material, flat bright colors, soft bevelled edges, bold readable silhouette, simple
forms with no fine detail, clean studio lighting, isolated on a plain background,
game asset
```

And this in the **negative prompt** field:

```
realistic, photorealistic, gritty, dark, scary, weapons, text, letters, numbers, logos,
thin fragile parts, spindly limbs, intricate detail, cluttered, busy surface texture,
noise, human face, sharp edges, motion blur, background scenery, shadows on the ground
```

**The one rule that governs everything here:** these render to roughly 100 pixels tall on
screen. Anything smaller than about 1/8th of the model reads as mud. Prefer one big
shape over five small ones, every time.

Suggested Meshy settings: **Stylized** art style, symmetry **on** for the characters and
props, target polycount **low** (a few thousand triangles is plenty — nothing here is ever
seen in 3D), quad topology, and PBR textures on.

---

## 2. Characters — do these first

The two mascots carry the game. Their single hardest requirement is that a 7-year-old can
tell them apart at 100px in motion: **Volt is tall, round and antennaed; Bea is short,
wide and eared.** Generate both, put the two silhouettes side by side in black, and if you
cannot instantly name them, regenerate rather than proceeding.

### `runnerA` — Volt

```
A cute chunky robot mascot with a tall rounded capsule body in bright teal, a large
domed head, one thin antenna on top ending in a glowing yellow ball, two small round
white eyes, short stubby arms, thick little legs with big rounded boots, and a small
yellow-lit battery pack mounted on its back
```

### `runnerB` — Bea

```
A cute chunky robot mascot with a short wide boxy body in bright orange, a squarish
head with two triangular ear flaps sticking out to the sides, two small round white
eyes, short stubby arms, thick little legs with wide rounded boots, and a coiled yellow
spring mounted on its back
```

Both need a **neutral standing pose, arms at the sides** — the game fakes the run cycle
with squash/stretch and tilt, so a posed or mid-stride model will fight it.

---

## 3. Props

| Key | Prompt |
| --- | --- |
| `bolt` | `A chunky golden collectible bolt, a thick hexagonal head ringed with eight rounded gear teeth, a bright yellow cap in the center, glossy gold toy plastic` |
| `gearHaz` | `A large industrial toy gear wheel with ten thick rounded teeth, a grey plastic disc body with five round holes, and a bright yellow hub cap at the center` |
| `cloud0-2` | `A fluffy cartoon cloud built from a few soft overlapping spheres, pure white, smooth matte surface, chunky and simple` |
| `padGlyph` | `A round bouncy launch pad, bright pink rubber top marked with two white upward chevron arrows, thick spring coil base` |

Generate the cloud three times at different widths (wide, small, extra wide) for `cloud0`,
`cloud1`, `cloud2`, or scale one render.

---

## 4. Course modules

These are **not sprites today** — the floor, conveyors, gates and pads are drawn as
projected quads by `GameScene.drawCourse()`. Models for them are worth making, but they
need a renderer change to land (see §7), so treat this section as the second wave.

| Module | Prompt |
| --- | --- |
| floor tile | `A thick square toy building block platform, glossy yellow plastic, rounded corners, four low studs on top, flat walkable surface` |
| conveyor | `A short straight conveyor belt module, silver-grey metal frame with a dark rubber belt, raised chevron treads across it, flat top` |
| gate wall | `A factory gate wall panel, purple plastic with a thick rounded frame and a flat front face, chunky toy machine part` |
| checkpoint arch | `A simple arch gateway of two thick round posts and a flat crossbeam, mint green plastic with a glowing yellow light strip` |
| launch pad | (same as `padGlyph` above, as a full 3D module) |
| giant tube | `A short section of a giant hollow tube, glossy light blue plastic, thick rounded rims at both ends` |
| fan | `A round industrial fan unit with four thick curved blades in a grey and yellow housing` |
| background block | `A chunky toy factory machine block with fat pipes, one round dial, and a yellow warning stripe, pastel plastic` |

Everything must **tile along the run direction in 3-unit steps** — that is the strip size
`drawCourse` emits, and a module that does not tile will visibly seam.

---

## 5. Palette

Match these exactly; they are the values in `src/Config.js`, and the procedural art the
models sit next to is drawn from them.

| Thing | Hex |
| --- | --- |
| Volt teal | `#53c8d6` (dark `#2c7f8c`) |
| Bea orange | `#ff9a3d` (dark `#d66a1f`) |
| Accent yellow | `#ffd35c` |
| Floor yellow | `#ffd45c` / `#ffc247`, edge `#e09a2a` |
| Conveyor silver | `#a7b6c9` / `#8b9cb1` |
| Wall purple | `#7e6ff0` |
| Pad pink | `#ff7ab8` |
| Sky | `#8ecdf4` → `#d7ecfb` |

---

## 6. Rendering the sprites

`tools/meshy/render.py` does this, and `tools/meshy/README.md` explains why each
argument is what it is. The short version:

- **Camera behind the model** (`yaw=180` for a Meshy biped, which faces -Y), pitched
  down `27.4°` -- that is `atan(4.4 / 8.5)`, the game camera's own depression angle.
  Never a front or three-quarter view; players only see these robots from behind.
- **Orthographic**, and a **fixed** camera box shared by every character, so two models
  come out with the same pixels-per-world-unit and the same ground line. Per-model
  auto-fit would normalise a short character back to a tall one's height.
- **Flat shading** -- base colour piped to emission. The game draws its own contact
  shadow, so no baked shadow and no ground plane.
- 200x240 per frame, **feet on the bottom edge**, transparent PNG. Headroom above the
  head is expected and is what `CFG.SPRITE_H_MESH` accounts for.

## 7. Wiring a finished render back in

For the two runners there is nothing to wire: drop the sheets in as `assets/runnerA.png`
and `assets/runnerB.png`, 8 frames of `CFG.RUNNER_FRAME_W` x `CFG.RUNNER_FRAME_H`, and
`BootScene` picks them up. Change the frame size and `CFG.RUNNER_FRAME_W/H` must change
with it, or the sheet slices wrong.

For the still props, two scale factors in `GameScene.placeSprites()` hardcode today's
texture sizes, so rendering at 2x means changing the divisor to match:

```js
b.spr.setScale(pr.s * 0.5 / 44)            // bolt: 44 -> 88
gear.spr.setScale(pr.s * gear.r * 2 / 160) // gearHaz: 160 -> 320
```

The course modules in §4 need more than an asset: `drawCourse` emits coloured quads, so
using them means rendering each module to a strip and drawing it as a textured quad, or
moving the course to real geometry. Worth doing after the characters are final.
