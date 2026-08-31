import { describe, expect, it } from 'vitest';
import { HUD } from '../ui/HUD';
import { MainMenu } from '../ui/MainMenu';

describe('current tutorial and help', () => {
  it('shows the approaching threat direction without revealing the exact Perfect frame', () => {
    const parent = document.createElement('div');
    const hud = new HUD(parent, () => undefined, () => undefined);

    hud.setHint('left', '←');

    const left = parent.querySelector<HTMLElement>('[data-lane="left"]');
    const right = parent.querySelector<HTMLElement>('[data-lane="right"]');
    expect(left?.classList.contains('hint')).toBe(true);
    expect(left?.classList.contains('perfect')).toBe(false);
    expect(left?.textContent).toContain('←');
    expect(right?.classList.contains('hint')).toBe(false);
  });

  it('documents timing, guards, rare targets, Flow, gear, and the highlight reel', () => {
    const parent = document.createElement('div');
    new MainMenu(parent);
    const help = parent.querySelector('.menu__help')?.textContent ?? '';

    for (const feature of ['last-second counter', 'plate', 'Gold enemies', 'Flow', 'Gear', 'highlight reel']) {
      expect(help).toContain(feature);
    }
  });
});
