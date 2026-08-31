import type { Object3D, Scene } from 'three';
import { FLOW } from '../config';
import type { Rng } from '../core/Rng';
import { Enemy } from './Enemy';
import type { Props } from '../fx/Props';
import { flowReactionWindow } from './FlowSystem';
import type { Lane } from '../input/InputManager';
import type { Side } from './PatternDirector';

export type FlowPhase = 'off' | 'activating' | 'chain' | 'finisherWindup' | 'finisher' | 'recover';

export interface FlowEvent {
  type: 'activate' | 'hit' | 'miss' | 'finisherReady' | 'finisherHit' | 'end';
  lane?: Lane;
  index?: number;
  /** World X of the struck target, for VFX placement. */
  x?: number;
  y?: number;
  completed?: boolean;
}

const POOL = 12;

/**
 * Flow Mode: an interactive power fantasy, never a cutscene.
 *
 * The player keeps exactly the two inputs they already have. Each correct
 * direction dashes the hero to the next target; the reaction budget tightens
 * every step, so the sequence accelerates under the player's own hands rather
 * than playing itself. A missed input costs the chain and the bonus — never
 * health, because Flow is a reward and punishing it teaches players to fear it.
 */
export class FlowMode {
  phase: FlowPhase = 'off';
  /** Hero X position during the chain — the camera and player follow this. */
  heroX = 0;

  private readonly pool: Enemy[] = [];
  private targets: Enemy[] = [];
  private index = 0;
  private timer = 0;
  private window = 1;
  private hits = 0;
  private finisher: Enemy | null = null;
  private events: FlowEvent[] = [];
  private dashFrom = 0;

  constructor(
    scene: Scene,
    private readonly rng: Rng,
    props: Props | null = null,
  ) {
    for (let i = 0; i < POOL; i++) {
      const e = new Enemy(props);
      scene.add(e.group);
      this.pool.push(e);
    }
  }

  get active(): boolean {
    return this.phase !== 'off';
  }

  /** True while the sequence still wants the player's LEFT/RIGHT input. */
  get acceptsInput(): boolean {
    return this.phase === 'chain' || this.phase === 'finisherWindup';
  }

  /**
   * The side the chain wants next — and, during the activation hold, the side
   * it is about to want. The hold exists so the player can read the first
   * target before its clock starts, which only works if the cue is up.
   */
  get currentSide(): Side | null {
    if (this.phase === 'activating' || this.phase === 'chain') {
      return this.targets[this.index]?.side ?? null;
    }
    if (this.phase === 'finisherWindup') return this.finisher?.side ?? null;
    return null;
  }

  /** Where the hero dashed from, for drawing the speed streak. */
  get lastDashFrom(): number {
    return this.dashFrom;
  }

  /** Fraction of the current reaction window already spent, 0..1. */
  get urgency(): number {
    return this.window > 0 ? Math.min(1, this.timer / this.window) : 0;
  }

  get chainLength(): number {
    return this.targets.length;
  }

  get hitCount(): number {
    return this.hits;
  }

  /** All pooled actors, exposed so the arena can place them on its bridge. */
  get liveEnemies(): readonly Enemy[] {
    return this.pool;
  }

  setDetailedEnemyModels(factory: (index: number) => Object3D | null): void {
    for (let index = 0; index < this.pool.length; index++) {
      const enemy = this.pool[index];
      const model = factory(index);
      if (model) enemy.setDetailedModel(model);
    }
  }

  start(heroX: number, now: number): void {
    this.phase = 'activating';
    this.timer = 0;
    this.index = 0;
    this.hits = 0;
    this.heroX = heroX;
    this.dashFrom = heroX;

    const count = FLOW.minTargets + this.rng.int(FLOW.maxTargets - FLOW.minTargets + 1);
    this.targets = [];

    // Targets alternate with a deliberate stutter: pure alternation would let a
    // player win Flow with a rhythm rather than by reading it.
    let side: Side = this.rng.chance(0.5) ? 'L' : 'R';
    for (let i = 0; i < count; i++) {
      if (i > 0) side = this.rng.chance(0.68) ? flip(side) : side;
      const enemy = this.pool[i];
      const distance = 2.4 + this.rng.range(0, 1.5);
      enemy.spawn({
        side,
        impactAt: now + 999,
        spawnAt: now,
        approach: 0.001,
        rare: false,
        rng: this.rng,
      });
      enemy.state = 'idle';
      enemy.poseAt(side === 'L' ? -distance : distance, this.rng.range(-0.8, 0.8));
      this.targets.push(enemy);
    }

    this.finisher = this.pool[POOL - 1];
    // The chain is marked from the first frame, so the activation hold is time
    // to READ the first target rather than dead time before a guess.
    this.markChain();
    this.events.push({ type: 'activate' });
  }

