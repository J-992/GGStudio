# Asset licences

Every binary shipped in `public/assets/` is listed below with where it came
from, who made it, its licence, and what `scripts/fetch-sources.mjs` +
`scripts/build-assets.mjs` did to it. Regenerate this file's companion
`public/assets/manifest.json` (byte sizes, mesh names, per-model metadata) by
running `npm run assets:build`.

CC0 permits commercial use, modification and redistribution without
attribution. CC BY (any version) permits those uses with attribution. CC
BY-ND permits redistribution and format conversion but not creating a
derivative that changes the work itself. OFL 1.1 permits bundling, using and
modifying the font, with restrictions on selling the font by itself. Rows
marked **UNKNOWN** carry no recorded licence in this monorepo and need
confirmation from whoever originally sourced them before this game ships
publicly.

## Voxel characters — Max Parata (CC BY-ND)

| Shipped file | Source path | Author | Licence | Processing |
| --- | --- | --- | --- | --- |
| `models/zed_1.glb` | `Shared/voxel/characters/Package/OBJ/Zed_1.obj` + `.mtl` + `.png` | Max Parata | CC BY-ND | OBJ→glTF via three.js `OBJLoader` in Node, welded/quantized/meshopt-compressed with gltf-transform; uniformly scaled + regrounded so the model is 1.8 m tall with feet at y=0 (unmodified geometry, only a format conversion + rigid scale/translate); 256×1 palette PNG re-encoded losslessly as WebP with a `NEAREST` sampler. Geometry itself is unaltered. |
| `models/zed_3.glb` | `Shared/voxel/characters/Package/OBJ/Zed_3.obj` + `.mtl` + `.png` | Max Parata | CC BY-ND | Same processing as `zed_1.glb`. |

Attribution: "Voxel zombies: Max Parata (CC BY-ND)" — carried in `src/config.js`'s `credits` string and due in the game's credits screen per CC BY-ND's attribution requirement. No modification beyond format conversion and rigid transform, consistent with the ND clause.

## Graveyard dressing — Max Parata (CC BY-ND)

| Shipped file | Source path | Author | Licence | Processing |
| --- | --- | --- | --- | --- |
| `models/dressing.glb` (mesh `SM-7-Fence`) | `Shared/voxel/env/Assets/SM-7-Fence.obj` + `.mtl` + `.png` | Max Parata | CC BY-ND | OBJ→glTF, regrounded to feet at y=0, no rescale. Shares one palette texture (byte-identical across all three source PNGs) with the other two meshes in this file. |
| `models/dressing.glb` (mesh `SM-8-Pillar`) | `Shared/voxel/env/Assets/SM-8-Pillar.obj` + `.mtl` + `.png` | Max Parata | CC BY-ND | Same processing. |
| `models/dressing.glb` (mesh `SM-3-Tomb1`) | `Shared/voxel/env/Assets/SM-3-Tomb1.obj` + `.mtl` + `.png` | Max Parata | CC BY-ND | Same processing. |

Attribution: "Graveyard dressing: Max Parata (CC BY-ND)" — same title screen/credits line as above.

## Rocks — Quaternius (CC0)

| Shipped file | Source path | Author | Licence | Processing |
| --- | --- | --- | --- | --- |
| `models/rocks.glb` (meshes `Rock_1`, `Rock_2`, `Rock_4`) | `Shared/Ultimate Stylized Nature - May 2022/OBJ/Rock_{1,2,4}.obj` + `.mtl` | Quaternius | CC0 | OBJ→glTF, flat diffuse colour from each MTL's `Kd` baked into `baseColorFactor` (no texture), regrounded to feet at y=0, no rescale. |

CC0 requires no attribution, but Quaternius is credited anyway in `src/config.js`'s `credits` string as a courtesy.

## Props — UNKNOWN licence (needs confirmation before release)

