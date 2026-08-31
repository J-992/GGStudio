import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();

  class TestRenderer {
    outputColorSpace = '';
    toneMapping = 0;
    toneMappingExposure = 1;
    shadowMap = { enabled: false, type: 0 };

    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
  }

  return { ...actual, WebGLRenderer: TestRenderer };
});

import { Game } from '../game/Game';
import { Rng } from '../core/Rng';
import { TUTORIAL } from '../config';

type GameHarness = {
  state: string;
  elapsed: number;
  score: number;
  hearts: number;
  combat: {
    activeCount(): number;
    consumeTutorialThreat(): void;
    liveThreats: Array<{
      spawn(options: {
        side: 'L' | 'R';
        impactAt: number;
        spawnAt: number;
        approach: number;
        rare: boolean;
        rng: Rng;
      }): void;
    }>;
  };
  startRun(waitForInput?: boolean): void;
  update(frame: { dt: number; dtReal: number; time: number }): void;
  onFirstInput(): void;
  onThreatLands(enemy: GameHarness['combat']['liveThreats'][number]): void;
};

function createGame(): GameHarness {
  const canvas = document.createElement('canvas');
  const ui = document.createElement('div');
  document.body.append(canvas, ui);
  return new Game(canvas, ui) as unknown as GameHarness;
}

describe('first-run activation', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    const gradient = { addColorStop: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === '2d'
        ? {
            createRadialGradient: () => gradient,
            fillRect: vi.fn(),
            fillStyle: '',
          }
        : null) as never);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not advance combat, time, or score before genuine player input', () => {
    const game = createGame();
    game.startRun(true);

    for (let second = 1; second <= 90; second += 1) {
      game.update({ dt: 1 / 60, dtReal: 1 / 60, time: second });
    }

    expect(game.state).toBe('waiting');
    expect(game.elapsed).toBe(0);
    expect(game.score).toBe(0);
    expect(game.combat.activeCount()).toBe(0);
  });

  it('begins the waiting run on the first genuine control', () => {
    const game = createGame();
    game.startRun(true);

    game.onFirstInput();

    expect(game.state).toBe('playing');
  });

  it('ends automatic block protection when the configured practice threats are spent', () => {
    const game = createGame();
    game.startRun();
    for (let i = 0; i < TUTORIAL.safeThreats; i += 1) game.combat.consumeTutorialThreat();
    const enemy = game.combat.liveThreats[0];
    enemy.spawn({ side: 'L', impactAt: 0, spawnAt: 0, approach: 1, rare: false, rng: new Rng(4) });

    game.onThreatLands(enemy);

    expect(game.hearts).toBe(3);
  });
});
