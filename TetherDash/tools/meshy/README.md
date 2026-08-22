# Meshy -> sprite pipeline

Meshy makes rigged 3D models; the game draws sprites. These two scripts are the
bridge, and they are checked in because the conversion has parameters that are
not guesses -- get the camera wrong and the runners look like they are standing
on a different floor from the one they run on.

```
blender -b --factory-startup --python render.py -- \
    fbx=<abs path>/walk.fbx out=<abs path>/volt/f \
    yaw=180 frames=1-32 w=200 h=240 ortho=1.9 tz=0.95

python pack.py ../../assets
```

`render.py` writes one PNG per animation frame; `pack.py` grades them to the
game palette, adds the rim, and packs the 8-frame sheets into `assets/`.

## Why each argument is what it is

| Argument | Why |
| --- | --- |
| `yaw=180` | The game is a behind-the-runners runner, so the camera is behind the model. Meshy's biped faces -Y, so yaw 0 is its face and 180 is its back. Render a `contact=1` sheet first if a new model's facing is unknown. |
| `pitch=27.4` (default) | `atan(CAM_HEIGHT / CAM_BACK)` = `atan(4.4 / 8.5)`. This is the game camera's own depression angle; matching it is what makes the sprite sit in the world. |
| `ortho=1.9`, `tz=0.95` | A **fixed** camera box, not a per-model fit. Two characters rendered with the same box share one pixel-per-world-unit and one ground line, so the game scales both by a single constant and the short one comes out short. Auto-fit would silently normalise Bea back to Volt's height. |
| `w=200 h=240` | 2x the sprite's on-screen size, feet on the bottom edge. `CFG.RUNNER_FRAME_W/H` must agree. |
| `frames=1-32` | Meshy's walk action. `pack.py` samples 8 evenly for the sheet. |
| `scale=` | Only for reproportioning one rig into a second character. Applied via an empty parent -- object scale on a skinned mesh is cancelled by the armature deform. |

## The grade

Meshy's basecolor is muted: the body comes out `S=0.33 V=0.56` where the game's
palette is `S=0.61 V=0.84`. `pack.py` pushes the body hue onto the `Config.js`
colour and scales its mean saturation and value to match, rather than replacing
them flat, so the model's own shading survives.

It only touches pixels inside a hue band and above a saturation floor, which is
what keeps the near-grey visor and joints and the yellow accents their own
colour. Without that guard the grade turns the whole robot into one silhouette.

The rim is a dilation of the alpha filled with a darker shade of the body. Bea
is the case that needs it: her orange against the floor's yellow is close enough
in value that her outline dissolves at 100px without it.

## Source models

The Meshy download (~21 MB of FBX + 2048px PBR maps) is **not committed** -- it
is an input, not an artefact, and the repo has no LFS entry for it. Keep it
wherever you like and pass an absolute path. Only the rendered sheets ship.
