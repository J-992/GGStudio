import { Autopilot } from "./Autopilot";
const S_PLAYING = 1;
const S_DYING = 3;
const S_COMPLETE = 4;

/**
 * Headless verification driver. It plays a level the way a competent pair would:
 * both robots are steered independently, so a level that needs the two of them in
 * different lanes still has to be genuinely solvable for the check to pass.
 */
export class Bot {
  private running = false;
  private startT = 0;
  private timeoutMs = 0;
  private pilot = new Autopilot();
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
    this.pilot.reset();
    this.trace = [];
    this.pilot.onTrace = (line) => {
      this.trace.push(line);
      if (this.trace.length > 400) this.trace.splice(0, 200);
    };
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
    const lead = this.pilot.plan(r, 0, null);
    const follow = this.pilot.plan(r, 1, lead.rotDir);
    inputs[0].lat = lead.lat;
    inputs[0].jump = lead.jump;
    inputs[0].grip = lead.grip;
    inputs[1].lat = follow.lat;
    inputs[1].jump = follow.jump;
    inputs[1].grip = follow.grip;
  }

}
