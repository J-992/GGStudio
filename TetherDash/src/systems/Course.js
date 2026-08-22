// Compiles a level's segment list (src/data/levels.js) into flat arrays of
// platforms, walls, gears, pads, bolts and checkpoints, and answers the
// queries the players, AI and renderer ask every frame.
//
// A platform spans [z0, z1] with a center/width that lerps from (c0,w0) to
// (c1,w1) across it — which is how splits, merges and diagonals are made —
// plus an optional sine `move` for moving platforms.
const Course = {
  build(level) {
    const c = {
      level,
      platforms: [],   // { z0, z1, c0, c1, w0, w1, move, kind, conv, seed }
      blocks: [],      // { c, w, z0, z1, h }  gates + dividers
      gatesInfo: [],   // { z, openings } for AI routing
      gears: [],       // { c, z, r, speed, phase, angle }
      pads: [],        // { c, z, r }
      bolts: [],       // { x, y, z, taken }
      checkpoints: [2],
      finishZ: 0,
      length: 0,
      targetTime: 0
    };

    let z = 0;
    let seed = 0;

    const plat = (z0, z1, c0, c1, w0, w1, extra) => {
      c.platforms.push(Object.assign({
        z0, z1, c0, c1, w0, w1, move: null, kind: 'floor', conv: 0, seed: seed++
      }, extra || {}));
    };
    const boltAt = (x, y, bz) => { if (bz > 8) c.bolts.push({ x, y, z: bz, taken: false }); };
    const boltLine = (x, z0, z1, every) => {
      for (let bz = z0 + 2; bz < z1 - 1; bz += (every || 4)) boltAt(x, 0.55, bz);
    };
    const boltArc = (x, z0, z1) => {
      const mid = (z0 + z1) / 2, span = (z1 - z0) / 2;
      boltAt(x, 0.9, mid - span * 0.55);
      boltAt(x, 1.55, mid);
      boltAt(x, 0.9, mid + span * 0.55);
    };

    const handlers = {
      run(s) {
        const w = s.w || 6;
        plat(z, z + s.len, 0, 0, w, w);
        boltLine(0, z, z + s.len, 4.5);
        z += s.len;
      },
      narrow(s) {
        const w = s.w || 2.2;
        plat(z, z + s.len, 0, 0, w, w);
        boltLine(0, z, z + s.len, 5);
        z += s.len;
      },
      gap(s) {
        boltArc(0, z, z + s.len);
        z += s.len;
      },
      steps(s) {
        const w = s.w || 3;
        for (let i = 0; i < s.n; i++) {
          plat(z, z + s.len, 0, 0, w, w);
          boltAt(0, 0.55, z + s.len / 2);
          z += s.len;
          if (i < s.n - 1) { boltArc(0, z, z + s.gap); z += s.gap; }
        }
      },
      split(s) {
        const w = s.w || 2.4, half = s.sep / 2;
        plat(z, z + s.len, -0.9, -half, w + 0.6, w);
        plat(z, z + s.len, 0.9, half, w + 0.6, w);
        z += s.len;
      },
      lanes(s) {
        const w = s.w || 2.4, half = s.sep / 2;
        plat(z, z + s.len, -half, -half, w, w);
        plat(z, z + s.len, half, half, w, w);
        boltLine(-half, z, z + s.len, 5);
        boltLine(half, z + 2.5, z + s.len, 5);
        z += s.len;
      },
      merge(s) {
        const w = s.w || 2.4, half = s.sep / 2;
        plat(z, z + s.len, -half, -0.9, w, w + 0.6);
        plat(z, z + s.len, half, 0.9, w, w + 0.6);
        z += s.len;
      },
      slalom(s) {
        const w = s.w || 2.6;
        for (let i = 0; i < s.n; i++) {
          const cx = (i % 2 === 0 ? -1 : 1) * s.off;
          plat(z, z + s.len, cx, cx, w, w);
          boltAt(cx, 0.55, z + s.len / 2);
          z += s.len;
          if (i < s.n - 1) z += s.gap;
        }
      },
      moving(s) {
        const w = s.w || 2.8;
        for (let i = 0; i < s.n; i++) {
          plat(z, z + s.len, 0, 0, w, w, {
            move: { amp: s.amp, speed: s.speed, phase: i * Math.PI }
          });
          boltAt(0, 0.55, z + s.len / 2);
          z += s.len;
          if (i < s.n - 1) z += s.gap;
        }
      },
      gate(s) {
        const w = s.w || 6, half = w / 2, len = 4;
        plat(z, z + len, 0, 0, w, w);
        const gz = z + 1.6;
        c.gatesInfo.push({ z: gz, openings: s.openings });
        // walls fill everything between/around the openings
        const sorted = s.openings.slice().sort((a, b) => a.c - b.c);
        let edge = -half - 0.8;
        for (const o of sorted) {
          const left = o.c - o.w / 2;
          if (left - edge > 0.1) c.blocks.push({ c: (edge + left) / 2, w: left - edge, z0: gz, z1: gz + 0.7, h: 2.4 });
          edge = o.c + o.w / 2;
        }
        if (half + 0.8 - edge > 0.1) c.blocks.push({ c: (edge + half + 0.8) / 2, w: half + 0.8 - edge, z0: gz, z1: gz + 0.7, h: 2.4 });
        for (const o of s.openings) boltAt(o.c, 0.55, gz + 1.4);
        z += len;
      },
      divider(s) {
        const w = s.w || 6;
        plat(z, z + s.len, 0, 0, w, w);
        c.blocks.push({ c: 0, w: 0.4, z0: z + 0.6, z1: z + s.len - 0.6, h: 1.7 });
        boltLine(-w / 4, z, z + s.len, 5);
        boltLine(w / 4, z + 2.5, z + s.len, 5);
        z += s.len;
      },
      gears(s) {
        const w = s.w || 6;
        plat(z, z + s.len, 0, 0, w, w);
        const every = 4.5;
        let i = 0;
        for (let gz = z + 2.2; gz < z + s.len - 1.5; gz += every, i++) {
          const cx = s.side === 'center' ? 0
            : s.side === 'left' ? -1.6
            : s.side === 'right' ? 1.6
            : (i % 2 === 0 ? -1.6 : 1.6);
          c.gears.push({ c: cx, z: gz, r: 1.05, speed: 2.6, phase: i, angle: 0 });
          boltAt(cx === 0 ? 2 : -cx * 1.3, 0.55, gz);
        }
        z += s.len;
      },
      conveyor(s) {
        const w = s.w || 6;
        plat(z, z + s.len, 0, 0, w, w, { kind: 'conveyor', conv: s.dir });
        boltLine(0, z, z + s.len, 4.5);
        z += s.len;
      },
      pads(s) {
        const w = s.w || 6;
        plat(z, z + s.len, 0, 0, w, w);
        c.pads.push({ c: 0, z: z + s.len * 0.62, r: 1.25 });
        z += s.len;
      },
      checkpoint() {
        plat(z, z + 3, 0, 0, 6, 6);
        c.checkpoints.push(z + 1.5);
        z += 3;
      }
    };

    for (const s of level.segments) {
      const h = handlers[s.t];
      if (!h) throw new Error('Unknown segment type: ' + s.t);
      h(s);
    }

    // finish straight
    plat(z, z + 16, 0, 0, 7, 7);
    c.finishZ = z + 6;
    c.length = z + 16;
    c.targetTime = c.length / (CFG.RUN_SPEED * level.speed) * 1.35 + 6;

    // ---- queries ----

    c.moveOffset = (p, t) => p.move ? Math.sin(t * p.move.speed + p.move.phase) * p.move.amp : 0;

    c.platformAt = (p, zq, t) => {
      const f = Phaser.Math.Clamp((zq - p.z0) / (p.z1 - p.z0), 0, 1);
      return {
        c: p.c0 + (p.c1 - p.c0) * f + c.moveOffset(p, t),
        w: p.w0 + (p.w1 - p.w0) * f
      };
    };

    // every platform overlapping z, with its live center/width
    c.platformsAt = (zq, t) => {
      const out = [];
      for (const p of c.platforms) {
        if (zq >= p.z0 && zq <= p.z1) {
          const cw = c.platformAt(p, zq, t);
          out.push({ p, c: cw.c, w: cw.w });
        }
      }
      return out;
    };

    // the platform under (x, z), or null. Margin makes ledges forgiving.
    c.groundAt = (x, zq, t, margin) => {
      const m = margin === undefined ? CFG.EDGE_MARGIN : margin;
      let best = null, bestD = Infinity;
      for (const p of c.platforms) {
        if (zq < p.z0 || zq > p.z1) continue;
        const cw = c.platformAt(p, zq, t);
        const d = Math.abs(x - cw.c);
        if (d <= cw.w / 2 + m && d < bestD) { best = { p, c: cw.c, w: cw.w }; bestD = d; }
      }
      return best;
    };

    // distance ahead (up to max) until there is no ground at lateral x
    c.distToDrop = (x, zq, t, max) => {
      for (let d = 0; d <= max; d += 0.4) {
        if (!c.groundAt(x, zq + d, t, 0)) return d;
      }
      return max;
    };

    return c;
  }
};
