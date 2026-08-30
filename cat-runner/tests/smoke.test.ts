import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { SaveManager, type StorageAdapter } from '../src/game/SaveManager';
import { CAT_SKINS } from '../src/entities/CatSkins';
import { SettingsManager } from '../src/game/SettingsManager';
import { PHYSICS, DEFAULT_PHYSICS, resetPhysicsConfig } from '../src/physics/PhysicsConfig';
import { GameState, GameStateMachine } from '../src/game/GameState';

/**
 * Lightweight smoke tests.
 *
 * These deliberately avoid WebGL and the Rapier WASM - they cover the parts
 * that are pure logic and that break silently: save-data validation, route
 * maths, state-machine legality and level-data sanity. Rendering and physics
 * feel are verified by playing the game, not here.
 */

/** In-memory adapter so tests never touch real storage. */
class MemoryAdapter implements StorageAdapter {
  store = new Map<string, string>();
  get(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.store.set(key, value);
  }
  remove(key: string): void {
    this.store.delete(key);
  }
}

// ---------------------------------------------------------------------------

describe('SaveManager', () => {
  let adapter: MemoryAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  it('starts from clean defaults', () => {
    const save = new SaveManager(adapter);
    expect(save.data.selectedSkin).toBe('orange');
  });

  // Save files are user-editable; a corrupt one must degrade, never throw.
  const hostilePayloads = [
    'not json at all',
    '{',
    'null',
    '[]',
    '"a string"',
    '{"version":"cheese"}',
    '{"version":1,"selectedSkin":"dragon"}',
    '{"version":9999}',
    '{"version":1,"unlockedSkins":[1,2,3]}',
  ];

  it.each(hostilePayloads)('survives corrupt save data: %s', (payload) => {
    adapter.set('rooftop-rascal:save:v1', payload);

    let save!: SaveManager;
    expect(() => {
      save = new SaveManager(adapter);
    }).not.toThrow();

    expect(save.data.selectedSkin).toBeTypeOf('string');
  });

  it('equips only coats the player owns', () => {
    // v4 made coats purchasable again, so selectSkin defends against two
    // things: an id with no texture behind it, and an id the player has not
    // bought. Both can reach it from a hand-edited save, which is why neither
    // check lives only on the shop card that renders the lock.
    const save = new SaveManager(adapter);

    save.selectSkin('russianblue');
    expect(save.data.selectedSkin).toBe('orange');

    save.recordRun(0, 1000);
    expect(save.unlockSkin('russianblue')).toBe(true);
    save.selectSkin('russianblue');
    expect(save.data.selectedSkin).toBe('russianblue');

    save.selectSkin('dragon' as never);
    expect(save.data.selectedSkin).toBe('russianblue');
  });

  it('carries a retired skin over to its nearest surviving coat', () => {
    // A v2 save can name `grey`, which no longer has a texture. Resetting those
    // players to the default would silently undo a choice they made.
    adapter.set('rooftop-rascal:save:v1', '{"version":2,"selectedSkin":"grey"}');
    expect(new SaveManager(adapter).data.selectedSkin).toBe('russianblue');

    adapter.set('rooftop-rascal:save:v1', '{"version":2,"selectedSkin":"white"}');
    expect(new SaveManager(adapter).data.selectedSkin).toBe('calico');
  });

  it('round-trips through storage', () => {
    // Banked against the coat's actual price rather than a number written in
    // here, so re-pricing the shop cannot make this fail for a reason that has
    // nothing to do with whether a save survives a reload.
    const price = CAT_SKINS.find((s) => s.id === 'calico')!.cost;

    const a = new SaveManager(adapter);
    a.recordRun(420, price + 20);
    a.unlockSkin('calico');
    a.selectSkin('calico');
    a.flush();

    const b = new SaveManager(adapter);
    expect(b.data.selectedSkin).toBe('calico');
    // The purchase, the spend, and the record all have to survive the trip -
    // a wallet that resets on reload is worse than no wallet at all.
    expect(b.isSkinUnlocked('calico')).toBe(true);
    expect(b.fish).toBe(20);
    expect(b.bestDistance).toBe(420);
  });
});

// ---------------------------------------------------------------------------

