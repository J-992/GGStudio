# SQUISH!

Small blob. Big escape. An original one-button jelly platformer built alongside Tether Run.

From the repository root:

```sh
npm run dev
```

Open http://127.0.0.1:5174. Hold Space, the mouse, or a finger on the game to flatten and charge. Release to jump. Longer holds give bigger jumps. Escape pauses, R retries, M toggles sound. On touchscreens, hold anywhere on the game world.

## Included

- 18 short courses across three palettes; gates, pits, and spiky sprinkles.
- Fixed 120 Hz simulation, responsive canvas rendering, squash/stretch, particles, synthesized audio, and reduced-motion support.
- Persistent campaign progress, collection stars, and six automatically unlocked cosmetic flavors.
- Deterministic daily challenge keyed to a UTC date, saved personal best, and a copyable challenge link. Shared older dates remain playable.
- Keyboard, mouse, touch, pause on focus loss, and storage-disabled play.
- Poki loading/gameplay lifecycle via the existing project's platform adapter. No ads are requested by this game.
- Browser QA that completes the campaign using actual keyboard inputs and verifies touch, persistence, pause, failure, retry, and lifecycle behavior.

## Build and test

```sh
npm run build:squish
npm run qa:squish
```

The build is in `squish/dist/`, separate from Tether Run's build. It uses relative asset URLs and has no downloaded art, fonts, audio, runtime libraries, or analytics. The Poki SDK is the only optional external runtime request on hosted builds. Chrome is required for QA; screenshots go to `squish/shots/`.

`src/game.ts` contains the deterministic simulation and course generation, `src/render.ts` the procedural art, `src/main.ts` the UI/input/progress flow, and `src/audio.ts` the small sound synthesizer. The shared Poki adapter is imported from `../src/platform/Poki.ts` at repository level.

## What remains before a Poki release

This is a playable first build for testing, not an approved Poki release. Run human tests first: automatic course completion cannot demonstrate fun or viral potential. See [RESEARCH.md](RESEARCH.md) for sources, limits, and the proposed experiment.

Submission also needs Poki developer acceptance, review of current terms and requirements, static/animated thumbnails in their required formats, portal/iframe testing on real devices, and any publisher-requested lifecycle or commercial integration changes. No game was submitted or published during this task.
