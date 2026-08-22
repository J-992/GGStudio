# Meshy asset pack

The game ships on procedural placeholder art: every texture is drawn at runtime in
`src/systems/TextureFactory.js`. Each one can be replaced 1:1 by a rendered image with
the same key.

Meshy makes 3D models; this game draws sprites. So the pipeline is:

**prompt → Meshy model → render from a fixed camera → tight-cropped transparent PNG →
`assets/` → loaded under the old texture key.**

The camera angle is not a taste call — it is derived from the game's own camera (below).
Get it wrong and the character looks like it is standing on a different floor from the one
it is running on.

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

## 6. Rendering the sprites — the part that must be right

The game's camera is a pinhole looking straight down the run direction, sitting
`CAM_HEIGHT 4.4` units up and `CAM_BACK 8.5` units behind the runners. So the line of
sight to a character is **depressed about 27°**:

- **Characters:** camera directly **behind** the model, pitched **down ~25°**. You see the
  back of the head, the backpack, and a little of the top of the shoulders. Never a front
  or three-quarter view — the players only ever see these robots from behind.
- **Props (bolt, gear, pad):** same ~25° downward pitch, viewed head-on.
- Use an **orthographic** camera, or a long focal length (85mm+). A wide lens adds
  perspective the game's own projection will not agree with.
- **Flat, even lighting.** No cast shadow and no ground plane — the game draws its own
  contact shadow under each runner, and a baked one will double up.

Export **PNG with transparency**, cropped tight to the model with **no padding**, at 2x
the current texture size:

| Key | Current | Render at |
| --- | --- | --- |
| `runnerA` | 96 x 116 | 192 x 232 |
| `runnerB` | 100 x 108 | 200 x 216 |
| `bolt` | 44 x 44 | 88 x 88 |
| `gearHaz` | 160 x 160 | 320 x 320 |
| `padGlyph` | 48 x 56 | 96 x 112 |
| `cloud0` / `cloud1` / `cloud2` | 110x46 / 80x38 / 140x52 | 2x each |

For the characters, **the feet must sit on the bottom edge of the image** and the model
must fill the frame vertically. The game scales each runner to a fixed 1.18 world units
tall by reading the texture height (`GameScene.placePlayer`), so transparent padding at
the bottom becomes a robot hovering above the floor.

---

## 7. Wiring a finished render back in

Two of the scale factors hardcode the *current* texture size, so rendering at 2x needs the
divisor changed to match, in `GameScene.placeSprites()`:

```js
b.spr.setScale(pr.s * 0.5 / 44)            // bolt: 44 -> 88
gear.spr.setScale(pr.s * gear.r * 2 / 160) // gearHaz: 160 -> 320
```

The characters need no change — `placePlayer` divides by `spr.height`, so any resolution
works as long as the aspect ratio and the feet-on-the-bottom rule hold.

Loading them needs a small change to `BootScene`: `preload()` the PNGs that exist, then
let `TextureFactory.generate()` fill in only the keys that were not loaded, so the game
still runs with a half-finished asset set. That loader is not written yet — it is one
short pass once the first real PNG exists.

The course modules in §4 need more: `drawCourse` currently emits colored quads, so using
them means either rendering each module to a strip image and drawing it as a textured
quad, or moving the course to real geometry. Worth doing after the characters land, not
before.
