// Lightweight companion for solo play. Follows the route, takes gates'
// openings, jumps gaps with a human-ish reaction delay, and leans toward its
// partner when the cord tightens. Deliberately imperfect: it reacts late
// sometimes, and it never scouts further than a few units ahead.
class CompanionAI {
  constructor(course) {
    this.course = course;
    this.jumpTimer = -1;     // countdown to a decided jump, -1 = no decision
    this.targetX = 0;
  }

  getInput(me, partner, t, dt) {
    const c = this.course;
    const T = CFG.tether;
    const out = { left: false, right: false, jump: false, jumpHeld: false };
    if (me.state !== 'run') return out;

    // ---- choose a lateral target ----
    let targetX = null;

    // a gate coming up? head for an opening (prefer one on my side of partner)
    for (const g of c.gatesInfo) {
      const ahead = g.z - me.z;
      if (ahead > 0 && ahead < 9) {
        let best = null, bestScore = Infinity;
        for (const o of g.openings) {
          let score = Math.abs(o.c - me.x);
          const mySide = Math.sign(me.x - partner.x) || (me.id === 'A' ? -1 : 1);
          if (Math.sign(o.c - partner.x) === mySide) score -= 1.2;
          if (score < bestScore) { bestScore = score; best = o; }
        }
        if (best) targetX = best.c;
        break;
      }
    }

    // otherwise aim for the platform ahead that's closest to me (and a bit
    // toward my partner). When the current platform ends soon, aim past the
    // gap at the landing instead — that's what makes diagonal slalom hops
    // work: the steering starts before the jump does.
    if (targetX === null) {
      const edge = c.distToDrop(me.x, me.z, t, 6);
      let cands = [];
      if (edge < 5.5) {
        for (let d = edge + 0.8; d <= edge + 9 && cands.length === 0; d += 1) {
          cands = c.platformsAt(me.z + d, t);
        }
      }
      if (cands.length === 0) cands = c.platformsAt(me.z + 2.5, t);
      if (cands.length === 0) {
        for (let d = 3.5; d <= 9 && cands.length === 0; d += 1) {
          cands = c.platformsAt(me.z + d, t);
        }
      }
      if (cands.length > 0) {
        let best = null, bestScore = Infinity;
        for (const cand of cands) {
          const score = Math.abs(cand.c - me.x) + Math.abs(cand.c - partner.x) * 0.35;
          if (score < bestScore) { bestScore = score; best = cand; }
        }
        // stay inside the platform, away from the very edge
        targetX = Phaser.Math.Clamp(me.x, best.c - best.w / 2 + 0.55, best.c + best.w / 2 - 0.55);
        targetX = targetX * 0.35 + best.c * 0.65;
      } else {
        targetX = me.x;
      }
    }

    // walls and dividers ahead: steer clear of them (gate openings sit well
    // away from their walls, so the margin here won't fight that choice)
    for (const b of c.blocks) {
      const ahead = b.z0 - me.z;
      if (ahead < 9 && b.z1 > me.z && Math.abs(targetX - b.c) < b.w / 2 + 0.55) {
        const side = Math.sign(me.x - b.c) || (me.id === 'A' ? -1 : 1);
        targetX = b.c + side * (b.w / 2 + 1.2);
      }
    }

    // dodge gears near my lane
    for (const g of c.gears) {
      const ahead = g.z - me.z;
      if (ahead > 0 && ahead < 5 && Math.abs(targetX - g.c) < g.r + 0.7) {
        targetX = g.c + (Math.sign(me.x - g.c) || 1) * (g.r + 1.0);
      }
    }

    // cord getting tight? lean toward my partner
    if (this.tetherDist(me, partner) > T.warningLength) {
      targetX = targetX * 0.45 + partner.x * 0.55;
    }
    this.targetX = targetX;

    const err = targetX - me.x;
    if (err < -0.22) out.left = true;
    else if (err > 0.22) out.right = true;

    // ---- jump decisions ----
    if (me.grounded) {
      const edge = c.distToDrop(me.x, me.z, t, 4.5);
      const trigger = me.vzTotal * 0.22 + 0.4;
      if (edge < trigger) {
        if (this.jumpTimer < 0) this.jumpTimer = 0.02 + Math.random() * 0.07;
      } else {
        this.jumpTimer = -1;
      }
      if (this.jumpTimer >= 0) {
        this.jumpTimer -= dt;
        if (this.jumpTimer <= 0) { out.jump = true; out.jumpHeld = true; this.jumpTimer = -1; }
      }
    } else {
      out.jumpHeld = me.vy > 0;   // hold for full height mid-gap
    }

    return out;
  }

  tetherDist(a, b) {
    const dx = b.x - a.x, dy = (b.y - a.y) * 0.6, dz = b.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
