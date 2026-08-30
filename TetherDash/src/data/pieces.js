// The modular track catalogue.
//
// Every piece is a prefab: a fixed-length span of tunnel that declares which
// panels exist on which of the four faces, plus its bolts, hazards and pads.
// Nothing here knows where it will end up -- Track.js stamps a piece down at
// whatever z the runner has reached and offsets everything by it, so the same
// dozen prefabs make an endless course.
//
// Two rules keep the catalogue playable, and tools/check.mjs enforces both:
//
//   * Every piece is entered through a coupler ring (Track adds it) where all
//     four faces are solid, so it does not matter which face you arrive on.
//   * From that ring there is always a route to the far end -- a face whose
//     panels are continuous, or broken only by gaps a jump can clear. A piece
//     that forces you onto a wall does it by making the *floor* impossible,
//     never by making the piece impossible.
//
// Coordinates are piece-local: z from 0 at the end of the ring, u across the
// face (-TUBE_R .. +TUBE_R), h off the face's surface.
const FLOOR = 0, RIGHT = 1, CEIL = 2, LEFT = 3;

const PIECES = [
  // ------------------------------------------------------------ breathers

  {
    id: 'straight', len: 22, tier: 0, weight: 12, rest: true,
    build(b) {
      b.all(0, 22);
      b.boltLine(FLOOR, 0, 2, 20, 4);
    }
  },

  {
    id: 'ringRest', len: 14, tier: 0, weight: 6, rest: true,
    build(b) {
      b.all(0, 14);
      // a bolt on every face at the same z reads as a ring flying past
      for (let z = 3; z < 13; z += 3.4) {
        for (let f = 0; f < 4; f++) b.bolt(f, 0, z);
      }
    }
  },

  // ------------------------------------------------------------ floor work

  {
    id: 'narrow', len: 20, tier: 0, weight: 8,
    build(b) {
      b.panel(FLOOR, 0, 20, -b.R * 0.42, b.R * 0.42);
      b.panel(RIGHT, 0, 20); b.panel(LEFT, 0, 20); b.panel(CEIL, 0, 20);
      b.boltLine(FLOOR, 0, 2, 18, 4);
      b.boltLine(RIGHT, 0, 4, 16, 6);
    }
  },

  {
    id: 'stepGaps', len: 26, tier: 0, weight: 9,
    build(b) {
      // four hops, each gap well inside a standing jump at the slowest speed
      // the game ever runs -- so this piece stays a rhythm test, not a wall
      for (let i = 0; i < 4; i++) {
        const z0 = i * 7.2;
        b.panel(FLOOR, z0, z0 + 4.2);
        if (i < 3) b.boltArc(FLOOR, 0, z0 + 4.2, z0 + 7.2);
      }
      b.panel(RIGHT, 0, 26); b.panel(LEFT, 0, 26); b.panel(CEIL, 0, 26);
    }
  },

  {
    id: 'checker', len: 26, tier: 1, weight: 8,
    build(b) {
      // half-width floor tiles that alternate side; the overlap is the only
      // place to cross, so the floor route is a slalom and the walls are the
      // lazy way round
      const sides = [[-b.R, 0.5], [-0.5, b.R], [-b.R, 0.5], [-0.5, b.R]];
      for (let i = 0; i < 4; i++) {
        const z0 = i * 6;
        b.panel(FLOOR, z0, z0 + 7, sides[i][0], sides[i][1]);
        b.bolt(FLOOR, (sides[i][0] + sides[i][1]) / 2, z0 + 3);
      }
      b.panel(RIGHT, 0, 26); b.panel(LEFT, 0, 26); b.panel(CEIL, 0, 26);
    }
  },

  // ------------------------------------------------- the wall-run signature

  {
    id: 'wallRun', len: 26, tier: 0, weight: 11,
    build(b) {
      // 18 units of nothing: longer than a jump at top speed, so the only way
      // across is to step off a corner and keep running on the wall
      b.panel(FLOOR, 0, 4); b.panel(FLOOR, 22, 26);
      b.panel(RIGHT, 0, 26); b.panel(LEFT, 0, 26); b.panel(CEIL, 0, 26);
      b.boltLine(RIGHT, 0, 5, 21, 4);
      b.boltLine(LEFT, 0, 5, 21, 4);
    }
  },

  {
    id: 'oneWall', len: 26, tier: 1, weight: 8,
    build(b) {
      // same hole, but only one wall bridges it -- pick the side early
      b.panel(FLOOR, 0, 4); b.panel(FLOOR, 22, 26);
      b.panel(RIGHT, 0, 26);
      b.panel(LEFT, 0, 5); b.panel(LEFT, 21, 26);
      b.panel(CEIL, 0, 6); b.panel(CEIL, 20, 26);
      b.boltLine(RIGHT, 0, 5, 21, 3.5);
    }
  },

  {
    id: 'zigWall', len: 28, tier: 3, weight: 5,
    build(b) {
      // the floor and the right wall take it in turns to disappear
      b.panel(FLOOR, 0, 4); b.panel(FLOOR, 12, 18); b.panel(FLOOR, 26, 28);
      b.panel(RIGHT, 0, 10); b.panel(RIGHT, 20, 28);
      b.panel(LEFT, 0, 28);
      b.panel(CEIL, 0, 28);
      b.boltLine(LEFT, 0, 3, 25, 3.5);
      b.bolt(FLOOR, 0, 15);
    }
  },

  // ------------------------------------------------------ ceiling and round

  {
    id: 'ceilingRun', len: 36, tier: 2, weight: 6,
    build(b) {
      // the walls run out sixteen units before the floor comes back: past
      // that only the ceiling crosses, so this one has to be walked upside down
      b.panel(FLOOR, 0, 6); b.panel(FLOOR, 32, 36);
      b.panel(RIGHT, 0, 16); b.panel(LEFT, 0, 16);
      b.panel(CEIL, 0, 36);
      b.boltLine(CEIL, 0, 8, 32, 4);
      b.bolt(RIGHT, b.R * 0.7, 12); b.bolt(LEFT, b.R * 0.7, 12);
    }
  },

  {
    id: 'spiral', len: 34, tier: 2, weight: 6,
    build(b) {
      // one continuous surface that screws a quarter turn at a time; the
      // overlaps are where you step round the corner
      b.panel(FLOOR, 0, 14);
      b.panel(RIGHT, 9, 26);
      b.panel(CEIL, 20, 34);
      b.boltLine(FLOOR, b.R * 0.65, 2, 12, 4);
      b.boltLine(RIGHT, 0, 12, 24, 4);
      b.boltLine(CEIL, -b.R * 0.65, 22, 32, 4);
    }
  },

  {
    id: 'crossFlip', len: 30, tier: 3, weight: 6,
    build(b) {
      // floor -> right wall -> ceiling, and no way back down until the end
      b.panel(FLOOR, 0, 5); b.panel(FLOOR, 26, 30);
      b.panel(RIGHT, 0, 17);
      b.panel(CEIL, 12, 30);
      b.panel(LEFT, 25, 30);
      b.boltLine(RIGHT, b.R * 0.5, 4, 16, 4);
      b.boltLine(CEIL, -b.R * 0.5, 15, 28, 4);
    }
  },

  // ------------------------------------------------------------- obstacles

  {
    id: 'gearAlley', len: 24, tier: 1, weight: 8,
    build(b) {
      b.all(0, 24);
      for (let i = 0; i < 4; i++) {
        const z = 3.5 + i * 5;
        const u = i % 2 === 0 ? -b.R * 0.55 : b.R * 0.55;
        b.hazard(FLOOR, u, z, 'gear');
        b.bolt(FLOOR, -u * 0.9, z);
      }
      b.hazard(CEIL, 0, 9, 'gear');
      b.hazard(CEIL, 0, 19, 'gear');
    }
  },

  {
    id: 'pillars', len: 22, tier: 1, weight: 7,
    build(b) {
      b.all(0, 22);
      const lanes = [0, -b.R * 0.62, b.R * 0.62, 0];
      for (let i = 0; i < 4; i++) {
        b.hazard(FLOOR, lanes[i], 3 + i * 5, 'block');
        b.bolt(FLOOR, lanes[i] === 0 ? b.R * 0.7 : 0, 5.5 + i * 5);
      }
      b.hazard(LEFT, 0, 8, 'block');
      b.hazard(RIGHT, 0, 16, 'block');
    }
  },

  {
    id: 'padJump', len: 26, tier: 1, weight: 6,
    build(b) {
      // nothing bridges this one, on any face: hit the pad or don't cross
      for (let f = 0; f < 4; f++) {
        b.panel(f, 0, 10); b.panel(f, 20, 26);
        b.pad(f, 0, 8.5);
      }
      b.boltArc(FLOOR, 0, 10, 20);
      b.boltArc(CEIL, 0, 10, 20);
    }
  }
];
