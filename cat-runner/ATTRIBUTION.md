# Attribution

Every asset in this project is either public domain (CC0), supplied by the project
owner, or generated procedurally in code. There are no runtime CDN dependencies
and no commercial licensed assets.

---

## 3D models — third party

### KayKit — City Builder Bits (1.0, FREE)
- **Author:** Kay Lousberg — <https://www.kaylousberg.com>
- **License:** [Creative Commons Zero v1.0 Universal (CC0)](http://creativecommons.org/publicdomain/zero/1.0/)
- **Used for:** distant skyline buildings, water towers, dumpsters, crates, benches,
  street-level dressing.
- **Where:** `public/assets/kaykit/city/` (full licence text preserved as
  `LICENSE.txt` alongside the models).

### KayKit — Restaurant Bits (1.0, FREE)
- **Author:** Kay Lousberg — <https://www.kaylousberg.com>
- **License:** [Creative Commons Zero v1.0 Universal (CC0)](http://creativecommons.org/publicdomain/zero/1.0/)
- **Used for:** rooftop clutter — crates, jars, pots, menu boards, chairs, tables.
- **Where:** `public/assets/kaykit/restaurant/` (licence text preserved as
  `LICENSE.txt`).

### Quaternius — Downtown City MegaKit (Standard)
- **Author:** Quaternius — <https://quaternius.com>
- **License:** [Creative Commons Zero v1.0 Universal (CC0)](http://creativecommons.org/publicdomain/zero/1.0/)
- **Used for:** the modular facade panels that make up the building beneath every
  rooftop — wall, window, ground-floor and cornice pieces on a 2 m x 3 m grid.
- **Where:** `public/assets/megakit/` (licence text preserved as `LICENSE.txt`).
- **Note:** geometry only. The kit's ~130 MB of 4K PBR textures are deliberately
  not shipped — `scripts/extract-assets.mjs` strips every texture reference from
  the glTF at extraction time, and the meshes are recoloured at load from the
  game's own palette (`src/assets/MegaKitPalette.ts`) so they match the flat-shaded
  look of everything else.

CC0 does not require attribution, but Kay Lousberg asks to be credited and that
credit is gladly given. If you find these packs useful, support the author at
<https://kaylousberg.itch.io> or <https://patreon.com/kaylousberg>.

Only the subset of models the game actually uses is extracted into
`public/assets/` — see `scripts/extract-assets.mjs` for the exact list. The
original archives are not committed.

---

## 3D models — supplied by the project owner

### Cat (`public/assets/cat/`)
- `cat.fbx` — rigged cat, 46 bones, one animation clip named `walk`
- `catskin.png` — diffuse texture. Note this is a **black-and-white tuxedo cat
  with green eyes**, not the orange tabby the game is built around.

Supplied with the project. All five cosmetic cat variants — including the
default orange one — are generated at runtime from this single texture by
sampling a per-skin luminance ramp on a canvas (`src/entities/CatSkins.ts`).
The original tuxedo colouring is preserved as an unlockable variant.

### Dog (`public/assets/dog/`)
- `DogGlb.glb` — rigged dog with nine clips (`Dog1_Run`, `Dog1_Walk`, `Dog1_Bark`,
  `Dog1_Idle`, `Dog1_Idle_Tail_Wag`, `Dog1_Sit_Start/Loop`, `Dog1_Lay_Start/Loop`)
- `BlackDog.png` — diffuse texture, bound manually because the GLB declares the
  material without an embedded image

Supplied with the project.

---

## Everything else is procedural

No asset file exists for any of the following. They are constructed from
primitives in code, in `src/assets/ProceduralProps.ts` and `src/entities/Chef.ts`:

| Category | Items |
|---|---|
| Characters | The restaurant owner / chef (jacket, apron, hat, moustache, rolling pin), the pigeons |
| The fish | Held in the cat's mouth and used as the collectible token (`src/entities/Cat.ts`) |
| Roof structures | Terracotta tile surfaces, parapets, chimneys, planks, ramps, awnings |
| Rooftop clutter | AC units, satellite dishes, roof fans, water tanks, steam pipes and grates, flowerpots, barrels, crates, rooftop gardens |
| Signage | Restaurant signs, neon signs, swinging billboards |
| Construction | Cranes, scaffolding |
| Soft props | Clotheslines with hanging laundry (catenary-sagged rope) |
| Background | Simplified distant buildings for the skyline |

---

## Audio

**All audio is synthesised at runtime with the Web Audio API.** There are zero
audio files in this repository — no samples, no music tracks, no loops.

Footsteps, jump, landing, hard landing, sliding, collisions, fish collection,
dog barks, the chef's shouting, pigeon wings, steam vents, level completion,
failure, UI clicks and the ambient music bed are all generated from oscillators,
a single shared noise buffer, filters and envelopes in `src/game/AudioManager.ts`.

That file's header documents how to swap in sample-based audio if you want to
replace the procedural sounds later.

---

## Interface

- **Icons:** hand-authored inline SVG in `index.html` (fish, paw, cat, play, gear,
  back, restart, pause, sound on/off, trophy, clock). No icon font, no icon
  library.
- **Fonts:** system font stack only (`system-ui`, `-apple-system`, `Segoe UI`,
  `Roboto`). No webfonts are downloaded.
- **Styling:** original CSS in `src/styles/main.css`.

---

## Libraries

| Library | License | Use |
|---|---|---|
| [three.js](https://threejs.org) | MIT | Rendering |
| [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat`) | Apache-2.0 | Physics |
| [Vite](https://vitejs.dev) | MIT | Build tooling |
| [TypeScript](https://www.typescriptlang.org) | Apache-2.0 | Language |
| [Vitest](https://vitest.dev) | MIT | Tests |

All are bundled locally into `/dist`. The built game makes **no network requests
at runtime**.

---

## Design inspiration

The movement model is inspired by the general feel of momentum-heavy,
deliberately unstable physics runners. No characters, models, textures, sounds,
UI, level layouts, names or code were taken from any such game — only the broad
design principles (momentum-driven traversal, oversteer, fast restarts) were
recreated from scratch here.
