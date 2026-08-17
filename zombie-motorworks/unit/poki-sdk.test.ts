import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeScript {
  async: boolean;
  onerror: (() => void) | null;
  onload: (() => void) | null;
  src: string;
}

interface StubSdkOptions {
  init?: () => Promise<unknown>;
  setDebug?: (debug: boolean) => void;
  gameLoadingStart?: () => void;
  gameLoadingFinished?: () => void;
  gameplayStart?: () => void;
  gameplayStop?: () => void;
  commercialBreak?: (beforeAd?: () => void) => Promise<unknown>;
  happyTime?: (intensity: number) => void;
}

/**
 * Stands in for Poki's CDN. The SDK only appears on `window` once the injected
 * script "loads", which is the ordering the wrapper has to survive.
 */
function installSdkEnvironment(options: StubSdkOptions): {
  appendedScripts: FakeScript[];
} {
  const appendedScripts: FakeScript[] = [];
  const sdk = { init: vi.fn().mockResolvedValue(undefined), ...options };
  const fakeWindow: { PokiSDK?: typeof sdk } = {};
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', {
    createElement: () => ({
      async: false,
      onerror: null,
      onload: null,
      src: '',
    }),
    documentElement: null,
    head: {
      appendChild(script: FakeScript) {
        appendedScripts.push(script);
        queueMicrotask(() => {
          fakeWindow.PokiSDK = sdk;
          script.onload?.();
        });
        return script;
      },
    },
  });
  return { appendedScripts };
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Poki SDK wrapper', () => {
  it('resolves false without throwing when Poki never loads', async () => {
    const { initPoki, pokiCommercialBreak, pokiHappyTime } =
      await import('../src/app/pokiSdk.ts');

    await expect(initPoki()).resolves.toBe(false);
    await expect(pokiCommercialBreak()).resolves.toBe(false);
    await expect(pokiHappyTime(1)).resolves.toBe(false);
  });

  it('shares initialization and injects the SDK script only once', async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const { appendedScripts } = installSdkEnvironment({ init });
    const { initPoki, isPokiAvailable } = await import('../src/app/pokiSdk.ts');

    expect(isPokiAvailable()).toBe(false);
    const first = initPoki();
    const second = initPoki();

    expect(second).toBe(first);
    await expect(first).resolves.toBe(true);
    expect(isPokiAvailable()).toBe(true);
    await expect(initPoki()).resolves.toBe(true);
    expect(appendedScripts).toHaveLength(1);
    expect(appendedScripts[0]?.src).toContain('poki-sdk.js');
    expect(init).toHaveBeenCalledOnce();
  });

  it('stays available when init rejects, which is what an ad blocker does', async () => {
    const gameplayStart = vi.fn();
    installSdkEnvironment({
      init: vi.fn().mockRejectedValue(new Error('adblock')),
      gameplayStart,
    });
    const sdk = await import('../src/app/pokiSdk.ts');

    await expect(sdk.initPoki()).resolves.toBe(true);
    expect(sdk.isPokiAvailable()).toBe(true);
    sdk.setPokiGameplayActive(true);
    await vi.waitFor(() => expect(gameplayStart).toHaveBeenCalledOnce());
  });

  it('brackets loading once and coalesces gameplay reports', async () => {
    const gameLoadingStart = vi.fn();
    const gameLoadingFinished = vi.fn();
    const gameplayStart = vi.fn();
    const gameplayStop = vi.fn();
    installSdkEnvironment({
      gameLoadingStart,
      gameLoadingFinished,
      gameplayStart,
      gameplayStop,
    });
    const sdk = await import('../src/app/pokiSdk.ts');

    expect(await sdk.startPokiLoading()).toBe(true);
    expect(await sdk.startPokiLoading()).toBe(false);
    expect(await sdk.stopPokiLoading()).toBe(true);
    expect(await sdk.stopPokiLoading()).toBe(false);
    expect(gameLoadingStart).toHaveBeenCalledOnce();
    expect(gameLoadingFinished).toHaveBeenCalledOnce();

    sdk.setPokiGameplayActive(true);
    await vi.waitFor(() => expect(gameplayStart).toHaveBeenCalledOnce());
    sdk.setPokiGameplayActive(true);
    await Promise.resolve();
    expect(gameplayStart).toHaveBeenCalledOnce();
    sdk.setPokiGameplayActive(false);
    await vi.waitFor(() => expect(gameplayStop).toHaveBeenCalledOnce());
  });

  it('mutes for the length of a commercial break and shares one in flight', async () => {
    let releaseAd: (() => void) | undefined;
    const commercialBreak = vi.fn((beforeAd?: () => void) => {
      beforeAd?.();
      return new Promise<void>((resolve) => {
        releaseAd = resolve;
      });
    });
    installSdkEnvironment({ commercialBreak });
    const sdk = await import('../src/app/pokiSdk.ts');
    const muteListener = vi.fn();
    sdk.subscribePokiAudioMute(muteListener);
    expect(muteListener).toHaveBeenLastCalledWith(false);

    const first = sdk.pokiCommercialBreak();
    const second = sdk.pokiCommercialBreak();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(muteListener).toHaveBeenLastCalledWith(true));

    releaseAd?.();
    await expect(first).resolves.toBe(true);
    expect(muteListener).toHaveBeenLastCalledWith(false);
    expect(commercialBreak).toHaveBeenCalledOnce();
  });

  it('unmutes and resolves false when the ad call throws', async () => {
    const commercialBreak = vi.fn((beforeAd?: () => void) => {
      beforeAd?.();
      throw new Error('ad server down');
    });
    installSdkEnvironment({
      commercialBreak: commercialBreak as unknown as () => Promise<unknown>,
    });
    const sdk = await import('../src/app/pokiSdk.ts');
    const muteListener = vi.fn();
    sdk.subscribePokiAudioMute(muteListener);

    await expect(sdk.pokiCommercialBreak()).resolves.toBe(false);
    expect(muteListener).toHaveBeenLastCalledWith(false);
  });

  it('fires no SDK event while an ad is on screen, and flushes after', async () => {
    // Poki's checklist forbids any event during a midroll, and forbids the
    // same event twice in succession. Both are asserted against one call log.
    const calls: string[] = [];
    let releaseAd: (() => void) | undefined;
    installSdkEnvironment({
      gameplayStart: () => calls.push('start'),
      gameplayStop: () => calls.push('stop'),
      happyTime: () => calls.push('happy'),
      commercialBreak: (beforeAd?: () => void) => {
        calls.push('ad');
        beforeAd?.();
        return new Promise<void>((resolve) => {
          releaseAd = resolve;
        });
      },
    });
    const sdk = await import('../src/app/pokiSdk.ts');

    // In a menu: gameplay already stopped, which is where an ad is allowed.
    sdk.setPokiGameplayActive(false);
    await vi.waitFor(() => expect(sdk.isPokiAvailable()).toBe(true));

    const ad = sdk.pokiCommercialBreak();
    await vi.waitFor(() => expect(calls).toContain('ad'));

    // The game heads back into gameplay while the ad is still up.
    sdk.setPokiGameplayActive(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(await sdk.pokiHappyTime(1)).toBe(false);
    expect(calls).toEqual(['ad']);

    releaseAd?.();
    await ad;
    await vi.waitFor(() => expect(calls).toEqual(['ad', 'start']));
  });

  it('never repeats a gameplay event in succession', async () => {
    const calls: string[] = [];
    installSdkEnvironment({
      gameplayStart: () => calls.push('start'),
      gameplayStop: () => calls.push('stop'),
    });
    const sdk = await import('../src/app/pokiSdk.ts');

    for (const active of [true, true, true, false, false, true, false]) {
      sdk.setPokiGameplayActive(active);
      await vi.waitFor(() => expect(sdk.isPokiAvailable()).toBe(true));
      await Promise.resolve();
    }
    await vi.waitFor(() => expect(calls.at(-1)).toBe('stop'));

    expect(calls).toEqual(['start', 'stop', 'start', 'stop']);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]).not.toBe(calls[i - 1]);
    }
  });

  it('clamps happy time into the range Poki accepts', async () => {
    const happyTime = vi.fn();
    installSdkEnvironment({ happyTime });
    const sdk = await import('../src/app/pokiSdk.ts');

    await expect(sdk.pokiHappyTime(4)).resolves.toBe(true);
    await expect(sdk.pokiHappyTime(-1)).resolves.toBe(true);
    await expect(sdk.pokiHappyTime(Number.NaN)).resolves.toBe(false);
    expect(happyTime.mock.calls.map((call) => call[0])).toEqual([1, 0]);
  });

  it('boots after the watchdog without cancelling late initialization', async () => {
    vi.useFakeTimers();
    let releaseInit: (() => void) | undefined;
    const init = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseInit = resolve;
        }),
    );
    installSdkEnvironment({ init });
    const sdk = await import('../src/app/pokiSdk.ts');

    const bootAttempt = sdk.initPokiForBoot();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(bootAttempt).resolves.toBe(false);

    releaseInit?.();
    await expect(sdk.initPoki()).resolves.toBe(true);
    expect(sdk.isPokiAvailable()).toBe(true);
  });

  it('retries initialization after a failed script load', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const appendedScripts: FakeScript[] = [];
    let failNextLoad = true;
    const sdkStub = { init: vi.fn().mockResolvedValue(undefined) };
    const fakeWindow: { PokiSDK?: typeof sdkStub } = {};
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('document', {
      createElement: () => ({
        async: false,
        onerror: null,
        onload: null,
        src: '',
      }),
      documentElement: null,
      head: {
        appendChild(script: FakeScript) {
          appendedScripts.push(script);
          const shouldFail = failNextLoad;
          failNextLoad = false;
          queueMicrotask(() => {
            if (shouldFail) {
              script.onerror?.();
              return;
            }
            fakeWindow.PokiSDK = sdkStub;
            script.onload?.();
          });
          return script;
        },
      },
    });
    const { initPoki } = await import('../src/app/pokiSdk.ts');

    await expect(initPoki()).resolves.toBe(false);
    // Inside the cooldown the wrapper does not touch the network again.
    await expect(initPoki()).resolves.toBe(false);
    expect(appendedScripts).toHaveLength(1);

    vi.setSystemTime(4_000);
    await expect(initPoki()).resolves.toBe(true);
    expect(appendedScripts).toHaveLength(2);
  });
});