  /** Handles a directional press. Returns true when it resolved something. */
  press(lane: Lane): boolean {
    if (!this.acceptsInput) return false;
    const side: Side = lane === 'left' ? 'L' : 'R';

    if (this.phase === 'finisherWindup') {
      if (!this.finisher) return false;
      if (side !== this.finisher.side) {
        this.fail();
        return true;
      }
      this.phase = 'finisher';
      this.timer = 0;
      this.dashFrom = this.heroX;
      this.heroX = this.finisher.group.position.x * 0.45;
      this.finisher.kill(this.heroX, 2.4);
      this.events.push({
        type: 'finisherHit',
        lane,
        x: this.finisher.group.position.x,
        y: this.finisher.group.position.y + 1.1,
      });
      return true;
    }

    const target = this.targets[this.index];
    if (!target) return false;
    if (side !== target.side) {
      this.fail();
      return true;
    }

    this.dashFrom = this.heroX;
    this.heroX = target.group.position.x * 0.55;
    target.kill(this.heroX, 1.5);
    this.hits += 1;
    this.events.push({
      type: 'hit',
      lane,
      index: this.index,
      x: target.group.position.x,
      y: target.group.position.y + 1.05,
    });

    this.index += 1;
    this.timer = 0;
    this.window = flowReactionWindow(this.index);
    this.markChain();

    if (this.index >= this.targets.length) this.beginFinisher();
    return true;
  }

  /** @param dt REAL delta — Flow's own slow motion must not slow its clock. */
  update(dt: number, now: number): void {
    if (this.phase === 'off') return;
    this.timer += dt;

    switch (this.phase) {
      case 'activating':
        if (this.timer >= FLOW.activationHold) {
          this.phase = 'chain';
          this.timer = 0;
          this.window = flowReactionWindow(0);
        }
        break;

      case 'chain':
        if (this.timer >= this.window) this.fail();
        break;

      case 'finisherWindup':
        if (this.timer >= FLOW.finisherWindow) this.fail();
        break;

      case 'finisher':
        if (this.timer >= 0.55) {
          this.phase = 'recover';
          this.timer = 0;
        }
        break;

      case 'recover':
        if (this.timer >= FLOW.recoverPause) this.end(true);
        break;

      default:
        break;
    }

    for (const e of this.pool) e.update(dt, now);
  }

  /**
   * The chain's bodies with their current marking, for tests that need to see
   * what the PLAYER can see rather than what the chain knows.
   */
  debugTargets(): Array<{ side: Side; marked: 'none' | 'target' | 'queued' }> {
    const list = this.targets.map((e) => ({ side: e.side, marked: e.marked }));
    if (this.finisher && this.phase === 'finisherWindup') {
      list.push({ side: this.finisher.side, marked: this.finisher.marked });
    }
    return list;
  }

  /** Drains and returns the events queued since the last call. */
  drain(): FlowEvent[] {
    if (this.events.length === 0) return EMPTY;
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Immediately tears the sequence down, e.g. on death or restart. */
  abort(): void {
    for (const e of this.pool) {
      e.setFlowMark('none');
      e.retire();
    }
    this.targets = [];
    this.finisher = null;
    this.phase = 'off';
    this.heroX = 0;
  }

  /**
   * Keeps exactly one body lit as the target the chain wants next.
   *
   * This is the whole readability of Flow: the player is asked for a direction
   * under a tightening clock, so the body that direction refers to has to be
   * unmistakable. Everything already cut down, or still queued behind, shrinks
   * out of the way.
   */
  private markChain(): void {
    for (let i = 0; i < this.targets.length; i++) {
      const e = this.targets[i];
      // A body already cut down gives its mark up: leaving the last kill lit
      // while the next target lights too would put two cues on screen, which is
      // no clearer than none.
      if (e.state === 'dying' || e.state === 'dead') {
        e.setFlowMark('none');
        continue;
      }
      e.setFlowMark(i === this.index ? 'target' : 'queued');
    }
  }

  private beginFinisher(): void {
    if (!this.finisher) {
      this.end(true);
      return;
    }
    const side: Side = this.rng.chance(0.5) ? 'L' : 'R';
    this.finisher.spawn({
      side,
      impactAt: 0,
      spawnAt: 0,
      approach: 0.001,
      rare: true,
      rng: this.rng,
    });
    this.finisher.state = 'idle';
    this.finisher.poseAt(side === 'L' ? -3.4 : 3.4, 0);
    this.finisher.setFlowMark('target');
    this.phase = 'finisherWindup';
    this.timer = 0;
    this.events.push({ type: 'finisherReady' });
  }

  private fail(): void {
    this.events.push({ type: 'miss' });
    this.end(false);
  }

  private end(completed: boolean): void {
    for (const e of this.pool) {
      e.setFlowMark('none');
      if (e.state === 'idle') e.retire();
    }
    this.targets = [];
    this.finisher = null;
    this.phase = 'off';
    this.heroX = 0;
    this.events.push({ type: 'end', completed });
  }
}

const EMPTY: FlowEvent[] = [];
const flip = (s: Side): Side => (s === 'L' ? 'R' : 'L');
