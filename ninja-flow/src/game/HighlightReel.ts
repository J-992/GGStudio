import { MathUtils, type Scene } from 'three';
import { ATTACK, CAMERA, HIGHLIGHTS, HITSTOP, VFX as VFXCFG } from '../config';
import type { Rng } from '../core/Rng';
import type { Lane } from '../input/InputManager';
import type { AudioEngine } from '../fx/Audio';
import { IMPACT_COLOR, type VFX } from '../fx/VFX';
import type { HUD } from '../ui/HUD';
import type { CameraRig } from './CameraRig';
import { choreographyFor, type ChoreoBeat } from './Choreography';
import { Enemy } from './Enemy';
import type { Props } from '../fx/Props';
import { captionFor, type Moment, type MomentKind } from './Highlights';
import { moveById, type Move } from './MoveLibrary';
import type { Player } from './Player';

/**
 * The death reel: a directed fight scene built from the run the player just had.
 *
 * Not a recording — a dramatisation. Each logged moment becomes one authored
 * shot: a choreographed exchange (see `Choreography`) staged with the live
 * actors, under a camera that leaves its gameplay framing entirely. A big combo
 * becomes a whole wave going down in one pass; the hero slides under the first
 * body, vaults the second, throws his blade through the third. What stays true
 * to the player is everything the log recorded: the sides they defended, the
 * quality they hit, the combo they carried.
 *
 * Any input skips straight to the results screen.
 */

interface Shot {
  /** Camera path in polar coordinates around the hero: angle, radius, height. */
  a0: number;
  a1: number;
  r0: number;
  r1: number;
  h0: number;
  h1: number;
  look0: readonly [number, number, number];
  look1: readonly [number, number, number];
}

/** One authored camera move per moment kind; `d` mirrors it to the hit side. */
const SHOTS: Record<MomentKind, (d: number) => Shot> = {
  // Wave clear: track alongside the charge, sliding in toward the hero.
  perfect: (d) => ({
    a0: d * 1.15, a1: d * 0.4, r0: 5.4, r1: 3.7, h0: 1.55, h1: 1.05,
    look0: [d * 1.7, 0.95, 0], look1: [d * 0.3, 1.05, 0],
  }),
  // Single clean kill: low hero shot pushing in from the off side.
  good: (d) => ({
    a0: -d * 0.42, a1: -d * 0.12, r0: 5.4, r1: 3.3, h0: 0.6, h1: 0.95,
    look0: [d * 1.2, 1.1, 0], look1: [0, 1.05, 0],
  }),
  // Golden target: high orbit sweeping across the arena to the kill.
  rare: (d) => ({
    a0: d * 0.95, a1: -d * 0.55, r0: 5.0, r1: 3.6, h0: 1.9, h1: 1.15,
    look0: [d * 1.4, 0.9, 0], look1: [0, 1.0, 0],
  }),
  // Finisher: dead-front crash zoom rising to a hero portrait.
  finisher: (d) => ({
    a0: d * 0.25, a1: 0, r0: 6.0, r1: 3.0, h0: 0.95, h1: 1.6,
    look0: [d * 1.2, 1.0, 0], look1: [0, 1.15, 0],
  }),
};

interface Beat {
  enemy: Enemy;
  /** Seconds into the shot at which this body goes down. */
  at: number;
  /** Seconds into the shot at which the hero starts the move. */
  startAt: number;
  started: boolean;
  killed: boolean;
  choreo: ChoreoBeat;
}

const easeInOut = (t: number): number => t * t * (3 - 2 * t);

/**
 * How long after a strike begins its blade actually arrives.
 *
 * The reel starts a move this far ahead of the beat so the contact frame lands
 * on the beat. It is derived from the ANIMATION's length, not the commitment
 * window: strikes play `animScale` times longer than control is locked for, and
 * using the commitment here makes every body die before it is touched.
 */
export function strikeLead(move: Move): number {
  return ATTACK.total * ATTACK.animScale * (move.speed ?? 1) * move.contactAt;
}

/**
 * How fast a shot plays.
 *
 * A short combo is a beat and plays close to real speed; a long one is the
 * run's set piece and is shown in slow motion, where the choreography can
 * actually be read. Finishers and golden targets are always shown slowly —
 * they are the moments the reel exists for.
 */
