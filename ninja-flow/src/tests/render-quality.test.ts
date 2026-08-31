import { describe, expect, it } from 'vitest';
import { FrameQuality } from '../core/FrameQuality';

describe('adaptive frame quality', () => {
  it('starts below the expensive 2x DPR path even on a dense display', () => {
    const quality = new FrameQuality(3);
    expect(quality.profile.pixelRatio).toBeLessThanOrEqual(1.5);
    expect(quality.profile.shadowMapSize).toBeLessThanOrEqual(512);
  });

  it('drops expensive effects after sustained low frame rate, not one spike', () => {
    const quality = new FrameQuality(2);
    quality.sample(0.05);
    expect(quality.profile.name).toBe('high');

    for (let i = 0; i < 5 * 30; i += 1) quality.sample(1 / 30);

    expect(quality.profile.name).toBe('low');
    expect(quality.profile.pixelRatio).toBe(1);
    expect(quality.profile.shadows).toBe(false);
    expect(quality.profile.ambientStride).toBeGreaterThan(1);
  });

  it('recovers quality only after a long stable 60 FPS period', () => {
    const quality = new FrameQuality(2);
    for (let i = 0; i < 5 * 30; i += 1) quality.sample(1 / 30);
    expect(quality.profile.name).toBe('low');

    for (let i = 0; i < 30 * 60; i += 1) quality.sample(1 / 60);
    expect(quality.profile.name).toBe('high');
  });
});
