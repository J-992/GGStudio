import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { TUTORIAL } from '../config';
import { Rng } from '../core/Rng';
import { CombatDirector } from '../game/CombatDirector';
import { flowInstruction, perfectInstruction } from '../game/TutorialPrompts';
import { HUD } from '../ui/HUD';
import { MainMenu } from '../ui/MainMenu';

describe('current tutorial and help', () => {
  it('gives the exact Perfect cue a visually distinct tap-now state', () => {
    const parent = document.createElement('div');
    const hud = new HUD(parent, () => undefined, () => undefined);

    hud.setHint('left', '← NOW', true);

    const left = parent.querySelector<HTMLElement>('[data-lane="left"]');
    const right = parent.querySelector<HTMLElement>('[data-lane="right"]');
    expect(left?.classList.contains('hint')).toBe(true);
    expect(left?.classList.contains('perfect')).toBe(true);
    expect(left?.textContent).toContain('NOW');
    expect(right?.classList.contains('hint')).toBe(false);
  });

  it('gives first-time players a slower, longer practice sequence', () => {
    expect(TUTORIAL.safeThreats).toBeGreaterThanOrEqual(8);
    expect(TUTORIAL.slowFactor).toBeGreaterThanOrEqual(2);
  });

  it('states the exact control required for Perfect and Flow', () => {
    expect(perfectInstruction('left', false, 'tap')).toContain('PRESS ← NOW FOR PERFECT');
    expect(perfectInstruction('right', true, 'tap')).toContain('TAP RIGHT NOW FOR PERFECT');
    expect(flowInstruction('left', false)).toContain('PRESS ← NOW');
    expect(flowInstruction('right', true)).toContain('TAP RIGHT NOW');
    expect(flowInstruction('right', true)).toContain('GLOWING');
  });

  it('documents timing, guards, rare targets, Flow, gear, and the highlight reel', () => {
    const parent = document.createElement('div');
    new MainMenu(parent);
    const help = parent.querySelector('.menu__help')?.textContent ?? '';

    for (const feature of ['last-second counter', 'plate', 'Gold enemies', 'Flow', 'Gear', 'highlight reel']) {
      expect(help).toContain(feature);
    }
  });

  it('keeps score-bearing advanced mechanics out until the lesson is complete', () => {
    const director = new CombatDirector(new Scene(), new Rng(9));
    director.reset(0);
    for (let i = 0; i < TUTORIAL.safeThreats; i += 1) director.consumeTutorialThreat();

    const dt = 1 / 60;
    let now = 0;
    while (now < 100) {
      now += dt;
      director.update(dt, now, now, false);
      for (const enemy of director.liveThreats) {
        if (!enemy.isThreat) continue;
        expect(enemy.feint).toBe(false);
        expect(enemy.guarded).toBe(false);
        expect(enemy.rare).toBe(false);
        if (now >= enemy.impactAt) enemy.kill(0, 1);
      }
    }
  });
});
