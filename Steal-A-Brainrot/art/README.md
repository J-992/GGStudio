# Art pipeline

The game draws sprites from `assets/sprites/`, falling back to procedurally-drawn
placeholders for any texture key that has no sprite. This directory holds the
inputs that produce those sprites. There are two paths into it:

| Input | Goes in | Built by |
| --- | --- | --- |
| Character artwork (PNG with alpha) | `art/source/` | `tools/import-art.mjs` |
| 3D models (`.glb`/`.fbx`/`.obj`) | `art/models/` | `tools/render-art.mjs` |
| Drawn in code | `tools/draw-characters.js` | `/tools/draw-characters.html` |

All three write `assets/sprites/<key>.png`, and the manifest is rebuilt from
whatever ends up in that folder:

```bash
node tools/import-art.mjs --manifest    # rescan sprites, rewrite the manifest
```

The game currently mixes them — the 20 creatures come from artwork, the player
and five rivals are drawn in code.

Inputs are **not** committed (see `.gitignore`); the sprites they produce are,
because the game loads them at runtime and they have to be in the Poki build.

## Path 1 — character artwork

Drop transparent PNGs into `art/source/`, named after the character:

```bash
node tools/import-art.mjs                            # match filenames, dry run
node tools/import-art.mjs --apply                    # build the sprites
```

Filenames are matched to creature names, so `tralalero-tralala.png` finds
Tralalero Tralala. The dry run prints the mapping and anything it could not
place; fix those with `--map=<file>:<key>`, e.g.

```bash
node tools/import-art.mjs --apply --map=la-vaca-saturno-saturnita.png:cr_vacca
```

Each image is cropped to its alpha bounding box, fitted inside a 352px square by
its longer side, centred, and stood on the bottom edge. Source images can be any
size — only the alpha matters.

## Path 2 — drawn in code

The player and the five rivals live in `tools/draw-characters.js` — one
`drawKid()` function, six palettes/poses, rendered to 352px canvases. Serve the
project, open `/tools/draw-characters.html`, and save the PNGs into
`assets/sprites/`, then `node tools/import-art.mjs --manifest`.

Editing one means editing its entry in the `CAST` array at the bottom of that
file. Sourced artwork dropped into `art/source/` under the same key overrides
it, since both write the same sprite.

## Path 3 — 3D models

### Importing a bought character pack

A pack names its files however it likes. Point the importer at the folder and it
maps them onto texture keys by character name:

```bash
node tools/import-models.mjs "D:/packs/italian-brainrot"           # dry run
node tools/import-models.mjs "D:/packs/italian-brainrot" --apply   # copy them in
node tools/render-art.mjs                                          # render all
```

The dry run prints the mapping and what it could not place — review it, because
fuzzy matching across 18 similar names does get things wrong. Fix any it missed
with `--map=<filename>:<key>`, e.g.
`--map=shark_final.fbx:cr_tralalero,cow.fbx:cr_vacca`.

It copies each model into `art/models/<key>/` **with the texture maps sitting
beside it** — an FBX with external maps renders untextured if you move the model
away from them.

### One model at a time

```bash
# 1. drop a model in, named after the texture key it replaces
#    art/models/cr_tralalero.glb

# 2. find which way it faces (8 views land in art/turntable/<key>/)
node tools/render-art.mjs --turntable=cr_tralalero

# 3. record the yaw you picked
#    art/models.json -> { "cr_tralalero": { "yaw": 180 } }

# 4. render
node tools/render-art.mjs
```

That writes `assets/sprites/<key>.png` and rewrites `assets/manifest.json`.
Reload the game and the sprite is in.

Re-running only re-renders models newer than their sprite; `--force` does all of
them, `--only=cr_vacca,player` does a subset.

## Texture keys

| Key | What it is | On-screen height |
| --- | --- | --- |
| `cr_<id>` | a creature — ids are in `src/data/creatures.js` | 88 px |
| `player` | the player character | 72 px |
| `tex_bot0` … `tex_bot4` | the five rivals | 72 px |

Render resolution is free: sprites come out at 352 px and the game scales each
one to the height above, so a 176 px or 512 px render works without touching
code. Feet on the bottom edge is the one thing that matters — creatures are
drawn with origin (0.5, 1) at their ground position, and `render-creature.py`
frames for that.

Anything without a model keeps its placeholder, so this can be run after each
character lands rather than once at the end. If a sprite 404s at boot the game
redraws that one placeholder and carries on.

## models.json

Per-model overrides, all optional:

```json
{
  "cr_tralalero": { "yaw": 180 },
  "cr_vacca":     { "yaw": 90, "pitch": 18, "outline": 0.012 },
  "player":       { "yaw": 180, "pad": 1.2 }
}
```

| Option | Default | Why you would change it |
| --- | --- | --- |
| `yaw` | 0 | Every model faces a different way. This is the one you almost always set — use `--turntable` to pick it. |
| `pitch` | 24 | The board's own viewing angle. Lower shows more of the face, higher more of the top. Keep it the same across characters or they stop looking like they share a floor. |
| `pad` | 1.10 | Framing margin. Raise it for characters with wide arms or wings that touch the edge. |
| `foot` | 0.03 | Gap under the feet as a fraction of the frame. |
| `outline` | 0 | Inverted-hull toon outline, e.g. `0.012`. Reads well on smooth organic models; stripes badly on stepped/voxel ones, which is why it is off by default. |
| `exposure` | 0 | Stops for a model that renders too dark or blows out. |
| `w`, `h` | 352 | Render resolution. |

## Where models come from

Whatever produces a `.glb`, `.fbx` or `.obj` works. Meshy is the studio's usual
route and `ASSET_PROMPTS.md` has a prompt per character written for it. If you
buy a character pack instead, drop its files here under the right key names —
the renderer does not care which tool made them.