describe('SettingsManager', () => {
  it('defaults Assist Mode off and pause-on-blur on', () => {
    const settings = new SettingsManager(new MemoryAdapter());
    expect(settings.get('assistMode')).toBe(false);
    expect(settings.get('pauseOnFocusLoss')).toBe(true);
  });

  it('clamps out-of-range values instead of storing them', () => {
    const settings = new SettingsManager(new MemoryAdapter());

    settings.set('masterVolume', 5);
    expect(settings.get('masterVolume')).toBeLessThanOrEqual(1);

    settings.set('masterVolume', -3);
    expect(settings.get('masterVolume')).toBeGreaterThanOrEqual(0);
  });

  it('survives corrupt settings data', () => {
    const adapter = new MemoryAdapter();
    adapter.set('rooftop-rascal:settings:v1', '{"masterVolume":"loud","graphicsQuality":42}');

    let settings!: SettingsManager;
    expect(() => {
      settings = new SettingsManager(adapter);
    }).not.toThrow();

    expect(Number.isFinite(settings.get('masterVolume'))).toBe(true);
    expect(['low', 'medium', 'high']).toContain(settings.get('graphicsQuality'));
  });

  it('notifies subscribers on change', () => {
    const settings = new SettingsManager(new MemoryAdapter());
    let seen: string | null = null;
    const off = settings.onChange((_s, key) => {
      seen = key;
    });

    settings.set('reducedScreenShake', true);
    expect(seen).toBe('reducedScreenShake');

    off();
    settings.set('reducedCameraMotion', true);
    expect(seen).toBe('reducedScreenShake'); // unsubscribed
  });

  describe('graphics quality default on a touch-primary device', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('defaults to medium for a coarse pointer even with a desktop-looking UA', () => {
      vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', hardwareConcurrency: 8, maxTouchPoints: 0 });
      vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' }) });

      const settings = new SettingsManager(new MemoryAdapter());
      expect(settings.get('graphicsQuality')).toBe('medium');
    });

    it('defaults to medium for maxTouchPoints > 0 even with no matchMedia support', () => {
      vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', hardwareConcurrency: 8, maxTouchPoints: 5 });
      vi.stubGlobal('window', {});

      const settings = new SettingsManager(new MemoryAdapter());
      expect(settings.get('graphicsQuality')).toBe('medium');
    });
  });

  describe('graphics quality default on a mobile UA', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('defaults all the way to low for a budget-looking phone (mobile UA, low core count)', () => {
      // Regression for the mobile optimization pass: this used to bottom
      // out at 'medium', which still leaves shadows and particles on
      // (Game.ts only gates those off at 'low') - a phone was never
      // actually reaching the tier meant for weak hardware.
      vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-A105F)', hardwareConcurrency: 4, maxTouchPoints: 5 });
      vi.stubGlobal('window', {});

      const settings = new SettingsManager(new MemoryAdapter());
      expect(settings.get('graphicsQuality')).toBe('low');
    });

    it('stays at medium for a mobile UA with a high reported core count', () => {
      // hardwareConcurrency only ever pulls the default down, never back up
      // past what the touch/UA checks already decided.
      vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', hardwareConcurrency: 8, maxTouchPoints: 5 });
      vi.stubGlobal('window', {});

      const settings = new SettingsManager(new MemoryAdapter());
      expect(settings.get('graphicsQuality')).toBe('medium');
    });

    it('defaults to low when hardwareConcurrency is unavailable on a mobile UA (the conservative fallback)', () => {
      vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 10)' });
      vi.stubGlobal('window', {});

      const settings = new SettingsManager(new MemoryAdapter());
      expect(settings.get('graphicsQuality')).toBe('low');
    });
  });
});

// ---------------------------------------------------------------------------