export function paceFor(m: Moment): number {
  const { lowCombo, lowScale, highCombo, highScale } = HIGHLIGHTS.pace;
  const t = MathUtils.clamp((m.combo - lowCombo) / Math.max(1, highCombo - lowCombo), 0, 1);
  const byCombo = MathUtils.lerp(lowScale, highScale, t);
  const showpiece = m.kind === 'finisher' || m.kind === 'rare';
  return showpiece ? Math.min(byCombo, HIGHLIGHTS.showpieceScale) : byCombo;
}
/** How long a thrown blade is in the air before it lands. */
const BLADE_FLIGHT = 0.22;

export class HighlightReel {
  private readonly enemies: Enemy[] = [];
  private queue: Moment[] = [];
  private index = -1;
  private vignetteStart = 0;
  private beats: Beat[] = [];
  private shot: Shot = SHOTS.good(1);
  private captioned = false;
  private duration = 1;
  private lastHeroX = 0;
  /** Seconds into the current shot. */
  private clock = 0;
  /** Playback speed for the shot being staged, set from its combo. */
  private pace: number = HIGHLIGHTS.timeScale;
  /** The body a thrown blade is currently flying toward. */
  private throwTarget: Beat | null = null;

  /** Where the choreography wants the hero this frame. */
  heroX = 0;
  /** The speed ramp: read by the game loop every reel tick. */
  desiredTimeScale: number = HIGHLIGHTS.timeScale;

  constructor(
    scene: Scene,
    private readonly rng: Rng,
    private readonly player: Player,
    private readonly vfx: VFX,
    private readonly rig: CameraRig,
    private readonly audio: AudioEngine,
    private readonly hud: HUD,
    private readonly fx: { flash(v: number): void; hitStop(s: number): void },
    props: Props | null = null,
  ) {
    for (let i = 0; i < HIGHLIGHTS.maxChain; i++) {
      const e = new Enemy(props);
      scene.add(e.group);
      e.retire();
      this.enemies.push(e);
    }
  }

  /** Dev-only view of the scene being staged, for scripted verification. */
  get debug(): {
    index: number;
    kind: string;
    beats: number;
    started: number;
    killed: number;
    clock: number;
    duration: number;
    ats: number[];
  } {
    return {
      index: this.index,
      kind: this.queue[this.index]?.kind ?? '-',
      beats: this.beats.length,
      started: this.beats.filter((b) => b.started).length,
      killed: this.beats.filter((b) => b.killed).length,
      clock: this.clock,
      duration: this.duration,
      ats: this.beats.map((b) => b.at),
    };
  }

  /** The camera frames hero and target together, not either one alone. */
  get focusX(): number {
    const live = this.beats.find((b) => !b.killed);
    const target = live ? live.enemy.group.position.x : 0;
    return (this.player.worldX + target) * 0.11;
  }

  /** All staged actors, exposed so the arena can place them on its bridge. */
  get liveEnemies(): readonly Enemy[] {
    return this.enemies;
  }

  start(moments: Moment[], now: number): void {
    this.queue = moments;
    this.index = -1;
    this.nextVignette(now);
  }

