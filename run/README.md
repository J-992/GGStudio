# TETHER RUN

Two maintenance robots race through malfunctioning industrial conduits, connected by an
elastic bungee tether. Run, jump gaps, roll walls underfoot — and when one of you falls,
the tether (and your partner) can haul you back.

Built with TypeScript, Vite, Three.js and Rapier 3D physics.

## Install

```
npm install
```

## Run

```
npm run dev:tether
```

## Build

```
npm run build
```

## Controls

Choose **Local Co-op** for two players on one computer, or **Online** to create/join
a private two-player room through Poki Netlib. In online play, each person uses the
Player 1 controls on their own device.

Player 1 (Ignis · orange)

- A / D — move left / right
- W — jump (hold for higher jumps; hold on a taut tether to climb)

Player 2 (Volta · cyan)

- ← / → — move left / right
- ↑ — jump

Shared: R restart level · M mute · ESC pause · one gamepad per player (stick + A/Cross).

On phones/tablets the game is fully touch-playable: each player gets an on-screen
cluster (arrows + jump), with pause/mute buttons top-right. Landscape recommended.

## The five conduits

1. WARMUP CONDUIT — running, steering, jumping.
2. WALL ROLL — steer into a wall and hold: it becomes the floor (shared gravity flip).
3. TENSION — split lanes stretch the tether; distance creates pull.
4. THE DROP — narrow bridges over the void. Falling is not dying: the winch reels a
   dangling partner back in. Hold jump while tethered to climb.
5. FULL SEND — everything at once, ending at the portal.

...twenty conduits total, escalating from solo fundamentals to full four-face
traversal: wall corridors with their own gaps and bridges, ceiling stretches,
rotation cascades, and finale gauntlets. The tether is elastic up to a hard
length — run too far apart and it yanks you back. Robots physically bump and
block each other. A death (including falling off-screen) sends the run back to
conduit 1: arcade rules.

## Notes

- Physics runs on a fixed 120 Hz timestep; rendering is uncapped.
- QA harness (`npm run qa`) drives the real game in headless Chrome: movement, jumping,
  wall rotations, tether tension, winch rescue, deaths/restarts, portals and resize are
  all scripted end-to-end. Requires Chrome installed.
- Online smoke test (`npm run qa:online`) opens two browsers against the live Poki
  Netlib service and verifies room creation, joining, state sync and remote input.
- This is an arcade run with no saved checkpoints; the title screen states that clearly.

## Poki build

Set the Poki game ID assigned in Poki for Developers, then upload the contents of `dist/`:

```sh
VITE_POKI_GAME_ID=your-poki-game-id npm run build
```

The game initializes PokiSDK, reports loading/gameplay lifecycle and level funnel events,
uses commercial breaks only when resuming from pause, and keeps local development playable
without the SDK. See `POKI_RELEASE.md` for the submission checklist and remaining
publisher-side steps.
