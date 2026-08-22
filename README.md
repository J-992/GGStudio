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
npm run dev
```

## Build

```
npm run build
```

## Controls

Player 1 (Ignis · orange)

- A / D — move left / right
- W — jump (hold for higher jumps; hold on a taut tether to climb)

Player 2 (Volta · cyan)

- ← / → — move left / right
- ↑ — jump

Shared: R restart level · ESC pause · one gamepad per player (stick + A/Cross).

## The five conduits

1. WARMUP CONDUIT — running, steering, jumping.
2. WALL ROLL — steer into a wall and hold: it becomes the floor (shared gravity flip).
3. TENSION — split lanes stretch the tether; distance creates pull.
4. THE DROP — narrow bridges over the void. Falling is not dying: the winch reels a
   dangling partner back in. Hold jump while tethered to climb.
5. FULL SEND — everything at once, ending at the portal.

Death is instant but cheap: the level restarts in under a second.

## Notes

- Physics runs on a fixed 120 Hz timestep; rendering is uncapped.
- QA harness (`npm run qa`) drives the real game in headless Chrome: movement, jumping,
  wall rotations, tether tension, winch rescue, deaths/restarts, portals and resize are
  all scripted end-to-end. Requires Chrome installed.
