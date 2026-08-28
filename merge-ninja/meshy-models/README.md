# Meshy character workspace

This is the one-character-at-a-time staging area for the Ninja Merge roster.

- `ninjas/` contains 29 stable tier folders.
- `bosses/` contains 37 stable boss-appearance folders.
- Every folder is named with its in-game number and character name, so completed
  models can be worked through and reviewed independently.

## Workflow

1. Open a single character folder.
2. Upload the folder's `reference.png` to Meshy. These clean, one-character
   images are extracted from the live roster by `tools/prepare_meshy_references.py`.
3. Generate one complete, full-body character: preserve its silhouette, weapon
   or appendages, and dominant palette. Avoid a floor, UI, text, or environment.
4. Put the downloaded `model.glb`, textures, prompt, and notes in that same
   folder. Do not overwrite `public/assets/` during this generation pass.

## Shared handoff target

- GLB export with PBR materials.
- One character only, feet and weapon fully visible.
- A neutral combat-ready stance, useful as a source for idle and attack poses.
- Clean silhouette and sensible game-ready topology.

The folders are intentionally decoupled from the running game. We can decide
how to convert and integrate approved models after the full roster is ready.
