import type { PowerupDef, PowerupId } from '../data/powerups';

/**
 * Pure, deterministic powerup state machine.
 *
 * No Phaser, no DOM, no wall-clock: time enters only through `update(dtMs)`
 * and `maybeSpawn(elapsedMs)`, both fed by the orchestrator, so a fixed seed
 * plus a fixed call script reproduces a session exactly. Randomness comes from
 * an injectable `rng` (default `Math.random`) and is spent exclusively on
 * rolling respawn gaps.
 *
 * Time model:
 * - `update(dt)` advances the internal visible-play clock and burns down
 *   active effect durations. The orchestrator gates dt (passes 0 while a modal,
 *   reveal, or pause hides the board), which is what keeps spawns and effects
 *   from quietly running where the player cannot see them -- same contract as
 *   the golden clock's timers.
 * - `maybeSpawn(elapsedMs)` polls for due pickups. `elapsedMs` is the
 *   caller's monotonic visible-play total; it is folded in forward-only as a
 *   drift correction, never backwards. At most ONE spawn leaves per call.
 * - Catch-up is bounded by construction: when a def finally fires after a
 *   long gate its next window is scheduled strictly into the future from
 *   "now", so accumulated lateness is discarded rather than replayed. A gated
 *   afternoon can never produce a burst of back-to-back spawns for the same
 *   id; each overdue def surfaces once per poll cycle at most.
 */

export interface ActiveEffectView {
  readonly id: PowerupId;
  /**
   * Time left before the effect lapses. `-1` marks an effect with no clock at
   * all (the ward), which instead ends through `consumeWardCharge`.
   */
  readonly remainingMs: number;
  /** Present only on multiplier effects. */
  readonly factor?: number;
  /** Present only on the ward; charges left in that pool. */
  readonly charges?: number;
}

export interface HudEffect {
  readonly id: PowerupId;
  readonly label: string;
  readonly iconTexture: string;
  readonly hudColor: number;
  /** Largest remaining time among stacked instances (-1 for the ward). */
  readonly remainingMs: number;
  /** Nominal duration to scale a countdown bar against (0 for the ward). */
  readonly durationMs: number;
  /** Total ward charges live across pools; omitted for timed effects. */
  readonly charges?: number;
}

/** JSON-safe snapshot. Ephemeral BY DESIGN -- see `serialize`. */
export interface PowerupSnapshot {
  readonly version: 1;
  /** Wall-clock stamp from the injectable `now`, telemetry only. */
  readonly savedAtMs: number;
  readonly visibleClockMs: number;
  readonly schedules: ReadonlyArray<{ id: PowerupId; nextSpawnAtMs: number }>;
  readonly effects: ReadonlyArray<{
    id: PowerupId;
    remainingMs: number;
    factor: number;
    charges: number;
  }>;
}

interface ActiveEffect {
  /** Countdown; 0 means "no clock" (ward pool) and never decays. */
  remainingMs: number;
  readonly totalMs: number;
  factor: number;
  charges: number;
}

interface DefRuntime {
  /** Absolute visible-clock time of this def's next spawn opportunity. */
  nextSpawnAtMs: number;
  live: ActiveEffect[];
}

export interface PowerupSystemOptions {
  /** Deterministic gap rolls; defaults to Math.random. */
  rng?: () => number;
  /**
   * Injectable wall clock, used solely to timestamp snapshots. It NEVER
   * drives gameplay so tests stay deterministic.
   */
  now?: () => number;
  /**
   * Master gate polled by maybeSpawn. While it returns false no pickup is
   * offered and no schedule is touched; overdue windows simply wait. The
   * scene wires this to "board actually visible and interactive".
   */
  canSpawn?: () => boolean;
}

const clampFiniteMs = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

export class PowerupSystem {
  private readonly defs: Map<PowerupId, PowerupDef>;
  private readonly order: readonly PowerupId[];
  private readonly runtime = new Map<PowerupId, DefRuntime>();
  private readonly rng: () => number;
  private readonly now: () => number;
  private readonly canSpawn: () => boolean;

  /** Internal monotonic visible-play clock; advanced ONLY by update(). */
  private visibleClockMs = 0;

