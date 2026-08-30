import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The corner warning shows a plain directional arrow emoji and nothing else -
 * no plate, no instructional text. Requirement: left turn -> ⬅️, right turn
 * -> ➡️, swapped at runtime by `UIManager.updateTurnWarning` from the
 * upcoming corner's actual direction (`PlayerController.pendingTurn`).
 *
 * The turn *logic* itself is untouched by any of this and is covered by
 * `physics.test.ts`.
 */

/** Everything between the turn-warning element's tags, markup and all. */
function turnWarningMarkup(): string {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('id="hud-turn-warning"');
  expect(start, 'index.html has no turn warning element at all').toBeGreaterThan(0);

  // Back up to the element's own opening bracket, then take everything to the
  // closing tag of its container.
  const open = html.lastIndexOf('<', start);
  const end = html.indexOf('</div>', start);
  return html.slice(open, end);
}

describe('the corner warning', () => {
  it('renders only the arrow emoji - no other visible text', () => {
    const markup = turnWarningMarkup();

    // Strip tags and entities, leaving whatever the player would actually read.
    // (aria-label is an attribute, not inner text, so it survives this strip -
    // that's correct: it's accessibility metadata, not an on-screen label.)
    const visible = markup
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z]+;|&#\d+;/gi, ' ')
      .trim();

    expect(visible, `the warning renders the text "${visible}"`).toBe('⬅️');
  });

  it('has a dedicated element UIManager can swap the emoji on', () => {
    const markup = turnWarningMarkup();
    expect(markup).toMatch(/id="hud-turn-arrow"/);
  });

  it('is still an alert, so it reads to a screen reader as danger', () => {
    const markup = turnWarningMarkup();
    expect(markup).toMatch(/role="alert"/);
    expect(markup).toMatch(/aria-label="[^"]+"/);
  });
});