  /** Advances the cutscene; returns true when it is over (finished or skipped). */
  update(dt: number, now: number, skip: boolean): boolean {
    if (skip) {
      this.cleanup();
      return true;
    }

    for (const e of this.enemies) e.update(dt, now);

    const m = this.queue[this.index];
    const t = now - this.vignetteStart;
    this.clock = t;
    const dur = this.duration;
    const dir = m.side === 'L' ? -1 : 1;

    // Camera along its authored path.
    const p = easeInOut(MathUtils.clamp(t / dur, 0, 1));
    const a = MathUtils.lerp(this.shot.a0, this.shot.a1, p);
    const r = MathUtils.lerp(this.shot.r0, this.shot.r1, p);
    const h = MathUtils.lerp(this.shot.h0, this.shot.h1, p);
    this.rig.cineShot(
      Math.sin(a) * r,
      h,
      Math.cos(a) * r,
      MathUtils.lerp(this.shot.look0[0], this.shot.look1[0], p),
      MathUtils.lerp(this.shot.look0[1], this.shot.look1[1], p),
      MathUtils.lerp(this.shot.look0[2], this.shot.look1[2], p),
    );

    const last = this.beats[this.beats.length - 1];
    for (const b of this.beats) {
      // The hero commits early enough that his travel arrives on the beat.
      if (!b.started && t >= b.startAt) {
        b.started = true;
        this.startMove(m, b);
      }
      if (b.started && !b.killed && t >= b.at && this.throwTarget !== b) {
        this.land(m, b, b === last);
      }
    }

    this.playMoveEvents(m, dir);

    // The hero's own root motion carries him through the scene, so the reel
    // only holds the group still and lets the move do the travelling.
    this.heroX = 0;
    this.lastHeroX = this.player.worldX;

    // Speed ramp: the shot's own pace through the exchange, deeper slow motion
    // on the aftermath, then back up to snap out of the cut.
    this.desiredTimeScale =
      t < last.at || t > dur - 0.2 ? this.pace : Math.min(this.pace, HIGHLIGHTS.slowTimeScale);

    if (t >= dur) {
      if (this.index + 1 >= this.queue.length) {
        this.cleanup();
        return true;
      }
      this.nextVignette(now);
    }
    return false;
  }

  private nextVignette(now: number): void {
    this.index += 1;
    this.captioned = false;
    this.vignetteStart = now;
    this.throwTarget = null;
    this.player.reset();
    const m = this.queue[this.index];

    // The exaggeration: a high combo is staged as a whole wave falling in one
    // pass — one enemy per ~5 combo — even though the logged hit was a single
    // kill. A finisher brings three so the closing move has a crowd to end.
    const count =
      m.kind === 'perfect'
        ? Math.min(HIGHLIGHTS.maxChain, 1 + Math.floor(m.combo / 5))
        : m.kind === 'finisher'
          ? 3
          : 1;
    const choreo = choreographyFor(m.kind, count);
    this.pace = paceFor(m);

    // Wave members are spaced for the choreography, not for fairness: they
    // arrive on the beat the scene wants and stand at staggered depths so the
    // hero cuts through a crowd rather than a queue.
    this.beats = [];
    let at = HIGHLIGHTS.approachSeconds;
    for (let i = 0; i < count; i++) {
      const step = choreo[i];
      const move = moveById(step.move);
      const e = this.enemies[i];
      e.spawn({
        side: m.side,
        spawnAt: now,
        impactAt: now + at,
        approach: at,
        rare: m.kind === 'rare',
        rng: this.rng,
        cinematic: true,
        attack: step.enemyAttack,
      });
      e.group.position.z = (i - (count - 1) / 2) * HIGHLIGHTS.waveDepth;
      // The hero starts his move a contact-time early so a slide, vault or
      // dash arrives on the body exactly when the beat says it should.
      //
      // This MUST use the animation's own length, not the commitment window.
      // Strikes play `animScale` times longer than control is locked for, so
      // computing the lead from the commitment made every body die roughly a
      // fifth of a second before the blade reached it — which is precisely what
      // "an animation playing" rather than "a hit landing" looks like.
      const lead = strikeLead(move);
      this.beats.push({
        enemy: e,
        at,
        startAt: Math.max(0, at - lead),
        started: false,
        killed: false,
        choreo: step,
      });
      at += step.gap;
    }
    for (let i = count; i < this.enemies.length; i++) this.enemies[i].retire();

    // The shot is only as long as its choreography needs, so a single kill
    // cuts fast and a five-body wave gets the room it earns. Slow shots also
    // get a longer tail, since the aftermath is the part being savoured.
    const tail = HIGHLIGHTS.tailSeconds * (this.pace < 0.7 ? 1.35 : 1);
    this.duration = this.beats[this.beats.length - 1].at + tail;
    this.shot = SHOTS[m.kind](m.side === 'L' ? -1 : 1);
  }