  constructor(defs: readonly PowerupDef[], opts: PowerupSystemOptions = {}) {
    this.defs = new Map();
    const order: PowerupId[] = [];
    for (const def of defs) {
      if (this.defs.has(def.id)) throw new Error(`duplicate powerup id: ${def.id}`);
      this.defs.set(def.id, def);
      order.push(def.id);
    }
    this.order = order;
    this.rng = opts.rng ?? ((): number => Math.random());
    this.now = opts.now ?? ((): number => Date.now());
    this.canSpawn = opts.canSpawn ?? ((): boolean => true);
    this.resetSchedules();
  }

  /**
   * Advance the world. Spawn schedules and effect durations move ONLY here;
   * negative or non-finite input is treated as no time at all.
   */
  update(dtMs: number): void {
    const dt = clampFiniteMs(dtMs);
    this.visibleClockMs += dt;
    if (dt === 0) return;
    for (const rt of this.runtime.values()) {
      let i = 0;
      while (i < rt.live.length) {
        const effect = rt.live[i]!;
        if (effect.totalMs > 0) {
          effect.remainingMs -= dt;
          if (effect.remainingMs <= 0) {
            rt.live.splice(i, 1);
            continue;
          }
        } else if (effect.charges <= 0) {
          // An exhausted ward pool is no longer an active effect; it would
          // otherwise haunt the HUD forever.
          rt.live.splice(i, 1);
          continue;
        }
        i += 1;
      }
    }
  }

  /**
   * Poll for one due pickup. Returns its id exactly once per window, then
   * reschedules that def into the future; returns null otherwise, including
   * every call made while the `canSpawn` gate is shut.
   *
   * `elapsedMs` is the orchestrator's monotonic visible-play total. Folding it
   * in forward-only corrects any drift between the caller's accumulation and
   * update()-fed time without ever rewinding the clock.
   */
  maybeSpawn(elapsedMs: number): PowerupId | null {
    if (Number.isFinite(elapsedMs) && elapsedMs > this.visibleClockMs) {
      this.visibleClockMs = elapsedMs;
    }
    if (!this.canSpawn()) return null;
    for (const id of this.order) {
      const rt = this.runtime.get(id);
      const def = this.defs.get(id);
      if (!rt || !def || rt.nextSpawnAtMs > this.visibleClockMs) continue;
      // Lateness is discarded on purpose: the fresh window starts now, so a
      // long gate yields a single catch-up spawn, never a burst.
      const chance = def.cadence.spawnChance;
      const offered = chance === undefined || this.rollUnit() < Math.max(0, Math.min(1, chance));
      rt.nextSpawnAtMs = this.visibleClockMs + this.rollGapMs(def);
      if (offered) return id;
    }
    return null;
  }

  /** Schedules a one-off guaranteed offer without allowing the normal window
   * to produce a duplicate immediately afterwards. */
  forceSpawn(id: PowerupId = this.order[0]!): PowerupId | null {
    const rt = this.runtime.get(id);
    const def = this.defs.get(id);
    if (!rt || !def || !this.canSpawn()) return null;
    rt.nextSpawnAtMs = this.visibleClockMs + this.rollGapMs(def);
    return id;
  }

  /** Apply a collected pickup honouring its stack policy. False if unknown id. */
  activate(id: PowerupId): boolean {
    const def = this.defs.get(id);
    const rt = this.runtime.get(id);
    if (!def || !rt) return false;
    switch (def.stack) {
      case 'charges': {
        // One pooled counter; re-topping stacks up to the def's own cap.
        if (def.effect !== 'ward') return false;
        let pool = rt.live[0];
        if (!pool) {
          pool = this.newInstance(def);
          rt.live.push(pool);
        }
        pool.charges = Math.min(pool.charges + def.charges, def.charges);
        return true;
      }
      case 'extend': {
        if (rt.live.length < def.maxActiveOfSame) {
          rt.live.push(this.newInstance(def));
          return true;
        }
        const oldest = rt.live[0];
        if (!oldest) return false;
        oldest.remainingMs = Math.min(oldest.remainingMs + oldest.totalMs, oldest.totalMs * 2);
        return true;
      }
      case 'refresh': {
        if (rt.live.length < def.maxActiveOfSame) {
          rt.live.push(this.newInstance(def));
          return true;
        }
        const oldest = rt.live[0];
        if (!oldest) return false;
        oldest.remainingMs = oldest.totalMs;
        return true;
      }
      case 'instant':
        // Instant effects have no simulation-owned duration or HUD state. The
        // orchestrator reacts to powerupCollected and owns their finite work.
        return def.effect === 'coinRain';
    }
  }

