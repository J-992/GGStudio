import { getFrame, Orientation } from "../tunnel/SurfaceOrientation";

const S_PLAYING = 1;
const S_DYING = 3;
const S_COMPLETE = 4;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class Bot {
  private running = false;
  private startT = 0;
  private timeoutMs = 0;
  private rotDir = 0;
  private rotOrient = -1;
  private jumpUntil = 0;
  private releaseUntil = 0;
  private prevAir = false;
  private resolve_: ((r: { ok: boolean; reason: string }) => void) | null = null;

  constructor(private game: any) {}

  expectedLevel = 1;

  async run(idx: number) {
    const g = this.game;
    const t0 = performance.now();
    while (g.botRead().state === S_DYING && performance.now() - t0 < 1500) {
      await new Promise((r) => setTimeout(r, 60));
    }
    this.game.startRun(idx);
    this.expectedLevel = idx + 1;
    const read = this.game.botRead();
    const simMs = (read.def.slices.length * 2 * 1.6 + 14) * 1000;
    this.timeoutMs = simMs / Math.max(1, read.timeScale);
    this.running = true;
    this.startT = performance.now();
    this.rotDir = 0;
    this.rotOrient = -1;
    this.jumpUntil = 0;
    return new Promise<{ ok: boolean; reason: string }>((res) => {
      this.resolve_ = res;
    });
  }

  private finish(ok: boolean, reason: string) {
    this.running = false;
    this.game.botInput.active = false;
    this.resolve_?.({ ok, reason });
    this.resolve_ = null;
  }

  tick() {
    if (!this.running || !this.resolve_) return;
    const r = this.game.botRead();
    if (r.state === S_COMPLETE) return this.finish(true, "portal");
    if (r.state === S_DYING) return this.finish(false, "died");
    if (r.level !== this.expectedLevel) return this.finish(false, "reset to level " + r.level);
    if (performance.now() - this.startT > this.timeoutMs) return this.finish(false, "timeout");
    const inp = this.game.botInput;
    inp.active = true;
    if (r.state !== S_PLAYING) {
      inp.lat = 0;
      inp.jump = false;
      return;
    }

    const o = r.orientation as number;
    const face = ["f", "r", "c", "l"][o];
    const slices = r.def.slices;
    const n = slices.length;
    const t = r.p1.body.translation();
    const frame = getFrame(r.orientation);
    const along = t.x * frame.right.x + t.y * frame.right.y + t.z * frame.right.z;
    const i = clamp(Math.floor(-t.z / 2), 0, n - 1);
    const col = clamp(Math.floor((along + 5) / 2), 0, 4);
    const solid = (si: number, c: number) => {
      const s = slices[clamp(si, 0, n - 1)];
      const v = (s as any)[face];
      return v ? v[c] !== "." : true;
    };
    const emptyCount = (from: number, to: number) => {
      let k = 0;
      for (let d = from; d <= to; d++) if (!solid(d, col)) k++;
      return k;
    };

    let lat = 0;
    let wantJump = false;
    let hold = 0.42;

    let dodging = false;
    for (const sp of r.spinners) {
      const dz = t.z - sp.z;
      if (o === 0 && dz > -2 && dz < 14) {
        const targetCol = along > 0 ? 0 : 4;
        let targetOK = true;
        for (let d = 0; d <= 6; d++) if (!solid(i + d, targetCol)) { targetOK = false; break; }
        if (targetOK) {
          lat = targetCol < col ? -1 : targetCol > col ? 1 : 0;
          dodging = true;
          if (emptyCount(0, 3) >= 3 && r.p1.grounded) {
            this.jumpUntil = performance.now() + 420;
          }
          break;
        }
      }
    }

    if (this.rotDir !== 0 && o !== this.rotOrient) this.rotDir = 0;
    let faceGone = 0;
    for (let d = 1; d <= 10; d++) {
      const s = slices[clamp(i + d, 0, n - 1)];
      if ((s as any)[face] === ".....") faceGone++;
    }
    if (!dodging && (this.rotDir !== 0 || (faceGone >= 4 && emptyCount(i + 1, i + 10) >= 4))) {
      if (this.rotDir === 0) {
        const score = (dir: number) => {
          const nf = ["f", "r", "c", "l"][(o + dir + 4) % 4];
          let k = 0;
          for (let d = 1; d <= 14; d++) {
            const s = slices[clamp(i + d, 0, n - 1)];
            const v = (s as any)[nf];
            k += v ? (v[col] !== "." ? 1 : 0) : 1;
          }
          return k;
        };
        const s1 = score(1);
        const s2 = score(-1);
        this.rotDir = Math.abs(s1 - s2) < 3 ? (along >= 0 ? 1 : -1) : s1 >= s2 ? 1 : -1;
        this.rotOrient = o;
        const ll = (this as any).latchLog ?? ((this as any).latchLog = []);
        ll.push({ t: performance.now().toFixed(0), o, fg: faceGone, ec: emptyCount(i + 1, i + 10), dir: this.rotDir, z: +(r.p1.body.translation().z).toFixed(0) });
      }
      lat = this.rotDir;
      const fe = (() => { for (let d = 0; d <= 5; d++) if (!solid(i + d, col)) return d; return 99; })();
      if (fe >= 1 && fe <= 2 && r.p1.grounded && solid(i + fe + 2, col)) {
        wantJump = true;
        hold = 0.42;
      }
    } else if (!dodging) {
      this.rotDir = 0;
      let firstEmpty = 99;
      for (let d = 0; d <= 6; d++) if (!solid(i + d, col)) { firstEmpty = d; break; }
      if (firstEmpty <= 7) {
        const start = Math.max(1, firstEmpty);
        let best = col;
        let bestScore = -1;
        let bestDist = 99;
        for (let c = 0; c < 5; c++) {
          let score = 0;
          for (let d = start; d <= start + 5; d++) if (solid(i + d, c)) score++;
          const dist = Math.abs(c - col);
          if (score > bestScore || (score === bestScore && dist < bestDist)) {
            bestScore = score; best = c; bestDist = dist;
          }
        }
        if (best !== col) lat = Math.sign(best - col);
        let gapW = 0;
        while (gapW < 6 && !solid(i + firstEmpty + gapW, col)) gapW++;
        if (gapW >= 2) hold = 0.42; else hold = 0.17;
      }
      if (firstEmpty <= 1 && r.p1.grounded) wantJump = true;
    }

    const grounded = r.p1.grounded;
    if (grounded && this.prevAir) this.releaseUntil = r.time + 0.03;
    this.prevAir = !grounded;
    if (wantJump && r.time > this.releaseUntil) {
      this.jumpUntil = r.time + hold;
    }
    inp.lat = lat;
    inp.jump = r.time < this.jumpUntil && r.time > this.releaseUntil;
    if (!dodging && this.rotDir === 0) {
      if (along > 3.2) lat = -1;
      else if (along < -3.2) lat = 1;
      inp.lat = lat;
    }
    this.game.botFollow();
  }
}