  /**
   * Starts one beat's move. The reel always uses the choreographed move rather
   * than the character's authored finisher clip: that clip is 2-3 seconds long
   * and reads as a blur when squeezed into a cut, and it already has its moment
   * in live Flow. The scene wants a move it can time to the frame.
   */
  private startMove(m: Moment, beat: Beat): void {
    const lane: Lane = m.side === 'L' ? 'left' : 'right';
    this.player.attack(lane, true, false, beat.choreo.move);
    if (moveById(beat.choreo.move).tags.includes('throw')) this.throwTarget = beat;
  }

  /** Fires the effects a move asks for as it reaches them. */
  private playMoveEvents(m: Moment, dir: number): void {
    for (const ev of this.player.drainEvents()) {
      switch (ev) {
        case 'throw': {
          const target = this.throwTarget;
          const toX = target ? target.enemy.group.position.x : dir * 2;
          this.vfx.blade(this.player.worldX, 1.15, toX, 1.05, BLADE_FLIGHT);
          this.audio.swing();
          // The blade, not the swing, decides when this body goes down.
          if (target) target.at = Math.max(target.at, this.clock + BLADE_FLIGHT);
          break;
        }
        case 'shockwave':
          this.vfx.shockwave(this.player.worldX, 0.35, 3.2, IMPACT_COLOR.finisher);
          this.rig.addTrauma(CAMERA.trauma.finisher);
          break;
        case 'dust':
          this.vfx.dust(this.player.worldX, 1.2);
          break;
        case 'afterimage':
          this.vfx.dashTrail(this.lastHeroX, this.player.worldX, 1);
          break;
      }
    }
    void m;
  }

  private land(m: Moment, beat: Beat, isLast: boolean): void {
    beat.killed = true;
    if (this.throwTarget === beat) this.throwTarget = null;

    const x = beat.enemy.group.position.x;
    const finisher = m.kind === 'finisher' && isLast;
    const heavy = beat.choreo.reaction === 'blowAway' || beat.choreo.reaction === 'slam';

    beat.enemy.kill(
      this.player.worldX,
      finisher ? 1.7 : heavy ? 1.45 : 1.15,
      beat.choreo.reaction,
    );

    const color =
      m.kind === 'rare'
        ? IMPACT_COLOR.rare
        : m.kind === 'finisher'
          ? IMPACT_COLOR.finisher
          : m.kind === 'perfect'
            ? IMPACT_COLOR.perfect
            : IMPACT_COLOR.good;
    const scale = finisher
      ? VFXCFG.slashScale.finisher
      : heavy
        ? VFXCFG.slashScale.perfect
        : VFXCFG.slashScale.good;
    this.vfx.impact(x, 1.1, scale, color);
    if (finisher || m.kind === 'rare' || heavy) {
      this.vfx.shockwave(x, 1.1, finisher ? 3.6 : 2.4, color);
    }

    this.fx.flash(finisher ? VFXCFG.flash.finisher : VFXCFG.flash.perfect);
    // Blows land heavier as the exchange builds, the same way a live combo
    // deepens hit-stop — so the last body in a wave hits hardest.
    const index = this.beats.indexOf(beat);
    const weight = 1 + (index / Math.max(1, this.beats.length - 1)) * (HITSTOP.comboScaleMax - 1);
    this.fx.hitStop((isLast ? HITSTOP.finisher : HITSTOP.good) * weight);
    this.rig.addTrauma(isLast ? CAMERA.trauma.finisher : CAMERA.trauma.perfect);
    this.rig.addImpulse(Math.sign(x || 1), CAMERA.punch.perfect);
    // The body takes the force before it takes flight: a squash along the line
    // of the strike, which is the frame that reads as contact.
    beat.enemy.impactSquash(Math.sign(x || 1), finisher ? 1.35 : heavy ? 1.15 : 0.9);

    if (finisher) this.audio.finisher();
    else if (m.kind === 'rare') this.audio.hitRare();
    else if (heavy) this.audio.hitPerfect();
    else this.audio.hitGood();

    if (!this.captioned) {
      this.captioned = true;
      this.hud.subtitle(captionFor(m));
    }
  }

  private cleanup(): void {
    for (const e of this.enemies) e.retire();
    this.heroX = 0;
    this.throwTarget = null;
    this.desiredTimeScale = 1;
    this.player.reset();
  }
}
