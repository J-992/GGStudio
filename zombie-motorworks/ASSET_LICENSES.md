# Asset licences

Project policy is to ship only original, CC0, or explicitly licensed assets.
Rows marked `UNKNOWN — needs confirmation before release` must be resolved
before release and are not assertions that those assets are cleared for use.

Provenance for the voxel art was traced back through the monorepo's
`Shared/voxel/` source folders, which is where these models entered the project.
Nothing in this game is original art: every model, texture, and font came from
an outside pack, so the question is always which pack and under what terms.

| Asset / path | Source | Author | Licence | Notes |
| --- | --- | --- | --- | --- |
| `public/assets/fonts/Tiny5-Regular.ttf`; `Tiny5-OFL.txt` | Tiny5 Project ([repository named in the bundled notice](https://github.com/Gissio/font_tiny5)) | The Tiny5 Project Authors | SIL Open Font License, Version 1.1 | Copyright 2022–2024. The complete OFL notice ships beside the font. |
| `public/assets/graveyard/SM-*` OBJ/MTL/PNG sets: Ground, Tree, Ghost, Tomb1–3, Raven, Fence, Pillar, Spade, Igor_wSpade | [Free Voxel Graveyard Asset](https://maxparata.itch.io/voxelgraveyard) | Max Parata (monogon) | CC BY-ND 4.0 — **see the derivatives warning below** | Identified from `Shared/voxel/env/Vox/VoxelGraveyard_AssetsShowcase.vox` and `VoxelGraveyard_DemoScene.vox`, shipped with that pack. Igor is the pack's grave-digger character. Commercial use is permitted with credit. |
| `public/assets/zombies/Zed_{1..6}.*` (OBJ/MTL/PNG) | [Voxel Apocalypse: Zombies](https://maxparata.itch.io/voxel-zombies) | Max Parata (monogon) | CC BY-ND 4.0 — **see the derivatives warning below** | Source copies in `Shared/voxel/characters/Package/OBJ/`. Pack terms: "You can use it for any kind of project that you have (commercial or not)". |
| `public/assets/zombies/PhoneAddict-{0-Woman,1-Man}.*` (OBJ/MTL/PNG) | [Voxel Dystopian Characters](https://maxparata.itch.io/voxel-dystopian-characters) | Max Parata (monogon) | CC BY-ND 4.0 — **see the derivatives warning below** | Source copies in `Shared/voxel/characters/Package/`, alongside the pack's own `Phone Addict_Thumbnail.gif`. |
| `public/assets/graveyard/Road-Crossing-{A,B}.*`, `Road-Street6-{A,B}.*`, `Road-Street8-{A,B}.*`, `RoadSign-66.*` (OBJ/MTL/PNG) | UNKNOWN — needs confirmation before release | UNKNOWN — needs confirmation before release | UNKNOWN — needs confirmation before release | Source copies in `Shared/voxel/env/Roads/`, where every file is still named `Free Sample-N-…`. That naming means these are the free teaser subset of a commercial road pack, so the terms are the vendor's, not a blanket free licence. Vendor not yet identified. |
| `public/assets/graveyard/props/{AmmoBox_5,AttachedBoxes,BarbedWires,Barricade_03,Bonefire,Trash}.fbx` | UNKNOWN — needs confirmation before release | UNKNOWN — needs confirmation before release | UNKNOWN — needs confirmation before release | Source copies in `Shared/voxel/env/Buildings/`, which also contains an unused `Character_Hero.fbx` — the signature of a third-party pack. Embedded FBX metadata carries no provenance. |
| `public/assets/graveyard/props/Props_01_diffuse.png`, `Props_02_diffuse.png` | UNKNOWN — needs confirmation before release | UNKNOWN — needs confirmation before release | UNKNOWN — needs confirmation before release | The texture atlases for the FBX prop set above; same unidentified pack. |
| `public/assets/zombies/zombie_city.*`, `zombie_worker.*` (OBJ/MTL/PNG) | UNKNOWN — needs confirmation before release | UNKNOWN — needs confirmation before release | UNKNOWN — needs confirmation before release | Source copies in `Shared/voxel/characters/ZombieAsset/`, a folder that also holds unused `doctor_zombie`, `female_doctor`, `police_girl`, and `soldier` models. Distinct from the Max Parata packs above and not yet identified. |
| `public/assets/nature/{PineTree_3,PineTree_5,PalmTree_2,PalmTree_3,PalmTree_5,Rock_1,Rock_2,Rock_4}.{obj,mtl}` | Ultimate Stylized Nature pack ([Quaternius](https://quaternius.com/)) | Quaternius | CC0 1.0 Universal (Public Domain Dedication) | Licence confirmed from the `License.txt` shipped with the pack in `Shared/Ultimate Stylized Nature - May 2022/`. Meshes only — the pack's textures are deliberately not shipped, since the MTLs carry flat diffuse colours and the renderer forces flat-shaded Lambert. |
| `public/assets/zombies/*.rigged.glb`, `zamboni.glb` | Derived in-repo from the voxel character sets above | Rigged by `glb-rigger/rig.mjs`, compressed by `scripts/wrap-rig-meshes.mjs` + glTF-Transform | Follows the licence of the source model | These are **modified** versions of the packs above: re-boned, re-posed, quantised, and meshopt-compressed. That is what the derivatives warning is about. |
| `public/assets/zombies/portraits/*.png` | Rendered in-repo by `scripts/render-portraits.mjs` | Renders of the voxel character sets above | Follows the licence of the source model | Ten portraits of models this project did not create. Several are rendered in custom poses (`pose-zombie-city.mjs`, `pose-zombie-worker.mjs`), which makes them derivative works rather than plain reproductions. |

## Blocking issue: CC BY-ND forbids what this game does to these models

The three Max Parata packs are **NoDerivatives**. Commercial use is fine and the
licence is otherwise generous, but ND permits distributing the models only as
supplied. This project does not do that — `glb-rigger` re-bones them into
`.rigged.glb`, `pose-zombie-*.mjs` deforms them into new poses, the portrait
script renders those poses to PNG, and the build quantises and meshopt-compresses
the geometry. Each of those produces a derivative work, and shipping it is
outside the licence grant.

Two ways to resolve it, both cheap:

1. **Ask.** Max Parata distributes these as donation-ware and invites contact on
   the itch.io pages. Written permission to ship modified versions clears it
   outright, and is the option that keeps the current art.
2. **Swap the rigged characters** for a pack whose licence permits modification
   (CC0 or CC BY). The graveyard scenery, which is not rigged or re-posed, could
   stay under ND with attribution alone.

## Attribution is required and currently missing

CC BY-ND requires credit, and the game has no credits screen — no mention of
Max Parata, Quaternius, or the Tiny5 authors anywhere in the UI or the README.
Even with the derivatives question settled, shipping without attribution
breaches all four of the identified licences. A credits panel reachable from the
title screen is the smallest fix.

## Pending verification

- Road-tile sets and `RoadSign-66` — free-sample subset of an unidentified
  commercial pack. Highest risk of the three: "free sample" usually means
  evaluation-only.
- Graveyard FBX prop models and their two diffuse textures.
- `zombie_city` / `zombie_worker` character sets from `ZombieAsset/`.
