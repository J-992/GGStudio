import { describe, expect, it } from 'vitest';
import { AdCadence } from '../platform/AdCadence';

describe('session ad cadence', () => {
  it('never interrupts retries in the first three active minutes', () => {
    const cadence = new AdCadence();
    cadence.addActiveSeconds(179);
    expect(cadence.consumeBreakDue()).toBe(false);
  });

  it('allows one break after three active minutes and spaces later breaks', () => {
    const cadence = new AdCadence();
    cadence.addActiveSeconds(180);
    expect(cadence.consumeBreakDue()).toBe(true);
    expect(cadence.consumeBreakDue()).toBe(false);
    cadence.addActiveSeconds(179);
    expect(cadence.consumeBreakDue()).toBe(false);
    cadence.addActiveSeconds(1);
    expect(cadence.consumeBreakDue()).toBe(true);
  });
});