  /** Product of every live DPS multiplier; 1 when none are running. */
  get dpsMultiplier(): number {
    return this.foldEffects('dpsMultiplier', (acc, e) => acc * e.factor);
  }

  /** Product of every live coin multiplier; 1 when none are running. */
  get coinMultiplier(): number {
    return this.foldEffects('coinMultiplier', (acc, e) => acc * e.factor);
  }

  /** True while any smoke bomb's pause window is open. */
  get bossAttacksPaused(): boolean {
    for (const [id, rt] of this.runtime) {
      if (this.defs.get(id)?.effect === 'bossAttacksPaused' && rt.live.length > 0) return true;
    }
    return false;
  }

  /** Total ward charges across all pools. */
  get wardCharges(): number {
    let sum = 0;
    for (const [id, rt] of this.runtime) {
      if (this.defs.get(id)?.effect !== 'ward') continue;
      for (const e of rt.live) sum += e.charges;
    }
    return sum;
  }

  /**
   * Spend one ward charge against an incoming hit. True when a charge was
   * available (and is now gone); false means the hit lands unprotected.
   */
  consumeWardCharge(): boolean {
    for (const [id, rt] of this.runtime) {
      if (this.defs.get(id)?.effect !== 'ward') continue;
      for (let i = 0; i < rt.live.length; i += 1) {
        const e = rt.live[i]!;
        if (e.charges > 0) {
          e.charges -= 1;
          if (e.charges === 0) rt.live.splice(i, 1);
          return true;
        }
      }
    }
    return false;
  }

  /** Flat view of everything currently running, freshest copies, stable order. */
  activeEffects(): ActiveEffectView[] {
    const out: ActiveEffectView[] = [];
    for (const id of this.order) {
      const def = this.defs.get(id);
      const rt = this.runtime.get(id);
      if (!def || !rt) continue;
      for (const e of rt.live) {
        out.push(
          def.effect === 'ward'
            ? { id, remainingMs: -1, charges: e.charges }
            : { id, remainingMs: e.remainingMs, ...(def.effect !== 'bossAttacksPaused' ? { factor: e.factor } : {}) },
        );
      }
    }
    return out;
  }

  /** What the HUD should render right now, one entry per active def. */
  hudState(): HudEffect[] {
    const out: HudEffect[] = [];
    for (const id of this.order) {
      const def = this.defs.get(id);
      const rt = this.runtime.get(id);
      if (!def || !rt || rt.live.length === 0) continue;
      const durationMs = def.effect === 'ward' || def.effect === 'coinRain' ? 0 : def.durationMs;
      let remainingMs = 0;
      let charges = 0;
      for (const e of rt.live) {
        remainingMs = Math.max(remainingMs, e.remainingMs);
        charges += e.charges;
      }
      out.push({
        id,
        label: def.label,
        iconTexture: def.iconTexture,
        hudColor: def.hudColor,
        remainingMs: def.effect === 'ward' ? -1 : remainingMs,
        durationMs,
        ...(def.effect === 'ward' ? { charges } : {}),
      });
    }
    return out;
  }

  /** Back to a pristine first-ever session: schedules reset, effects wiped. */
  clear(): void {
    this.visibleClockMs = 0;
    this.resetSchedules();
  }

  /**
   * JSON-safe snapshot of schedules and live effects.
   *
   * EPHEMERAL BY DESIGN: powerups are session luck, not progress, so this is
   * deliberately kept OUT of the run save. It exists for mid-session scene
   * rebuilds (resize/reboot of the presentation layer) and debug tooling --
   * closing the tab during a frenzy losing it is intended behaviour.
   */
  serialize(): PowerupSnapshot {
    const schedules: Array<{ id: PowerupId; nextSpawnAtMs: number }> = [];
    const effects: Array<{ id: PowerupId; remainingMs: number; factor: number; charges: number }> = [];
    for (const [id, rt] of this.runtime) {
      schedules.push({ id, nextSpawnAtMs: rt.nextSpawnAtMs });
      for (const e of rt.live) effects.push({ id, remainingMs: e.remainingMs, factor: e.factor, charges: e.charges });
    }
    return { version: 1, savedAtMs: Math.floor(this.now()), visibleClockMs: this.visibleClockMs, schedules, effects };
  }

