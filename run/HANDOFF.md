# HANDOFF — Tether Run: finish crumble/spinner systems + playthrough bot

Repo: `/Users/derek/Desktop/crazygames/run`
Stack: TypeScript + Vite + Three.js + Rapier3D-compat 0.20. `npm run dev`, `npm run build`, `npm run qa` (Playwright, channel: "chrome", spawns its own vite on :5199).

## Current state

The game is complete and green (112 QA checks) EXCEPT the last feature slice is half-wired. I just patched `src/tunnel/Tunnel.ts` with two new systems — **crumble tiles** (`'~'` pattern char: solid until stood on 0.5s, then collider removed + mesh falls) and **spinner bars** (kinematic jump-rope bars, `LevelDef.spinners`). Tunnel.ts compiles. **`src/game/Game.ts` line ~172 does not** — the Tunnel constructor gained an `R: typeof RAPIER` parameter and the call site wasn't updated. That is the only tsc error right now.

Levels 02/04/07/10/13/16/19/20 already contain `'~'` crumble patterns and `spinners` arrays (authored, slice-counts audited). `types.ts`, `helpers.ts`, `sections.ts` support both.

## Your tasks, in order

### 1. Fix the Tunnel call site (Game.ts:172)

```ts
this.tunnel = new Tunnel(this.scene, this.world, def, RAPIER, (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
```

### 2. Game.ts wiring

In `fixedUpdate(dt)`:
- BEFORE `this.world.step()`: `this.tunnel.updateSpinners(dt);`
- AFTER `this.world.step()`:
```ts
const cev = this.tunnel.updateCrumble(dt, this.players, this.world, frame.up);
if (cev.broken.length) {
  audio.crumble();
  for (const p of cev.broken) this.effects.burst(p, 0xffa060, 10, 5, 0.5, 10);
}
```

In `resetLevel()`: add `this.tunnel.resetCrumbles(this.world, RAPIER);`

Add public field + hooks:
```ts
timeScale = 1;
botInput = { lat: 0, jump: false, active: false };
bot: { tick(dt: number): void } | null = null;
```
In `frame(dtReal)`: first line → `this.bot?.tick(dtReal);`
Accumulator line → `this.accumulator += dtReal * scale * this.timeScale;` and raise the step cap from `steps < 8` to `steps < 40`.

In `exposeDebug()` add:
```ts
setTimeScale: (s: number) => { this.timeScale = s; },
setPlayerCollision: (on: boolean) => { for (const p of this.players) p.setCollide(on); },
crumbleBroken: () => this.tunnel.crumbleBrokenCount(),
```
and extend the existing `snapshot()` return with `spinners: this.tunnel.spinnerStates(),`.

Add public methods:
```ts
botRead() {
  return {
    state: this.state as number,
    orientation: this.orientation,
    def: LEVELS[this.levelIdx],
    p1: this.players[0],
    spinners: this.tunnel.spinnerStates(),
    timeScale: this.timeScale,
  };
}
botFollow() {
  const p2 = this.players[1];
  p2.autoRun = false;
  const t = this.players[0].body.translation();
  p2.warp(t.x + 0.7, t.y, t.z + 0.4);
}
```

### 3. Player.ts

Store the collider: in `attachBody`, `this.collider = world.createCollider(colDesc, this.body);` with field `collider!: RAPIER.Collider;`. Add:
```ts
setCollide(on: boolean) {
  this.collider.setCollisionGroups((PLAYER_GROUP << 16) | (on ? STATIC_GROUP | PLAYER_GROUP : STATIC_GROUP));
}
```

### 4. InputManager.ts

Add `setBotSource(src: { lat: number; jump: boolean; active: boolean } | null)` storing it; at the END of `sample()` (after gamepad block):
```ts
if (this.botSrc?.active) {
  lat = Math.max(-1, Math.min(1, this.botSrc.lat));
  jumpHeld = this.botSrc.jump;
  jumpPressed = this.botSrc.jump && !this.prevBotJump;
  this.prevBotJump = this.botSrc.jump;
}
```
(`prevBotJump` private field; also reset it in `clearMovementKeys`.) Note `lat` is declared `let` — reassign is fine.

