import { getFrame, Orientation } from "../tunnel/SurfaceOrientation";
import { COLS, HALF, SLICE_LEN, TILE } from "./Constants";

const S_PLAYING = 1;
const S_DYING = 3;
const S_COMPLETE = 4;

const FACES = ["f", "r", "c", "l"] as const;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Per-robot scratch state. The bot runs one of these for each player. */
interface Drive {
  rotDir: number;
  rotOrient: number;
  jumpUntil: number;
  releaseUntil: number;
  prevAir: boolean;
  dodgeCol: number;
}

const newDrive = (): Drive => ({
  rotDir: 0, rotOrient: -1, jumpUntil: 0, releaseUntil: 0, prevAir: false, dodgeCol: -1,
});

/**
 * Headless verification driver. It plays a level the way a competent pair would:
 * both robots are steered independently, so a level that needs the two of them in
 * different lanes still has to be genuinely solvable for the check to pass.
 */
export class Bot {
  private running = false;
  private startT = 0;
  private timeoutMs = 0;
  private drives: Drive[] = [newDrive(), newDrive()];
  private trace: string[] = [];
  private resolve_: ((r: { ok: boolean; reason: string; trace?: string[] }) => void) | null = null;

  constructor(private game: any) {}

  expectedLevel = 1;

  async run(idx: number) {
    const g = this.game;
    const t0 = performance.now();
    while (g.botRead().state === S_DYING && performance.now() - t0 < 1500) {
      await new Promise((r) => setTimeout(r, 60));
    }
    this.game.deathInfo = null;
    this.game.startRun(idx);
    this.expectedLevel = idx + 1;
    const read = this.game.botRead();
    const simMs = (read.def.slices.length * 2 * 1.6 + 14) * 1000;
    this.timeoutMs = simMs / Math.max(1, read.timeScale);
    this.running = true;
    this.startT = performance.now();
    this.drives = [newDrive(), newDrive()];
    this.trace = [];
    return new Promise<{ ok: boolean; reason: string; trace?: string[] }>((res) => {
      this.resolve_ = res;
    });
  }

  private finish(ok: boolean, reason: string) {
    this.running = false;
    this.game.botInput.active = false;
    this.game.botInput2.active = false;
    this.resolve_?.({ ok, reason, trace: ok ? undefined : this.trace.slice(-16) });
    this.resolve_ = null;
  }

  tick() {
    if (!this.running || !this.resolve_) return;
    const r = this.game.botRead();
    if (r.state === S_COMPLETE) return this.finish(true, "portal");
    if (r.state === S_DYING) {
      const di = r.deathInfo;
      return this.finish(
        false,
        di ? `${di.cause} @ slice ${di.slice} on ${di.orientation} (P${di.player + 1})` : "died",
      );
    }
    if (r.level !== this.expectedLevel) return this.finish(false, "reset to level " + r.level);
    if (performance.now() - this.startT > this.timeoutMs) return this.finish(false, "timeout");

    const inputs = [this.game.botInput, this.game.botInput2];
    inputs[0].active = true;
    inputs[1].active = true;
    if (r.state !== S_PLAYING) {
      for (const inp of inputs) { inp.lat = 0; inp.jump = false; }
      return;
    }

    // The lead robot owns the decision to roll the tunnel; the other one leans the
    // same way so the roll actually fires and nobody is left hanging off an edge.
    const lead = this.plan(r, 0, null);
    const follow = this.plan(r, 1, lead.rotDir);
    inputs[0].lat = lead.lat;
    inputs[0].jump = lead.jump;
    inputs[1].lat = follow.lat;
    inputs[1].jump = follow.jump;
  }