describe('GameStateMachine', () => {
  it('permits the normal play loop', () => {
    const sm = new GameStateMachine();
    sm.force(GameState.MainMenu);

    expect(sm.transition(GameState.Intro)).toBe(true);
    expect(sm.transition(GameState.Playing)).toBe(true);
    expect(sm.transition(GameState.Failed)).toBe(true);
    expect(sm.transition(GameState.Intro)).toBe(true);
    expect(sm.transition(GameState.Playing)).toBe(true);
    expect(sm.transition(GameState.MainMenu)).toBe(true);
  });

  it('rejects illegal transitions', () => {
    const sm = new GameStateMachine();
    sm.force(GameState.MainMenu);
    expect(sm.transition(GameState.Failed)).toBe(false);
    expect(sm.state).toBe(GameState.MainMenu);
  });

  it('fires exit and enter handlers in order', () => {
    const sm = new GameStateMachine();
    const order: string[] = [];

    sm.register(GameState.MainMenu, { onExit: () => order.push('exit-menu') });
    sm.register(GameState.Intro, { onEnter: () => order.push('enter-intro') });

    sm.force(GameState.MainMenu);
    sm.transition(GameState.Intro);

    expect(order).toEqual(['exit-menu', 'enter-intro']);
  });

  it('only simulates during Intro and Playing', () => {
    const sm = new GameStateMachine();
    sm.force(GameState.Playing);
    expect(sm.isSimulating).toBe(true);

    sm.transition(GameState.Paused);
    expect(sm.isSimulating).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('physics configuration', () => {
  beforeEach(() => resetPhysicsConfig());

  it('uses a fixed 1/60 timestep', () => {
    expect(PHYSICS.fixedTimeStep).toBeCloseTo(1 / 60, 6);
  });

  it('sits within the ranges the design calls for', () => {
    expect(DEFAULT_PHYSICS.gravity).toBeLessThan(-15);
    expect(DEFAULT_PHYSICS.runSpeed).toBeGreaterThanOrEqual(8);
    expect(DEFAULT_PHYSICS.runSpeed).toBeLessThanOrEqual(14);
    expect(DEFAULT_PHYSICS.jumpImpulse).toBeGreaterThanOrEqual(6);
    expect(DEFAULT_PHYSICS.jumpImpulse).toBeLessThanOrEqual(8);
    expect(DEFAULT_PHYSICS.coyoteTime).toBeCloseTo(0.1, 2);
  });

  it('leaves the outer lanes standable on a deck exactly three lanes wide', () => {
    // The deck is no longer a wide roof with lanes painted down the middle - it
    // is exactly `3 * laneSpacing`, so its edge IS the outer lane's edge. What
    // has to hold is that a capsule parked in an outer lane is still fully on
    // it, with enough left over that standing there is not knife-edge.
    const deckHalfWidth = (DEFAULT_PHYSICS.laneSpacing * 3) / 2;
    const outerLaneEdge = DEFAULT_PHYSICS.laneSpacing + DEFAULT_PHYSICS.colliderRadius;

    expect(outerLaneEdge).toBeLessThan(deckHalfWidth);
    expect(deckHalfWidth - outerLaneEdge).toBeGreaterThan(0.5);
  });

  it('changes lane inside the window a dodge has to happen in', () => {
    // A timed tween, so this is a real duration rather than a time constant.
    // Below 0.12 the hop has no time to read at all; above 0.29 it stops
    // feeling like a dodge and starts feeling like steering. The floor came
    // down from 0.15 with the input-latency pass - the tween now leads with a
    // sine ease-*out* rather than a symmetric smoothstep, so it commits to
    // visible movement immediately and can afford to be shorter overall
    // without the hop becoming a teleport.
    expect(DEFAULT_PHYSICS.laneChangeTime).toBeGreaterThanOrEqual(0.12);
    expect(DEFAULT_PHYSICS.laneChangeMaxTime).toBeLessThanOrEqual(0.29);
    expect(DEFAULT_PHYSICS.laneChangeMaxTime).toBeGreaterThanOrEqual(
      DEFAULT_PHYSICS.laneChangeTime,
    );
  });

  it('lets the lane tween reach its own peak speed', () => {
    // The tween eases with sin(t * PI/2) (see
    // `PlayerController.applyRunVelocity`), whose derivative peaks at PI/2
    // times the average rate, at t=0. A ceiling below that would clip the ease
    // flat and quietly turn the tween back into the drift it replaced.
    const PEAK_RATIO = Math.PI / 2;

    const singleLanePeak =
      (PEAK_RATIO * DEFAULT_PHYSICS.laneSpacing) / DEFAULT_PHYSICS.laneChangeTime;
    expect(DEFAULT_PHYSICS.maxLaneSpeed).toBeGreaterThanOrEqual(singleLanePeak);

    // The two-lane sweep is the faster of the two: it covers twice the
    // distance in less than twice the time (`laneChangeMaxTime` caps it), so
    // checking only the single-lane case would leave the clamp free to bite on
    // exactly the move that most needs to arrive on schedule.
    const twoLanePeak =
      (PEAK_RATIO * 2 * DEFAULT_PHYSICS.laneSpacing) / DEFAULT_PHYSICS.laneChangeMaxTime;
    expect(DEFAULT_PHYSICS.maxLaneSpeed).toBeGreaterThanOrEqual(twoLanePeak);
  });

  it('keeps a peak-speed lane change above the shallow-graze gate', () => {
    // `maxLaneSpeed` is not free to grow: `PlayerController.reportObstacleHit`
    // and `handleContact` both excuse a hit whose combined-velocity alignment
    // is below 0.35 as a graze rather than a crash. Push the lateral clamp
    // high enough and an ordinary lane change drops under that gate on its
    // own, silently making it impossible to crash into a crate while steering.
    const alignment =
      DEFAULT_PHYSICS.runSpeed /
      Math.hypot(DEFAULT_PHYSICS.runSpeed, DEFAULT_PHYSICS.maxLaneSpeed);
    expect(alignment).toBeGreaterThan(0.35);
  });

  it('keeps the residual lane hold quick but not instant', () => {
    // laneSnapRate no longer drives lane changes - it is the hold term that
    // resists drift once the tween has arrived.
    expect(DEFAULT_PHYSICS.laneSnapRate).toBeGreaterThan(4);
    expect(DEFAULT_PHYSICS.laneSnapRate).toBeLessThan(1 / DEFAULT_PHYSICS.fixedTimeStep);
  });

  it('gives the runner less lane authority in the air than on the ground', () => {
    expect(DEFAULT_PHYSICS.airControl).toBeGreaterThan(0);
    expect(DEFAULT_PHYSICS.airControl).toBeLessThan(1);
  });

  it('can lift the runner over a lip taller than it can be stopped by', () => {
    // Measured: a step of 0.4 stops a velocity-driven capsule permanently. The
    // step-up assist has to reach past that or the class of bug survives.
    expect(DEFAULT_PHYSICS.maxStepUp).toBeGreaterThan(0.4);
  });

  it('restores defaults after mutation', () => {
    PHYSICS.gravity = -1;
    resetPhysicsConfig();
    expect(PHYSICS.gravity).toBe(DEFAULT_PHYSICS.gravity);
  });
});

