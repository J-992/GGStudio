import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Catnip Rush's screen effect: radial comic-style speed streaks that
 * emanate from the screen edges toward the centre, semi-transparent, and
 * masked so the centre of the screen - where obstacles/fish/turns actually
 * are - stays clear. Driven entirely by `--speedlines-intensity`
 * (`UIManager.updateSpeedLines`), so it is only ever visible while Catnip
 * Rush is active and fades cleanly as the power-up's `remainingFrac` runs
 * out.
 */

function mainCss(): string {
  return readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');
}

function hudMarkup(): string {
  return readFileSync(new URL('../index.html', import.meta.url), 'utf8');
}

describe('Catnip Rush speed lines', () => {
  it('the HUD has a dedicated, hidden-by-default speed-lines layer', () => {
    const html = hudMarkup();
    expect(html).toMatch(/id="hud-speedlines"/);
  });

  it('draws radiating spokes rather than a flat edge gradient', () => {
    // repeating-conic-gradient is what actually produces straight lines
    // radiating from a single centre point - a repeating-linear-gradient
    // (the old design) cannot converge on a point at all.
    const css = mainCss();
    expect(css).toMatch(/\.hud-speedlines\s*\{[^}]*repeating-conic-gradient/s);
  });

  it('masks the centre of the screen clear so gameplay stays visible', () => {
    const css = mainCss();
    expect(css).toMatch(/\.hud-speedlines\s*\{[^}]*mask-image:\s*radial-gradient/s);
  });

  it('is invisible until Catnip Rush drives --speedlines-intensity above 0', () => {
    const css = mainCss();
    expect(css).toMatch(/--speedlines-intensity:\s*0/);
    expect(css).toMatch(/opacity:\s*var\(--speedlines-intensity\)/);
  });

  it('respects reduced motion by dropping the drift animation', () => {
    const css = mainCss();
    const reducedBlock = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(reducedBlock, 'no reduced-motion media block found').not.toBeNull();
    expect(reducedBlock![1]).toMatch(/\.hud-speedlines\s*\{[^}]*animation:\s*none/s);
  });
});
