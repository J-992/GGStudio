import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The façade picks its portal at module-evaluation time from `VITE_PLATFORM`,
 * so every case here has to stub the env before the dynamic import.
 */
async function loadPlatform(
  value?: string,
): Promise<typeof import('../src/app/platform.ts')> {
  vi.resetModules();
  if (value !== undefined) vi.stubEnv('VITE_PLATFORM', value);
  return import('../src/app/platform.ts');
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  // No `window`, so neither SDK can load: every call takes the unavailable
  // path, which is exactly the behaviour the callers depend on.
  vi.stubGlobal('window', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('portal façade', () => {
  it('defaults to CrazyGames when VITE_PLATFORM is unset', async () => {
    const platform = await loadPlatform();
    expect(platform.activePlatformId()).toBe('crazygames');
  });

  it.each([
    ['poki', 'poki'],
    ['  poki  ', 'poki'],
    ['none', 'none'],
    ['crazygames', 'crazygames'],
    ['nonsense', 'crazygames'],
  ])('resolves %j to the %j portal', async (value, expected) => {
    const platform = await loadPlatform(value);
    expect(platform.activePlatformId()).toBe(expected);
  });

  it('routes score submission to CrazyGames and ads to Poki', async () => {
    const crazy = await loadPlatform('crazygames');
    // CrazyGames has the leaderboard but no ad break wired up here.
    expect(crazy.platformHasAds()).toBe(false);
    await expect(crazy.requestPlatformCommercialBreak()).resolves.toBe(false);
    await expect(crazy.reportPlatformHappyTime(1)).resolves.toBe(false);

    const poki = await loadPlatform('poki');
    expect(poki.platformHasAds()).toBe(true);
    // Poki has no score API, so a submission is a no-op rather than an error.
    await expect(poki.submitPlatformScore(1_000)).resolves.toBe(false);
  });

  it('is inert on the no-portal build', async () => {
    const platform = await loadPlatform('none');
    const muteListener = vi.fn();

    expect(platform.platformHasAds()).toBe(false);
    const unsubscribe = platform.subscribePlatformAudioMute(muteListener);
    expect(muteListener).toHaveBeenCalledExactlyOnceWith(false);
    unsubscribe();

    expect(() => platform.setPlatformGameplayActive(true)).not.toThrow();
    await expect(platform.initPlatformForBoot()).resolves.toBe(false);
    await expect(platform.startPlatformLoading()).resolves.toBe(false);
    await expect(platform.stopPlatformLoading()).resolves.toBe(false);
    await expect(platform.submitPlatformScore(5)).resolves.toBe(false);
    await expect(platform.requestPlatformCommercialBreak()).resolves.toBe(
      false,
    );
    await expect(platform.reportPlatformHappyTime(0.5)).resolves.toBe(false);
  });

  it('survives every call with no SDK present on either portal', async () => {
    for (const id of ['crazygames', 'poki']) {
      const platform = await loadPlatform(id);
      const muteListener = vi.fn();
      platform.subscribePlatformAudioMute(muteListener);
      expect(muteListener).toHaveBeenLastCalledWith(false);
      platform.setPlatformGameplayActive(true);
      platform.setPlatformGameplayActive(false);
      await expect(platform.initPlatformForBoot()).resolves.toBe(false);
      await expect(platform.startPlatformLoading()).resolves.toBe(false);
      await expect(platform.submitPlatformScore(42)).resolves.toBe(false);
      await expect(platform.requestPlatformCommercialBreak()).resolves.toBe(
        false,
      );
    }
  });
});