### 5. AudioManager.ts — add method
```ts
crumble() { this.noise(0.16, 900, 0.2); this.tone("square", 220, 80, 0.14, 0.1); }
```

### 6. NEW FILE src/game/Bot.ts (exact logic — this drives the beatability test)

```ts
import { getFrame, Orientation } from "../tunnel/SurfaceOrientation";

const S_PLAYING = 1, S_COMPLETE = 4;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class Bot {
  private running = false;
  private startT = 0;
  private timeoutMs = 0;
  private rotDir = 0;
  private jumpUntil = 0;
  private resolve_: ((r: { ok: boolean; reason: string }) => void) | null = null;

  constructor(private game: any) {}

  run(idx: number) {
    this.game.startRun(idx);
    const def = this.game.botRead().def;
    const simMs = (def.slices.length * 2 * 1.6 + 14) * 1000;
    this.timeoutMs = simMs / Math.max(1, this.game.timeScale);
    this.running = true;
    this.startT = performance.now();
    this.rotDir = 0;
    this.jumpUntil = 0;
    return new Promise<{ ok: boolean; reason: string }>((res) => { this.resolve_ = res; });
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
    if (r.state === 3 /* Dying */) return this.finish(false, "died");
    if (performance.now() - this.startT > this.timeoutMs) return this.finish(false, "timeout");
    const inp = this.game.botInput;
    inp.active = true;
    if (r.state !== S_PLAYING) { inp.lat = 0; inp.jump = false; return; }

    const face = ["f", "r", "c", "l"][r.orientation as number];
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

    for (const sp of r.spinners) {
      const dz = t.z - sp.z;
      if (dz > -2 && dz < 14) {
        const targetCol = along > 0 ? 0 : 4;
        lat = targetCol < col ? -1 : targetCol > col ? 1 : 0;
        if (emptyCount(0, 3) >= 3 && r.p1.grounded) wantJump = true;
        this.apply(lat, wantJump);
        return;
      }
    }

    if (emptyCount(i + 2, i + 9) >= 5) {
      const score = (dir: number) => {
        const nf = ["f", "r", "c", "l"][(o2n(r.orientation) + dir + 4) % 4];
        let k = 0;
        for (let d = 2; d <= 14; d++) {
          const s = slices[clamp(i + d, 0, n - 1)];
          const v = (s as any)[nf];
          k += v ? (v[col] !== "." ? 1 : 0) : 1;
        }
        return k;
      };
      this.rotDir = score(1) >= score(-1) ? 1 : -1;
      lat = this.rotDir;
      if ((!solid(i, col) || !solid(i + 1, col)) && r.p1.grounded) wantJump = true;
    } else {
      this.rotDir = 0;
      let firstEmpty = 99;
      for (let d = 0; d <= 6; d++) if (!solid(i + d, col)) { firstEmpty = d; break; }
      if (firstEmpty <= 4) {
        let best = col, bestD = 99;
        for (let c = 0; c < 5; c++) {
          if (c === col) continue;
          let ok = true;
          for (let d = 1; d <= 4; d++) if (!solid(i + d, c)) { ok = false; break; }
          if (ok && Math.abs(c - col) < bestD) { best = c; bestD = Math.abs(c - col); }
        }
        if (bestD < 99) lat = Math.sign(best - col);
      }
      if (firstEmpty >= 1 && firstEmpty <= 3 && r.p1.grounded) wantJump = true;
      if (firstEmpty === 0 && r.p1.grounded) wantJump = true;
    }

    if (wantJump) this.jumpUntil = performance.now() + 420;
    inp.lat = lat;
    inp.jump = performance.now() < this.jumpUntil;
    this.game.botFollow();

    function o2n(o: Orientation) { return o as number; }
  }

  private apply(lat: number, jump: boolean) {
    this.game.botInput.lat = lat;
    this.game.botInput.jump = jump;
    this.game.botFollow();
  }
}
```
(If `Orientation` import is awkward, compare `r.orientation` numerically; the `o2n` helper above handles it.)

