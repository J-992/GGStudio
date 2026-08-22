# Meshy asset manifest

The game runs entirely on procedural placeholder art. Each model below replaces one
texture key generated in `src/systems/TextureFactory.js` (render to transparent PNG at
2x the current texture size, same key, drop-in). Keep everything low-poly, chunky,
toy-like, and rendered from one consistent behind/three-quarter camera angle to match
the fake-3D course.

## Characters (highest priority)

| Key       | Model | Notes |
| --------- | ----- | ----- |
| `runnerA` | **Volt** — tall round teal robot, single yellow bobble antenna, battery backpack | back view, 96x116 texture today; distinct silhouette vs Bea |
| `runnerB` | **Bea** — short square orange robot, twin ear flaps, coil backpack | back view, 100x108; wider than tall |

## Course modules (drawn as colored quads today — future 3D pass)

- modular floor piece, 3-unit stripe, yellow toy-plastic (two alternating shades)
- narrow track piece (same material, 2 units wide)
- conveyor piece, silver with chevron belt texture (animated stripes)
- wall/gate block, purple plastic with rounded edges
- launch pad, pink disc with spring underneath
- checkpoint arch, mint (gold when activated)
- finish line, checkered banner

## Props & pickups

| Key        | Model |
| ---------- | ----- |
| `bolt`     | golden gear/bolt collectible (44px today) |
| `gearHaz`  | big grey factory gear, 10 teeth, yellow hub (160px, spins) |
| `padGlyph` | up-chevrons decal for launch pads |
| `cloud0-2` | puffy cloud billboards (3 sizes) |

## Background factory modules (new, decorative)

- giant tube segments, curved and straight
- toy blocks (A/B/C letter cubes) in stacks
- slow-spinning background gears, 2 sizes
- fan unit (spinning blades)
- crane arm holding a dangling toy part

## Rules of thumb

- One material palette across everything: saturated plastic, soft AO, no textures
  finer than the toy scale.
- Every course module must tile along z in 3-unit steps.
- Characters need a neutral run pose (the game fakes gait with squash/stretch and
  tilt, no skeletal animation required for the first pass).
