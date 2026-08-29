# NINJA FLOW

A 2.5D reaction-timing fighting game built for Poki. Enemies rush a ninja from
both sides; you have exactly two inputs. Time a strike to the moment an attack
would land and you get a Perfect. Fill the Flow meter and the game hands you an
interactive slow-motion combo chain with a cinematic finisher.

## Controls

- **Desktop:** `A` / `←` attack left · `D` / `→` attack right
- **Touch:** tap the left or right half of the screen

That's the whole scheme. Timing quality (Whiff / Good / Perfect / too late) is
what the game is about.

## Run it

```bash
npm install
npm run dev        # dev server
npm run build      # production build in dist/
npm run preview    # serve the production build
npm test           # 156 deterministic tests (timing, fairness, balance, moves,
                   #   guards, physics, Flow cues, Poki events)
npm run verify     # typecheck + tests + build
npm run assets     # rebuild public/models + public/anims from raw Meshy exports
npm run weapons    # rebuild public/weapons from the raw weapon packs
```

## Poki

The build is upload-ready as it stands: the SDK tag is in `index.html`, every
URL is relative (`base: './'` in the Vite config), and ad breaks are on.

`PLATFORM.ads` in `src/config.ts` turns interstitials off for playtesting. It
must be `true` in anything that goes to the dashboard — Poki's integration
review fails a game that never requests a commercial break. Everything else
(loading events, gameplayStart/Stop, telemetry) stays live either way.

Inside the GGStudio monorepo the deploy is automatic: `poki.json` registers the
game, and a push to `main` that touches this folder uploads a new version. See
`docs/poki-deploy.md` there. Uploading is not publishing.

## Architecture (short version)

- `src/config.ts` — every tunable number in the game. Balance work never touches code.
- `src/core/` — game loop with real hit-stop (time-scale, never blocking), crash-proof storage, seeded RNG.
- `src/game/` — combat: `TimingEvaluator` (pure, frame-rate independent grading),
  `PatternDirector` (schedules *impact times* first, derives spawns — the fairness
  guarantee), `CombatDirector`, `FlowMode`, `FlowSystem`, `ComboSystem`,
  `Player` (mixer idle + additive procedural strikes + root motion),
  `MoveLibrary` (22 hero moves: slides, vaults, dives, backflips, thrown blades),
  `EnemyMoves` (8 enemy attacks, 8 hit reactions), `Choreography` (the authored
  fight scenes the death reel stages), procedural `Enemy` family,
  imported Japanese bridge garden `Arena` (bridge-height grounding, falling
  blossoms, cycling weather), trauma-based `CameraRig`, `Progression` (one
  mastery bar).
- `src/ui/` — loading screen, HUD, main menu, pause, game over. All DOM, no
  canvas UI, so it stays crisp and accessible at any resolution.
- `src/fx/` — pooled VFX, fully synthesised WebAudio (no audio files),
  `Physics.ts` (rigid bodies, springs, inertia — no engine, no allocation, no RNG)
  and `Props.ts` (dropped weapons and shattered armour that bounce and settle).
- `src/platform/PlatformAdapter.ts` — the only file that knows Poki exists.
  Guarded event state machine; the game is fully playable with no SDK.
- `src/assets/` — progressive loading: one ninja, clips, and the garden to the
  first frame (~2.8 MB); the other three ninjas stream in behind live gameplay.
- `src/tests/RunModel.ts` — headless simulation of full runs against the real
  systems; balance targets are asserted in CI.

All four ninja rigs share an identical 24-joint skeleton, so animation clips are
pooled and retarget across characters.

By **Reaper8202**.
