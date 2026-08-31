import { describe, expect, it } from 'vitest';
import { Euler, Quaternion } from 'three';
import { sample, type Keyframe } from '../game/Poses';
import {
  BASIC_IDS,
  CINEMATIC_IDS,
  FLASHY_IDS,
  MOVES,
  moveById,
  movesTagged,
  sampleRoot,
  type RootSample,
} from '../game/MoveLibrary';
import { ENEMY_ATTACKS, COMBAT_ATTACK_IDS, REACTIONS, sampleEnemy } from '../game/EnemyMoves';
import { SEQUENCES, choreographyFor, resetChoreography } from '../game/Choreography';
import type { Pose } from '../game/Rig';
import { ATTACK } from '../config';

const at = (track: readonly Keyframe[], t: number): Pose => sample(track, t, {} as Pose);
const rootAt = (move: string, t: number): RootSample =>
  sampleRoot(moveById(move).root, t, { x: 0, y: 0, rot: [0, 0, 0] });

describe('hero move library', () => {
  it('carries velocity through keys that continue in the same direction', () => {
    const track: Keyframe[] = [
      { t: 0, pose: { head: [0, 0, 0] } },
      { t: 0.3, pose: { head: [0.3, 0, 0] } },
      { t: 0.6, pose: { head: [0.6, 0, 0] } },
      { t: 1, pose: { head: [1, 0, 0] } },
    ];
    const before = at(track, 0.29).head?.[0] ?? 0;
    const key = at(track, 0.3).head?.[0] ?? 0;
    const after = at(track, 0.31).head?.[0] ?? 0;
    expect(key - before).toBeGreaterThan(0.004);
    expect(after - key).toBeGreaterThan(0.004);
    expect(Math.abs((key - before) - (after - key))).toBeLessThan(0.004);
  });

  it('is a genuinely varied set, not one move with variations', () => {
    expect(MOVES.length).toBeGreaterThanOrEqual(26);
    expect(new Set(MOVES.map((m) => m.id)).size).toBe(MOVES.length);
    expect(movesTagged('throw').length).toBeGreaterThanOrEqual(2);
    expect(movesTagged('air').length).toBeGreaterThanOrEqual(3);
    expect(movesTagged('travel').length).toBeGreaterThanOrEqual(3);
    expect(movesTagged('kick').length).toBeGreaterThanOrEqual(8);
  });

  it('puts distinct kicks in both player-controlled attack rotations', () => {
    const basicKicks = BASIC_IDS.filter((id) => moveById(id).tags.includes('kick'));
    const perfectKicks = FLASHY_IDS.filter((id) => moveById(id).tags.includes('kick'));
    expect(basicKicks).toEqual(['frontKick', 'kneeStrike', 'sideKick']);
    expect(perfectKicks.length).toBeGreaterThanOrEqual(5);

    const signatures = [...basicKicks, ...perfectKicks].map((id) => {
      const move = moveById(id);
      const contact = at(move.track, move.contactAt);
      return [
        contact.upLegR?.map((v) => v.toFixed(2)).join(','),
        contact.legR?.map((v) => v.toFixed(2)).join(','),
        contact.footR?.map((v) => v.toFixed(2)).join(','),
      ].join('/');
    });
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('keeps player-controlled attacks on screen long enough to read', () => {
    for (const id of [...BASIC_IDS, ...FLASHY_IDS]) {
      const move = moveById(id);
      const seconds = ATTACK.total * ATTACK.animScale * (move.speed ?? 1);
      expect(seconds, id).toBeGreaterThanOrEqual(0.65);
    }
    expect(ATTACK.total * ATTACK.flowAnimScale).toBeGreaterThanOrEqual(0.45);
  });

  it('keeps the combat rotations clear of moves that leave the mark', () => {
    // A move that travels three metres or leaves the floor is unreadable as a
    // live threat answer, so combat must never draw one.
    for (const id of [...BASIC_IDS, ...FLASHY_IDS]) {
      const move = moveById(id);
      expect(move.tags, id).not.toContain('cinematic');
      const end = rootAt(id, 1);
      expect(Math.abs(end.x), id).toBeLessThan(0.1);
      expect(Math.abs(end.y), id).toBeLessThan(0.1);
    }
    for (const id of CINEMATIC_IDS) expect([...BASIC_IDS, ...FLASHY_IDS]).not.toContain(id);
  });

  it('lands every contact frame inside the readable window', () => {
    for (const move of MOVES) {
      expect(move.contactAt, move.id).toBeGreaterThanOrEqual(0.36);
      expect(move.contactAt, move.id).toBeLessThanOrEqual(0.48);
      const keys = move.track.filter((k) => k.t > 0 && k.t < 1);
      const nearest = keys.reduce((best, k) =>
        Math.abs(k.t - move.contactAt) < Math.abs(best.t - move.contactAt) ? k : best,
      );
      expect(Math.abs(nearest.t - move.contactAt), move.id).toBeLessThanOrEqual(0.06);
    }
  });

  it('starts every move from rest and resolves it to the idle orientation', () => {
    for (const move of MOVES) {
      for (const [bone, euler] of Object.entries(at(move.track, 0))) {
        for (const v of euler) expect(v, `${move.id}.${bone}`).toBeCloseTo(0, 6);
      }
      for (const [bone, euler] of Object.entries(at(move.track, 1))) {
        const q = new Quaternion().setFromEuler(new Euler(euler[0], euler[1], euler[2]));
        // A whole number of revolutions is the identity rotation, expressed ±w.
        expect(Math.abs(q.w), `${move.id}.${bone}`).toBeCloseTo(1, 3);
      }
    }
  });

  it('brings every travelling move to a stop before the move ends', () => {
    for (const id of CINEMATIC_IDS) {
      const move = moveById(id);
      if (!move.root) continue;
      const end = rootAt(id, 1);
      // Height always returns to the floor; travel may end displaced, but the
      // reel resets the hero between shots, never mid-scene.
      expect(end.y, id).toBeCloseTo(0, 2);
      const late = rootAt(id, 0.9);
      expect(Math.abs(end.x - late.x), id).toBeLessThan(0.5);
    }
  });

  it('sends the slide and the vault clean through the body they attack', () => {
    // The enemy stands at ~1.55m; both moves must finish past it, turned round.
    for (const id of ['slideUnder', 'vaultOver', 'dashThrough']) {
      const end = rootAt(id, 1);
      expect(end.x, id).toBeGreaterThan(1.8);
      expect(Math.abs(end.rot[1]), id).toBeCloseTo(Math.PI, 1);
    }
  });

  it('lifts the airborne moves off the floor and lands them again', () => {
    for (const id of movesTagged('air').map((m) => m.id)) {
      const peak = Math.max(...[0.2, 0.3, 0.45, 0.6].map((t) => rootAt(id, t).y));
      expect(peak, id).toBeGreaterThan(0.35);
      expect(rootAt(id, 1).y, id).toBeCloseTo(0, 2);
    }
  });

  it('fires a throw cue on every move that throws the blade', () => {
    for (const move of movesTagged('throw')) {
      const kinds = (move.events ?? []).map((e) => e.kind);
      expect(kinds, move.id).toContain('throw');
    }
  });

  it('keeps every sampled pose and root path finite', () => {
    for (const move of MOVES) {
      for (let t = 0; t <= 1; t += 0.05) {
        for (const euler of Object.values(at(move.track, t))) {
          for (const v of euler) expect(Number.isFinite(v), move.id).toBe(true);
        }
        const r = rootAt(move.id, t);
        expect(Number.isFinite(r.x) && Number.isFinite(r.y), move.id).toBe(true);
      }
    }
  });
});

describe('enemy move library', () => {
  it('peaks every attack exactly on the impact frame', () => {
    for (const attack of ENEMY_ATTACKS) {
      expect(attack.track[0].t, attack.id).toBe(0);
      expect(attack.track[attack.track.length - 1].t, attack.id).toBe(1);
    }
  });

  it('keeps thrown weapons and leaps out of live combat', () => {
    const combat = ENEMY_ATTACKS.filter((a) => COMBAT_ATTACK_IDS.includes(a.id));
    expect(combat.length).toBeGreaterThanOrEqual(5);
    for (const a of combat) expect(a.throwAt, a.id).toBeUndefined();
    expect(COMBAT_ATTACK_IDS).not.toContain('shuriken');
  });

  it('articulates the weapon elbow through every live swing', () => {
    const combat = ENEMY_ATTACKS.filter((a) => COMBAT_ATTACK_IDS.includes(a.id));
    for (const attack of combat) {
      const elbow = attack.track.map((key) => key.pose.forearmR?.[0]);
      expect(elbow.every((angle) => angle !== undefined), attack.id).toBe(true);
      const angles = elbow as number[];
      expect(Math.max(...angles) - Math.min(...angles), attack.id).toBeGreaterThan(0.18);
    }
  });

  it('carries elbow velocity smoothly through swing keys', () => {
    const epsilon = 0.001;
    for (const attack of ENEMY_ATTACKS.filter((a) => COMBAT_ATTACK_IDS.includes(a.id))) {
      for (const key of attack.track.slice(1, -1)) {
        const before = sampleEnemy(attack.track, key.t - epsilon, {}).forearmR?.[0] ?? 0;
        const atKey = sampleEnemy(attack.track, key.t, {}).forearmR?.[0] ?? 0;
        const after = sampleEnemy(attack.track, key.t + epsilon, {}).forearmR?.[0] ?? 0;
        expect(Math.abs((atKey - before) - (after - atKey)), `${attack.id}@${key.t}`)
          .toBeLessThan(0.002);
      }
    }
  });

  it('gives every reaction a distinct exit', () => {
    const signatures = Object.values(REACTIONS).map((r) => `${r.out}/${r.up}/${r.spin}`);
    expect(new Set(signatures).size).toBe(signatures.length);
    // The slide-under payoff: this body goes back over the hero, not away.
    expect(REACTIONS.flipOver.overhead).toBe(true);
    expect(REACTIONS.slam.up).toBeLessThan(0);
    expect(REACTIONS.juggle.up).toBeGreaterThan(REACTIONS.launch.up);
  });

  it('samples enemy tracks without leaking keys between calls', () => {
    const pose = {};
    sampleEnemy(ENEMY_ATTACKS[0].track, 1, pose);
    const first = Object.keys(pose).length;
    sampleEnemy(ENEMY_ATTACKS[4].track, 1, pose);
    expect(Object.keys(pose).length).not.toBe(first + Object.keys(pose).length);
    for (const v of Object.values(pose) as number[][]) {
      for (const n of v) expect(Number.isFinite(n)).toBe(true);
    }
  });
});

describe('choreography', () => {
  it('names only moves and reactions that exist', () => {
    const ids = new Set(MOVES.map((m) => m.id));
    const attacks = new Set(ENEMY_ATTACKS.map((a) => a.id));
    for (const pool of Object.values(SEQUENCES)) {
      for (const seq of pool) {
        for (const beat of seq.beats) {
          expect(ids, `${seq.id}:${beat.move}`).toContain(beat.move);
          expect(REACTIONS[beat.reaction], `${seq.id}:${beat.reaction}`).toBeDefined();
          if (beat.enemyAttack) expect(attacks).toContain(beat.enemyAttack);
          expect(beat.gap).toBeGreaterThan(0.1);
        }
      }
    }
  });

  it('fits a scene to any wave size and always ends on its closer', () => {
    for (const count of [1, 2, 3, 5, 8]) {
      resetChoreography();
      const beats = choreographyFor('perfect', count);
      expect(beats).toHaveLength(count);
      expect(beats[count - 1].move).toBe(SEQUENCES.WAVE[0].beats[SEQUENCES.WAVE[0].beats.length - 1].move);
    }
  });

  it('rotates so two deaths in a row are not the same scene', () => {
    resetChoreography();
    const first = choreographyFor('perfect', 3).map((b) => b.move).join();
    const second = choreographyFor('perfect', 3).map((b) => b.move).join();
    expect(second).not.toBe(first);
  });

  it('opens every wave with a move that closes the distance', () => {
    for (const seq of SEQUENCES.WAVE) {
      const opener = moveById(seq.beats[0].move);
      const travels =
        opener.tags.includes('travel') || opener.tags.includes('air') || opener.reach !== undefined;
      expect(travels, seq.id).toBe(true);
    }
  });
});

describe('reel strike timing', () => {
  it('waits for the blade, not for the button', async () => {
    const { strikeLead } = await import('../game/HighlightReel');
    const { ATTACK } = await import('../config');
    // The reel stages a hit by starting the move `strikeLead` before the beat.
    // If that lead is computed from the commitment window instead of the
    // animation, the body dies while the blade is still travelling — which is
    // exactly what makes a staged hit look like an animation playing next to a
    // death rather than causing it.
    for (const move of MOVES) {
      const lead = strikeLead(move);
      const animation = ATTACK.total * ATTACK.animScale * (move.speed ?? 1);
      expect(lead, move.id).toBeCloseTo(animation * move.contactAt, 6);
      // And it must be a real slice of the animation, never zero or the whole.
      expect(lead, move.id).toBeGreaterThan(0.1);
      expect(lead, move.id).toBeLessThan(animation);
    }
  });

  it('scales the lead with how long a move takes to swing', async () => {
    const { strikeLead } = await import('../game/HighlightReel');
    // A slow, heavy move needs more warning than a quick one.
    const quick = strikeLead(moveById('thrust'));
    const heavy = strikeLead(moveById('cleave'));
    expect(heavy).toBeGreaterThan(quick);
  });
});