  private plan(
    r: any, idx: number, forcedRot: number | null,
  ): { lat: number; jump: boolean; rotDir: number } {
    const d = this.drives[idx];
    const me = idx === 0 ? r.p1 : r.p2;
    const mate = idx === 0 ? r.p2 : r.p1;
    const o = r.orientation as number;
    const face = FACES[o];
    const slices = r.def.slices;
    const n = slices.length;
    const t = me.body.translation();
    const frame = getFrame(r.orientation);
    const along = t.x * frame.right.x + t.y * frame.right.y + t.z * frame.right.z;
    const mt = mate.body.translation();
    const mateAlong = mt.x * frame.right.x + mt.y * frame.right.y + mt.z * frame.right.z;
    const i = clamp(Math.floor(-t.z / SLICE_LEN), 0, n - 1);

    // Pattern columns are laid out along the face's own axis: x for the floor and
    // ceiling, y for the two walls. On the ceiling and the left wall that axis
    // runs opposite to the player's lateral axis, so steering has to be flipped.
    const colAxisIsX = o === 0 || o === 2;
    const colSign = o === 2 || o === 3 ? -1 : 1;
    const colOf = (v: { x: number; y: number }) =>
      clamp(Math.floor(((colAxisIsX ? v.x : v.y) + HALF) / TILE), 0, COLS - 1);
    const col = colOf(t);
    // Two robots aiming at the exact centre of the same lane spend the level
    // shoulder-barging each other off walls. Each takes one side of it.
    const laneBias = (idx === 0 ? -0.7 : 0.7) * colSign;
    /** Frame-space coordinate of a column's centre, for aiming at a lane. */
    const alongOfCol = (c: number) => colSign * (-HALF + (c + 0.5) * TILE) + laneBias;
    const steerTo = (c: number, si = -1) => {
      const target = si >= 0 ? this.aimAlong(r, si, c, colSign, t.z) : alongOfCol(c);
      return Math.abs(target - along) < 0.28 ? 0 : Math.sign(target - along);
    };

    const charAt = (si: number, c: number): string => {
      const s = slices[clamp(si, 0, n - 1)];
      const v = s?.[face];
      return v ? v[c] : "#";
    };
    // A tile counts as standable only if it is still standable when we get there:
    // a shutter that will be across the lane is treated as if it were not there.
    const solid = (si: number, c: number): boolean => {
      const ch = charAt(si, c);
      if (ch === ".") return false;
      if (ch === "=" || ch === "+") return this.sliderCovers(r, si, c, t.z);
      if (ch === "!" || ch === "?") return !this.shutterShut(r, si, ch === "?" ? 0.5 : 0, t.z);
      return true;
    };
    const emptyCount = (from: number, to: number) => {
      let k = 0;
      for (let dd = from; dd <= to; dd++) if (!solid(dd, col)) k++;
      return k;
    };

    let lat = 0;
    let wantJump = false;
    let hold = 0.42;

    let dodging = false;
    let nearSpinner = false;
    for (const sp of r.spinners) {
      const dz = t.z - sp.z;
      if (o !== 0 || dz <= -2 || dz >= 14) continue;
      nearSpinner = true;
      // Commit to one side for the whole approach. Re-deciding every frame left
      // a robot oscillating on the centre line until the arm swept it away.
      if (d.dodgeCol < 0) d.dodgeCol = colSign * along > 0 ? COLS - 1 : 0;
      const targetCol = d.dodgeCol;
      let targetOK = true;
      for (let dd = 0; dd <= 6; dd++) if (!solid(i + dd, targetCol)) { targetOK = false; break; }
      if (targetOK) {
        lat = steerTo(targetCol);
        dodging = true;
        if (emptyCount(0, 3) >= 3 && me.grounded) {
          d.jumpUntil = r.time + 0.42;
        }
      }
      break;
    }
    if (!nearSpinner) d.dodgeCol = -1;

    if (d.rotDir !== 0 && o !== d.rotOrient) d.rotDir = 0;
    if (forcedRot !== null && forcedRot !== 0) { d.rotDir = forcedRot; d.rotOrient = o; }

    // Only an unbroken stretch of missing face means "roll". One or two blank
    // slices is a gap to jump, which keeps short holes usable on walls too.
    let faceGoneRun = 0;
    let longestGoneRun = 0;
    let firstFaceGone = 99;
    for (let dd = 1; dd <= 14; dd++) {
      const s = slices[clamp(i + dd, 0, n - 1)];
      if (s?.[face] === ".....") {
        faceGoneRun++;
        if (faceGoneRun > longestGoneRun) longestGoneRun = faceGoneRun;
        if (firstFaceGone === 99) firstFaceGone = dd;
      } else {
        faceGoneRun = 0;
      }
    }

    let rolling = !dodging && (
      d.rotDir !== 0 ||
      (longestGoneRun >= 3 && firstFaceGone <= 7 && emptyCount(i + 1, i + 14) >= 2)
    );
    if (rolling) {
      if (d.rotDir === 0) {
        const score = (dir: number) => {
          const nf = FACES[(o + dir + 4) % 4];
          let k = 0;
          for (let dd = 1; dd <= 18; dd++) {
            const s = slices[clamp(i + dd, 0, n - 1)];
            const v = s?.[nf];
            k += v ? (v[col] !== "." ? 1 : 0) : 1;
          }
          return k;
        };
        const s1 = score(1);
        const s2 = score(-1);
        // Judge the destination by the stretch we would actually land on, not by
        // the slice under our feet — during a hand-off the next face often only
        // appears further down the tunnel.
        const safe = (dir: number) => {
          const nf = FACES[(o + dir + 4) % 4];
          // A roll is instant: the destination has to be under us now, not in
          // seven slices' time. Levels overlap the two faces for this reason.
          if (slices[clamp(i, 0, n - 1)]?.[nf] === ".....") return false;
          const from = Math.max(0, firstFaceGone - 2);
          let gapRun = 0;
          let anySolid = false;
          for (let dd = from; dd <= firstFaceGone + 8; dd++) {
            if (slices[clamp(i + dd, 0, n - 1)]?.[nf] === ".....") {
              gapRun++;
              if (gapRun >= 3) return false;
            } else {
              gapRun = 0;
              anySolid = true;
            }
          }
          return anySolid;
        };
        const safe1 = safe(1), safe2 = safe(-1);
        if (!safe1 && !safe2) {
          // Nothing to roll onto — this is a true void. Jump or ride a pad across.
          rolling = false;
        } else {
          d.rotDir = Math.abs(s1 - s2) < 3 ? (along >= 0 ? 1 : -1) : s1 >= s2 ? 1 : -1;
          if (d.rotDir > 0 && !safe1) d.rotDir = -1;
          if (d.rotDir < 0 && !safe2) d.rotDir = 1;
          d.rotOrient = o;
        }
      }
    }

    if (rolling) {
      lat = d.rotDir;
      const fe = (() => { for (let dd = 0; dd <= 5; dd++) if (!solid(i + dd, col)) return dd; return 99; })();
      if (fe >= 1 && fe <= 2 && me.grounded && solid(i + fe + 2, col)) {
        wantJump = true;
        hold = 0.42;
      }
    } else if (!dodging) {
      d.rotDir = 0;
      let firstEmpty = 99;
      for (let dd = 0; dd <= 12; dd++) if (!solid(i + dd, col)) { firstEmpty = dd; break; }
      if (firstEmpty <= 12) {
        const start = Math.max(1, firstEmpty);
        let best = col;
        let bestScore = -1;
        let bestDist = 99;
        const mateCol = colOf(mt);
        for (let c = 0; c < COLS; c++) {
          let score = 0;
          for (let dd = start; dd <= start + 6; dd++) if (solid(i + dd, c)) score++;
          // Break ties toward the partner: two robots picking opposite edges is
          // how a tether snap starts.
          const dist = Math.abs(c - col) + 0.6 * Math.abs(c - mateCol);
          if (score > bestScore || (score === bestScore && dist < bestDist)) {
            bestScore = score; best = c; bestDist = dist;
          }
        }
        if (best !== col) {
          const destinationIsGap = !solid(i, best);
          if (!destinationIsGap || firstEmpty <= 5) {
            lat = steerTo(best, i + Math.max(1, firstEmpty));
            if (destinationIsGap && me.grounded) wantJump = true;
          }
        }
        let gapW = 0;
        while (gapW < 6 && !solid(i + firstEmpty + gapW, col)) gapW++;
        hold = gapW >= 2 ? 0.42 : 0.17;
      }
      if (firstEmpty <= 1 && me.grounded) wantJump = true;
    }

    // Step off a lane that will be closed by the time we reach it. Belts feed you
    // into barriers, so this has to start well before the barrier itself.
    // Standing on a ferry: the platform already carries you, so hold still unless
    // you are drifting off its edge. Steering on top of the carry, or jumping
    // because the lane scan thinks the floor moved, is how you end up in the void.
    let riding = false;
    if (!dodging && !rolling && me.grounded) {
      const here = charAt(i, col);
      if (here === "=" || here === "+") {
        const centre = this.nearestSliderAlong(r, i, colSign, along);
        if (centre !== null) {
          lat = Math.abs(centre - along) < 0.7 ? 0 : Math.sign(centre - along);
          riding = true;
          wantJump = false;
          d.jumpUntil = 0;
        }
      }
    }

    let shutterDodge = false;
    if (!dodging && d.rotDir === 0) {
      for (let dd = 1; dd <= 5; dd++) {
        const arrive = charAt(i + dd, col);
        if (arrive !== "!" && arrive !== "?") continue;
        if (!this.shutterShut(r, i + dd, arrive === "?" ? 0.5 : 0, t.z)) continue;
        for (const c of [col - 1, col + 1, col - 2, col + 2]) {
          if (c < 0 || c >= COLS) continue;
          if (solid(i + dd, c) && solid(i + dd + 1, c)) {
            // Aim for the middle of the safe lane, not just its side of the line.
            lat = steerTo(c);
            shutterDodge = true;
            break;
          }
        }
        break;
      }
    }

    const grounded = me.grounded;
    if (grounded && d.prevAir) d.releaseUntil = r.time + 0.03;
    d.prevAir = !grounded;
    if (wantJump && r.time > d.releaseUntil) d.jumpUntil = r.time + hold;

    if (!dodging && d.rotDir === 0 && !shutterDodge && !riding) {
      if (along > HALF - 1.8) lat = -1;
      else if (along < -(HALF - 1.8)) lat = 1;
      // Keep the tether inside its working range: the spring gets violent past ~7.
      // Only close the gap over ground that is actually there.
      const spread = mateAlong - along;
      if (Math.abs(spread) > 5.2) {
        const dir = Math.sign(spread);
        const next = col + dir * colSign;
        if (next >= 0 && next < COLS && solid(i + 1, next) && solid(i + 2, next)) lat = dir;
      }
    }

    let jump = r.time < d.jumpUntil && r.time > d.releaseUntil;
    // Winch back up only when actually off the edge. Holding jump inside the
    // tunnel just stretches a launch arc into the ceiling.
    if (!me.grounded && me.tensionAmount > 0.08 && (me.beyond > 0.4 || me.airTime > 1.6)) {
      jump = true;
    }
    if (idx === 0 || this.trace.length % 2 === 1) {
      this.trace.push(
        `P${idx + 1} s${i} c${col} ${face} lat${lat >= 0 ? "+" : ""}${lat}` +
        `${jump ? " J" : ""}${rolling ? " ROLL" + d.rotDir : ""}${shutterDodge ? " DODGE" : ""}` +
        `${riding ? " RIDE" : ""}` +
        ` y${(idx === 0 ? r.p1 : r.p2).body.translation().y.toFixed(1)}` +
        ` b${me.beyond.toFixed(1)}` +
        `${me.grounded ? "" : " air"}`,
      );
      if (this.trace.length > 400) this.trace.splice(0, 200);
    }
    return { lat, jump, rotDir: d.rotDir };
  }

