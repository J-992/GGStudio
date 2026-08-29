import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { PlatformAdapter, MEASURE } from '../platform/PlatformAdapter';

/**
 * Poki rejects invalid event sequences, so these tests pin the state machine
 * rather than the SDK. The adapter must also behave identically when no SDK
 * exists at all, which is the local-dev and ad-blocker case.
 */

type Calls = string[];

function fakeSDK(calls: Calls) {
  return {
    init: vi.fn(async () => {
      calls.push('init');
    }),
    gameLoadingFinished: vi.fn(() => calls.push('loadingFinished')),
    gameplayStart: vi.fn(() => calls.push('gameplayStart')),
    gameplayStop: vi.fn(() => calls.push('gameplayStop')),
    commercialBreak: vi.fn(async () => {
      calls.push('commercialBreak');
    }),
    rewardedBreak: vi.fn(async () => {
      calls.push('rewardedBreak');
      return true;
    }),
    customEvent: vi.fn((c: string, a: string) => calls.push(`event:${c}/${a}`)),
    setDebug: vi.fn(),
  };
}

describe('PlatformAdapter without an SDK', () => {
  let adapter: PlatformAdapter;

  beforeEach(async () => {
    delete (window as { PokiSDK?: unknown }).PokiSDK;
    // Block the CDN fetch so init resolves down the "no SDK" path immediately.
    vi.spyOn(document.head, 'appendChild').mockImplementation(((node: HTMLScriptElement) => {
      queueMicrotask(() => node.onerror?.(new Event('error')));
      return node;
    }) as never);
    adapter = new PlatformAdapter({ ads: true });
    await adapter.init();
  });

  afterEach(() => vi.restoreAllMocks());

  it('initialises successfully with no SDK present', () => {
    expect(adapter.initialised).toBe(true);
    expect(adapter.hasSDK).toBe(false);
  });

  it('never throws on any platform call', async () => {
    expect(() => adapter.gameLoadingFinished()).not.toThrow();
    expect(() => adapter.gameplayStart()).not.toThrow();
    expect(() => adapter.gameplayStop()).not.toThrow();
    expect(() => adapter.measure('run', '30-sec-reached')).not.toThrow();
    await expect(adapter.commercialBreak()).resolves.toBeUndefined();
    await expect(adapter.rewardedBreak()).resolves.toBe(false);
  });

  it('still tracks gameplay state so the game logic behaves the same', () => {
    adapter.gameplayStart();
    expect(adapter.isGameplayActive).toBe(true);
    adapter.gameplayStop();
    expect(adapter.isGameplayActive).toBe(false);
  });
});

describe('PlatformAdapter event sequencing', () => {
  let calls: Calls;
  let adapter: PlatformAdapter;

  beforeEach(async () => {
    calls = [];
    (window as { PokiSDK?: unknown }).PokiSDK = fakeSDK(calls);
    adapter = new PlatformAdapter({ ads: true });
    await adapter.init();
  });

  afterEach(() => {
    delete (window as { PokiSDK?: unknown }).PokiSDK;
  });

  it('fires gameLoadingFinished exactly once', () => {
    adapter.gameLoadingFinished();
    adapter.gameLoadingFinished();
    expect(calls.filter((c) => c === 'loadingFinished')).toHaveLength(1);
  });

  it('never emits gameplayStart twice without a stop between', () => {
    adapter.gameplayStart();
    adapter.gameplayStart();
    adapter.gameplayStart();
    expect(calls.filter((c) => c === 'gameplayStart')).toHaveLength(1);
  });

  it('never emits gameplayStop twice without a start between', () => {
    adapter.gameplayStart();
    adapter.gameplayStop();
    adapter.gameplayStop();
    expect(calls.filter((c) => c === 'gameplayStop')).toHaveLength(1);
  });

  it('drops a stop that was never preceded by a start', () => {
    adapter.gameplayStop();
    expect(calls).not.toContain('gameplayStop');
  });

  it('produces a valid alternating sequence over many runs', () => {
    for (let i = 0; i < 25; i++) {
      adapter.gameplayStart();
      adapter.gameplayStart();
      adapter.gameplayStop();
      adapter.gameplayStop();
    }
    const seq = calls.filter((c) => c.startsWith('gameplay'));
    expect(seq).toHaveLength(50);
    for (let i = 0; i < seq.length; i++) {
      expect(seq[i]).toBe(i % 2 === 0 ? 'gameplayStart' : 'gameplayStop');
    }
  });

  it('signals ad state around a commercial break', async () => {
    const seen: string[] = [];
    adapter.onAdState((s) => seen.push(s));
    await adapter.commercialBreak();
    expect(seen).toEqual(['playing', 'none']);
    expect(adapter.isAdPlaying).toBe(false);
  });

  it('requests no break at all while ads are switched off', async () => {
    // The playtest switch must remove the interstitial without disturbing any
    // other part of the integration.
    const off = new PlatformAdapter({ ads: false });
    await off.init();
    const seen: string[] = [];
    off.onAdState((s) => seen.push(s));
    await off.commercialBreak();
    expect(await off.rewardedBreak()).toBe(false);
    expect(calls).not.toContain('commercialBreak');
    expect(seen).toEqual([]);
    off.gameplayStart();
    expect(calls).toContain('gameplayStart');
  });

  it('clears ad state even when the ad rejects', async () => {
    const sdk = (window as unknown as { PokiSDK: { commercialBreak: ReturnType<typeof vi.fn> } }).PokiSDK;
    sdk.commercialBreak.mockRejectedValueOnce(new Error('no fill'));
    await adapter.commercialBreak();
    expect(adapter.isAdPlaying).toBe(false);
  });

  it('survives an SDK that throws on every telemetry call', () => {
    const sdk = (window as unknown as { PokiSDK: { customEvent: ReturnType<typeof vi.fn> } }).PokiSDK;
    sdk.customEvent.mockImplementation(() => {
      throw new Error('telemetry down');
    });
    expect(() => adapter.measure('run', '30-sec-reached')).not.toThrow();
  });

  it('keeps every measure key to a two-part category/action pair', () => {
    for (const [key, value] of Object.entries(MEASURE)) {
      expect(value, key).toHaveLength(2);
      expect(typeof value[0]).toBe('string');
      expect(typeof value[1]).toBe('string');
    }
  });
});