  /**
   * Restore a snapshot produced by serialize. Tolerant of garbage: anything
   * malformed or version-mismatched is ignored wholesale. Returns success.
   */
  deserialize(snapshot: unknown): boolean {
    if (typeof snapshot !== 'object' || snapshot === null) return false;
    const raw = snapshot as Partial<PowerupSnapshot> & Record<string, unknown>;
    if (raw.version !== 1 || typeof raw.visibleClockMs !== 'number') return false;
    if (!Array.isArray(raw.schedules) || !Array.isArray(raw.effects)) return false;
    const schedules = new Map<PowerupId, number>();
    for (const entry of raw.schedules) {
      if (
        typeof entry === 'object' && entry !== null &&
        this.defs.has((entry as { id?: unknown }).id as PowerupId) &&
        Number.isFinite((entry as { nextSpawnAtMs?: unknown }).nextSpawnAtMs)
      ) {
        schedules.set(
          (entry as { id: PowerupId }).id,
          Math.max(0, (entry as { nextSpawnAtMs: number }).nextSpawnAtMs),
        );
      }
    }
    if (schedules.size !== this.defs.size) return false;
    const live = new Map<PowerupId, ActiveEffect[]>();
    for (const entry of raw.effects) {
      if (typeof entry !== 'object' || entry === null) return false;
      const rec = entry as { id?: unknown; remainingMs?: unknown; factor?: unknown; charges?: unknown };
      const def = this.defs.get(rec.id as PowerupId);
      if (!def || typeof rec.remainingMs !== 'number') return false;
      const bucket = live.get(def.id) ?? [];
      bucket.push({
        remainingMs: Math.max(0, rec.remainingMs),
        totalMs: def.effect === 'ward' || def.effect === 'coinRain' ? 0 : def.durationMs,
        factor: typeof rec.factor === 'number' ? rec.factor : 1,
        charges: typeof rec.charges === 'number' ? Math.max(0, rec.charges) : 0,
      });
      live.set(def.id, bucket);
    }
    // All-or-nothing applied: state is only mutated once every entry parsed.
    this.visibleClockMs = Math.max(0, raw.visibleClockMs);
    for (const [id, rt] of this.runtime) {
      const next = schedules.get(id);
      if (next !== undefined) rt.nextSpawnAtMs = next;
      rt.live = live.get(id) ?? [];
    }
    return true;
  }

  private rollGapMs(def: PowerupDef): number {
    // Normal pickups spend exactly one rng draw per window. Rare definitions
    // spend one additional eligibility draw in maybeSpawn.
    const roll = this.rollUnit();
    const { minGapMs, maxGapMs } = def.cadence;
    return Math.round(minGapMs + (maxGapMs - minGapMs) * roll);
  }

  private rollUnit(): number {
    const raw = this.rng();
    return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5;
  }

  private newInstance(def: PowerupDef): ActiveEffect {
    const totalMs = def.effect === 'ward' || def.effect === 'coinRain' ? 0 : def.durationMs;
    const factor =
      def.effect === 'dpsMultiplier' || def.effect === 'coinMultiplier' ? def.factor : 1;
    return {
      remainingMs: totalMs,
      totalMs,
      factor,
      charges: def.effect === 'ward' ? def.charges : 0,
    };
  }

  private foldEffects(effect: 'dpsMultiplier' | 'coinMultiplier', fold: (acc: number, e: ActiveEffect) => number): number {
    let acc = 1;
    for (const [id, rt] of this.runtime) {
      if (this.defs.get(id)?.effect !== effect) continue;
      for (const e of rt.live) acc = fold(acc, e);
    }
    return acc;
  }

  private resetSchedules(): void {
    this.runtime.clear();
    for (const id of this.order) {
      const def = this.defs.get(id);
      if (!def) continue;
      this.runtime.set(id, {
        nextSpawnAtMs: clampFiniteMs(def.cadence.firstSpawnMs),
        live: [],
      });
    }
  }
}