  /** Frame-space centre of whichever ferry at this slice is nearest right now. */
  private nearestSliderAlong(r: any, sliceIdx: number, colSign: number, along: number): number | null {
    const wantZ = -(sliceIdx + 0.5) * SLICE_LEN;
    let best: number | null = null;
    let bestGap = 99;
    for (const sl of r.sliders as { z: number; col: number }[]) {
      if (Math.abs(sl.z - wantZ) > 1.2) continue;
      const a = colSign * (-HALF + (sl.col + 0.5) * TILE);
      const gap = Math.abs(a - along);
      if (gap < bestGap) { bestGap = gap; best = a; }
    }
    return best;
  }

  /**
   * Frame-space coordinate to steer at for a tile. For a ferry that is where the
   * platform will be when we get there, not the middle of its home lane.
   */
  private aimAlong(r: any, sliceIdx: number, c: number, colSign: number, zHere: number): number {
    const home = colSign * (-HALF + (c + 0.5) * TILE);
    const slices = r.def.slices;
    const s = slices[Math.max(0, Math.min(slices.length - 1, sliceIdx))];
    const face = FACES[r.orientation as number];
    const ch = s?.[face]?.[c];
    if (ch !== "=" && ch !== "+") return home;
    const wantZ = -(sliceIdx + 0.5) * SLICE_LEN;
    const eta = Math.max(0, (zHere - wantZ) / 9);
    for (const sl of r.sliders as { z: number; baseCol: number; phase: number }[]) {
      if (Math.abs(sl.z - wantZ) > 0.6) continue;
      if (Math.abs(sl.baseCol - c) > 0.1) continue;
      const predicted = r.sliderColAt(eta, sl.baseCol, sl.phase);
      return colSign * (-HALF + (predicted + 0.5) * TILE);
    }
    return home;
  }

  /**
   * True if the slider authored at this tile will be under that column by the
   * time we arrive. Reading its position now is useless a second downrange.
   */
  private sliderCovers(r: any, sliceIdx: number, c: number, zHere: number): boolean {
    const wantZ = -(sliceIdx + 0.5) * SLICE_LEN;
    const eta = Math.max(0, (zHere - wantZ) / 9);
    for (const sl of r.sliders as { z: number; baseCol: number; phase: number }[]) {
      if (Math.abs(sl.z - wantZ) > 0.6) continue;
      if (Math.abs(r.sliderColAt(eta, sl.baseCol, sl.phase) - c) < 0.55) return true;
    }
    return false;
  }

  /** True if the shutter at this slice will be across the lane when we arrive. */
  private shutterShut(r: any, sliceIdx: number, phase: number, zHere: number): boolean {
    const zThere = -(sliceIdx + 0.5) * SLICE_LEN;
    const eta = Math.max(0, (zHere - zThere) / 9);
    return r.shutterAt(eta, phase) > 0.4;
  }
}