| Shipped file | Source path | Author | Licence | Processing |
| --- | --- | --- | --- | --- |
| `models/props.glb` (mesh `Gun_03`) | `Shared/voxel/env/Buildings/Gun_03.fbx` + `VoxelApocalypse_Character.png` | Unknown (Synty-style "VoxelApocalypse" pack, no licence file in this monorepo) | **UNKNOWN — needs confirmation before release** | FBX→glTF via three.js `FBXLoader` in Node, cm→m scale (×0.01) baked into vertices, kept at its authored grip pivot (not regrounded — see `manifest.json`). Its own 256×1 palette texture kept as a second, separate WebP image. |
| `models/props.glb` (mesh `Gun_02`) | `Shared/voxel/env/Buildings/Gun_02.fbx` | Unknown | **UNKNOWN — needs confirmation before release** | Same FBX→glTF conversion. Its authored texture (`VoxelApocalypseZombie_Export-78-Weapon_Gun-2.png`, per the FBX's embedded texture reference) is not part of the fetched source set and was not found anywhere in the monorepo, so this mesh ships with its flat FBX material colour (white) instead of a texture — a deviation from the brief, noted at build time and in `manifest.json`. |
| `models/props.glb` (meshes `AmmoBox_5`, `AttachedBoxes`) | `Shared/voxel/env/Buildings/AmmoBox_5.fbx`, `AttachedBoxes.fbx` + `Props_01_diffuse.png` | Unknown | **UNKNOWN — needs confirmation before release** | FBX→glTF, cm→m scale, regrounded to feet at y=0. `Props_01_diffuse.png` (4096×4096, 8.6 MB) downscaled to 512×512 and packed into the left half of a shared 1024×512 atlas (UVs remapped accordingly), WebP quality 80. |
| `models/props.glb` (meshes `Barricade_03`, `BarbedWires`) | `Shared/voxel/env/Buildings/Barricade_03.fbx`, `BarbedWires.fbx` + `Props_02_diffuse.png` | Unknown | **UNKNOWN — needs confirmation before release** | Same processing as the `Props_01` pair, but packed into the right half of the same shared atlas. |

This whole `Shared/voxel/env/Buildings` FBX pack (guns, turret bases, barricades, wire) has no identified vendor or licence anywhere in this monorepo — the same open item zombie-motorworks already carries for the same pack. If it must be pulled before release, the fallback is procedural gun/turret-base geometry behind one config flag; nothing else in the pipeline depends on this pack's provenance being resolved.

## Brainrot sprites — UNKNOWN licence (needs confirmation before release)

| Shipped file | Source path | Author | Licence | Processing |
| --- | --- | --- | --- | --- |
| `sprites/brainrot.webp` (cells `patapim`, `tungtung`, `bombardiro`, `tralalero`, `assassino`, `lirili`) | `Steal-A-Brainrot/assets/sprites/cr_{patapim,tungtung,bombardiro,tralalero,assassino,lirili}.png` | Unrecorded — came into Steal-A-Brainrot as "character artwork" in `art/source`, no licence row was ever kept for it | **UNKNOWN — needs confirmation before release** | Each source PNG alpha-cropped to its opaque content, scaled to fit a 256×256 cell by its longer side, and bottom-aligned (feet on the cell floor) — mirrors `Steal-A-Brainrot/tools/import-images.py`'s crop+fit+ground logic, reimplemented in `sharp` since no Blender is available here. Packed into a 4×4 1024×1024 WebP atlas (lossless, or quality 95 if that would exceed a size cap) with `sprites/brainrot.json` recording each cell's pixel rect, normalized UV rect, and cropped-art aspect ratio. |
| `sprites/portrait-{patapim,tungtung,bombardiro,tralalero}.webp` | Same four source PNGs | Unrecorded | **UNKNOWN — needs confirmation before release** | Same alpha-crop, fit to 128×128 by the longer side, centred (not bottom-aligned — these are headshots for title/credits use), WebP quality 90. |

The characters themselves are AI-generated internet meme figures ("Italian brainrot"); the illustrated artwork depicting them has no recorded licence or artist credit. This is the same exposure the already-shipped Steal-A-Brainrot game carries for the same files.

## Font — SIL Open Font License 1.1

| Shipped file | Source path | Author | Licence | Processing |
| --- | --- | --- | --- | --- |
| `fonts/LilitaOne-Regular.ttf` | `Shared/Fonts/Lillita_One/LilitaOne-Regular.ttf` | Astigmatic (Lilita One) | OFL 1.1 | Copied unmodified. |
| `fonts/OFL.txt` | `Shared/Fonts/Lillita_One/OFL.txt` | — | OFL 1.1 | Copied unmodified (the licence text itself). |

## UI sound effects — lolurio (CC BY 4.0)

| Shipped file | Source path | Author | Licence | Processing |
| --- | --- | --- | --- | --- |
| `audio/ui-click.ogg` | `Shared/Sound/OGG/UI SFX_MENU_Scroll.ogg` | lolurio | CC BY 4.0 | Copied, renamed. |
| `audio/ui-place.ogg` | `Shared/Sound/OGG/UI SFX_FEEDBACK_Positive.ogg` | lolurio | CC BY 4.0 | Copied, renamed. |
| `audio/ui-deny.ogg` | `Shared/Sound/OGG/UI SFX_FEEDBACK_Negative.ogg` | lolurio | CC BY 4.0 | Copied, renamed. |
| `audio/wave-start.ogg` | `Shared/Sound/OGG/UI SFX_EXTRA_Quick Sub Descending.ogg` | lolurio | CC BY 4.0 | Copied, renamed. |
| `audio/boss-alert.ogg` | `Shared/Sound/OGG/UI SFX_FEEDBACK_Alert.ogg` | lolurio | CC BY 4.0 | Copied, renamed. |
| `audio/coin.ogg` | `Shared/Sound/OGG/UI SFX_FEEDBACK_Woop.ogg` | lolurio | CC BY 4.0 | Copied, renamed. |

Attribution required: **"UI Sound Effects by lolurio"** — carried in `src/config.js`'s `credits` string and due on the credits screen. Full licence text at `Shared/Sound/LICENSE.txt` (fetched into `art-src/` for reference; not shipped in `public/`).

## Combat sound effects — CC0

Copied directly from `zombie-motorworks/public/assets/audio/` (ordinary Git blobs there already, not LFS pointers — no fetch step needed). Rows below are copied from that game's own `LICENSES.md`.

| Shipped file | Source | Licence | Processing |
| --- | --- | --- | --- |
| `audio/pistol-shot-1.ogg` | [The Free Firearm Sound Library — Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney](https://opengameart.org/content/the-free-firearm-sound-library) | CC0 | A 1911 field recording trimmed, faded, normalised, and encoded as Opus (by zombie-motorworks; copied verbatim here). |
| `audio/turret-shot-1.ogg` | [The Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library) | CC0 | An AR-15 field recording trimmed, faded, normalised, and encoded as Opus. |
| `audio/impact-heavy.ogg` | [Metal Impact Sounds — BMacZero](https://opengameart.org/content/metal-impact-sounds) | CC0 | Converted from the supplied WAV to Opus. |
| `audio/zombie-death-1.ogg` | [Zombies Sound Pack — artisticdude](https://opengameart.org/content/zombies-sound-pack) | CC0 | Voice performance selected, trimmed, faded, normalised, encoded as Opus. |
| `audio/zombie-attack-1.ogg` | [Zombies Sound Pack — artisticdude](https://opengameart.org/content/zombies-sound-pack) | CC0 | Voice performance selected, trimmed, faded, normalised, encoded as Opus. |
| `audio/explosion-metal.ogg` | [Mechanical explosion — Spring Spring](https://opengameart.org/content/mechanical-explosion) | CC0 | Trimmed, faded, normalised, encoded as Opus. |
| `audio/mechanical-clunk.ogg` | [87 clickety clips — OwlishMedia](https://opengameart.org/content/87-clickety-clips) | CC0 | A recorded mechanism sound selected, trimmed, normalised, encoded as Opus. |
| `audio/upgrade-confirm.ogg` | Derived from the CC0 `mechanical-clunk.ogg` and `pickup-ding.ogg` sources above | CC0 | A short mechanism transient and two tightly faded, interval-pitched bell layers, filtered, mixed, limited, encoded as Opus (by zombie-motorworks; copied verbatim here). |
| `audio/pistol-shot-2.ogg` | [The Free Firearm Sound Library — Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney](https://opengameart.org/content/the-free-firearm-sound-library) | CC0 | A second 1911 field recording trimmed, faded, normalised, and encoded as Opus (by zombie-motorworks; copied verbatim here). Fires the M4A1. |
| `audio/sniper-shot-1.ogg` | [The Free Firearm Sound Library — Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney](https://opengameart.org/content/the-free-firearm-sound-library) | CC0 | A Mosin-Nagant field recording trimmed, faded, normalised, and encoded as Opus (by zombie-motorworks; copied verbatim here). Fires the M82. |
| `audio/gunfire.ogg` | [Random gunfire SFX — iamoneabe](https://opengameart.org/content/random-gunfire-sfx) | CC0 | Converted from the supplied WAV to Opus (by zombie-motorworks; copied verbatim here). Fires the AK-47. |
| `audio/cannon-shot-1.ogg` | [Cannon Shot — qubodup](https://freesound.org/people/qubodup/sounds/187767/) | CC0 / US government public-domain source | A cannon report separated from the source recording, low-end shaped, loudness-matched, limited, faded, encoded as Opus (by zombie-motorworks; copied verbatim here). Fires the SPAS-12. |

CC0 requires no attribution.

## Summary of open items

1. **Brainrot sprite artwork** — no licence on file. Same exposure Steal-A-Brainrot already carries.
2. **`Shared/voxel/env/Buildings` FBX pack** (guns, turret bases, barricade, barbed wire, both `Props_*_diffuse.png` atlases, `VoxelApocalypse_Character.png`) — no identified vendor or licence. Fallback: procedural geometry behind a config flag.
3. **CC BY-ND** on the Zed characters and graveyard dressing — format conversion of unmodified geometry, attribution required and carried through `credits` + this file.
4. `Gun_02`'s own texture reference (`VoxelApocalypseZombie_Export-78-Weapon_Gun-2.png`) does not exist anywhere in this monorepo checkout, so that mesh ships untextured (flat colour) rather than blocking the build.
