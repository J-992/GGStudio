# SQUISH! — The great jelly escape

A one-button platforming adventure: runner immediacy, layered routes, and a jelly whose shape changes how you move.

From the repository root:

```sh
npm run dev
```

Open http://127.0.0.1:5174. The game opens inside the current level, waiting for your first input. Hold Space, the mouse, or a finger on the game to flatten and charge. Release to spring. Press again in the air for a pancake dive. Escape pauses, R returns to the checkpoint, and M toggles sound. Music has a separate toggle in the pause menu.

## Included

- 24 courses in the Wobble Woods, Candy Works, and Cloud Pantry.
- Upper/lower routes, elevated ledges, crumbling bridges, moving shelves, conveyors, springs, wind columns, and portal shortcuts.
- Ground and flying enemies you can avoid or use as bounce targets. Pancake dives crack brittle surfaces and amplify spring/enemy bounces.
- Chili speeds you up and smashes crates/enemies. Holding with Bubble reduces gravity. Sweet streaks activate a temporary collection magnet.
- Optional rescued friends follow you and restore a heart. Six cosmetic flavors unlock through collected sweets.
- Three bosses: the Grumpy Whisk fires high/low doughballs; the Runaway Oven also heats patches of floor; the Pantry King adds falling candy. Their endurance increases from three to four to five hits. You automatically turn at arena edges.
- Short stage celebrations flow into the next course. Checkpoints reduce replaying solved sections. Collection stars and rescues provide optional return goals.
- Deterministic daily expedition, date-specific personal best, and copyable challenge link.
- Explicit hold/release tutorial prompts only in levels 1–2.
- Original synthesized music with world variations, bass, plucked melodies, percussion, and a boss arrangement. Effects remain usable when music is muted.
- Fixed 120 Hz simulation, responsive canvas, reduced-motion support, touch/keyboard/mouse input, pause on focus loss, and storage-disabled play.
- Poki loading/gameplay lifecycle through the existing adapter. No ads are requested.

## Save migration

Adventure progress uses `squish-adventure-v2`. Existing `squish-v1` sweets and chosen flavor migrate into the new adventure. The new campaign begins at level one because its layouts and progression are different. The old save is preserved. Adventure progress, stars, rescues, preferences, and daily bests subsequently persist independently. Checkpoints apply within a run; reloading resumes the current course from its start.

## Build and test

```sh
npm run build:squish
npm run qa:squish
```

The build is in `squish/dist/`, separate from Tether Run's build. It uses relative asset URLs and has no downloaded art, fonts, audio, runtime libraries, or analytics. The Poki SDK is the only optional external runtime request on hosted builds. Chrome is required for QA; screenshots go to `squish/shots/`.

QA searches for winning button sequences across all 24 courses, checks individual mechanics, and replays representative courses and all three bosses through keyboard events in Chrome. Scripted route replays use a deterministic 100 Hz rendering clock; mobile smoke checks use normal browser scheduling. Generated routes go to `.qa/`, which is ignored by Git.

Layout regressions check platform/hazard clearance (including moving bodies and piston stems) across all 24 courses and 30 daily seeds. Browser checks cover HUD and message bounds at 320px, 390px, 844px, and 1440px widths. Tutorial text uses a single screen-space channel in the first two levels; milestone messages share a normal-flow stack and stay hidden during tutorials, menus, and stage transitions.

`src/game.ts` contains simulation and bosses, `src/levels.ts` authored terrain motifs and course layouts, `src/render.ts` procedural art and camera, `src/main.ts` UI/input/progression, and `src/audio.ts` the original soundtrack and effects. The Poki adapter is shared with the enclosing project at `src/platform/Poki.ts`.

## Next playtest

Ten-minute average playtime is a target to measure, not an established result. Automatic completion demonstrates that routes exist, not human difficulty, fun, or retention. Watch for the first upper-route choice, air-dive discovery, Bubble comprehension, voluntary retries, and abandonment. Compare active first-session time and stage abandonment with the original build before expanding further. No external behavioral analytics are collected; active play time is stored locally.

## What remains before a Poki release

This is a playable first build for testing, not an approved Poki release. Run human tests first: automatic course completion cannot demonstrate fun or viral potential. See [RESEARCH.md](RESEARCH.md) for sources, limits, and the proposed experiment.

Submission also needs Poki developer acceptance, review of current terms and requirements, static/animated thumbnails in their required formats, portal/iframe testing on real devices, and any publisher-requested lifecycle or commercial integration changes. No game was submitted or published during this task.