### 7. main.ts

```ts
import { Bot } from "./game/Bot";
const botMode = new URLSearchParams(location.search).has("bot");
game.init(canvas).then(() => {
  booted = true;
  new TouchControls(document.getElementById("touch-ui"), () => game.pauseGame(), () => game.muteGame());
  if (botMode) {
    game.bot = new Bot(game);
    (window as unknown as Record<string, unknown>).__TR__ &&
      ((window as any).__TR__.bot = game.bot);
  }
});
```
(`__TR__` is set inside `game.init`.)

### 8. qa.mjs — replace the existing 20-iteration warp loop's ROLE (keep it, it's fast) and ADD after the "R restarts run from L1" check:

```js
await page.evaluate(() => {
  window.__TR__.setTimeScale(3);
  window.__TR__.setPlayerCollision(false);
});
for (let i = 0; i < 20; i++) {
  const res = await page.evaluate((idx) => window.__TR__.bot.run(idx), i);
  check(`level ${i + 1} BEATABLE (bot playthrough)`, res.ok, res.reason);
}
await page.evaluate(() => {
  window.__TR__.setPlayerCollision(true);
  window.__TR__.setTimeScale(1);
});
```
Also add (before that block):
```js
await page.evaluate(() => window.__TR__.startRun(1));
await page.waitForTimeout(300);
await page.evaluate(() => {
  const t = window.__TR__;
  t.warp(0, 0, -4.52, -69);
  t.warp(1, 0, -4.52, -67.5);
});
await page.waitForTimeout(1400);
check("crumble tiles break underfoot", await page.evaluate(() => window.__TR__.crumbleBroken()) > 0, "");
await page.evaluate(() => window.__TR__.startRun(3));
await page.waitForTimeout(400);
const sp1 = (await snap()).spinners;
await page.waitForTimeout(500);
const sp2 = (await snap()).spinners;
check("spinner exists and rotates", sp1.length > 0 && Math.abs(sp2[0].angle - sp1[0].angle) > 0.5, "");
```
IMPORTANT: the QA page URL must become `BASE + "/?bot=1"` in `page.goto` so the bot exists.

## Verification loop (mandatory)

1. `npx tsc --noEmit` → 0 errors.
2. `node scripts/qa.mjs` → all checks pass INCLUDING the 20 "BEATABLE" ones.
3. If a specific level fails the bot: read its file in `src/levels/data/`, decide whether it's a bot limitation (e.g. jump triggered 1 slice late on a 3-slice gap → extend detection window) or genuine level tightness (then relax that level: widen a gap landing, lengthen a rotation window by 2 slices). The bot may be tuned freely; level geometry may only be relaxed within the documented envelope (gaps ≤ 3 slices, rotation windows ≥ 8, side-swap periods ≥ 4).
4. `npm run build` → clean. Commit: "feat: crumble tiles + spinner bars + bot playthrough verification".
5. Restart dev server on port 5173 (`nohup npx vite --port 5173 --host > /tmp/tether-run-dev.log 2>&1 &`) and report the URL from the log.

## Gotchas

- Rapier kinematic: call `setNextKinematicRotation` every fixed step BEFORE `world.step()`.
- Crumble colliders: `world.removeCollider(collider, true)`; respawn via `world.createCollider(desc, body)` — desc is reusable.
- Bot runs need `setPlayerCollision(false)` (P2 teleports onto P1 each tick) and the P2 follow (`botFollow`) to keep the tether slack — otherwise the tether drags P1 backward.
- The QA `snap()` helper closes over the MAIN page — for mobile/mp pages use `mp.evaluate(...)` directly (past mistake).
- Don't touch tether physics constants or the orientation system — they're tuned and verified.
