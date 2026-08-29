import { describe, expect, it } from 'vitest';
import {
  RetentionFunnel,
  waveLabel,
  type FunnelMeasure,
} from '../src/app/funnel.ts';

function harness(): {
  funnel: RetentionFunnel;
  sent: FunnelMeasure[];
  keys: () => string[];
} {
  const sent: FunnelMeasure[] = [];
  const funnel = new RetentionFunnel((m) => sent.push(m));
  return {
    funnel,
    sent,
    keys: () => sent.map((m) => `${m.category}:${m.what}:${m.action}`),
  };
}

/**
 * Drive the clock the way the frame loop does. The funnel clamps a single
 * delta so a backgrounded tab cannot bank ten minutes of "play", which means
 * every time assertion has to arrive one frame at a time, as it will in the
 * game.
 */
function advance(funnel: RetentionFunnel, seconds: number, playing: boolean) {
  const frames = Math.round((seconds * 1_000) / 16);
  for (let i = 0; i < frames; i += 1) funnel.tick(16, playing);
}

describe('wave labels', () => {
  it('names every early wave exactly, because that is where players leave', () => {
    expect(waveLabel(1)).toBe('1');
    expect(waveLabel(7)).toBe('7');
    expect(waveLabel(12)).toBe('12');
  });

  it('keeps the round milestones past the early game', () => {
    expect(waveLabel(15)).toBe('15');
    expect(waveLabel(20)).toBe('20');
    expect(waveLabel(50)).toBe('50');
  });

  it('bands everything else so the label set stays small', () => {
    expect(waveLabel(13)).toBe('13-19');
    expect(waveLabel(37)).toBe('31-39');
    expect(waveLabel(64)).toBe('51-74');
    expect(waveLabel(180)).toBe('100+');
  });

  it('never trusts a nonsense wave number', () => {
    expect(waveLabel(0)).toBe('1');
    expect(waveLabel(-4)).toBe('1');
    expect(waveLabel(Number.NaN)).toBe('1');
  });
});

describe('funnel event discipline', () => {
  it('reports each distinct checkpoint exactly once per session', () => {
    const { funnel, keys } = harness();
    funnel.bootStage('scriptsReady');
    funnel.bootStage('scriptsReady');
    funnel.bootStage('engineReady');
    expect(keys()).toEqual([
      'boot:scriptsReady:reached',
      'boot:engineReady:reached',
    ]);
  });

  it('stops sending once the session cap is reached', () => {
    const { funnel, sent } = harness();
    for (let wave = 1; wave <= 400; wave += 1) {
      funnel.startWave(wave);
      funnel.completeWave(wave);
    }
    expect(sent.length).toBeLessThanOrEqual(RetentionFunnel.maxEventsPerSession);
  });
});

describe('screen funnel', () => {
  it('reports a screen the first time the player reaches it', () => {
    const { funnel, keys } = harness();
    funnel.enterScreen('title');
    funnel.enterScreen('garage');
    funnel.enterScreen('title');
    expect(keys()).toEqual(['screen:title:start', 'screen:garage:start']);
  });

  it('buckets how long a screen is held, and only crosses each mark once', () => {
    const { funnel, keys } = harness();
    funnel.enterScreen('garage');
    advance(funnel, 20, false);
    expect(keys()).toEqual(['screen:garage:start']);
    advance(funnel, 15, false);
    expect(keys()).toContain('dwell:garage-30s:reached');
    advance(funnel, 40, false);
    expect(keys()).toContain('dwell:garage-60s:reached');
    const before = keys().length;
    advance(funnel, 1, false);
    expect(keys()).toHaveLength(before);
  });

  it('restarts the dwell clock on each screen', () => {
    const { funnel, keys } = harness();
    funnel.enterScreen('garage');
    advance(funnel, 29, false);
    funnel.enterScreen('survival');
    advance(funnel, 29, false);
    expect(keys()).not.toContain('dwell:garage-30s:reached');
    expect(keys()).not.toContain('dwell:survival-30s:reached');
  });
});

describe('mode and wave funnel', () => {
  it('labels waves with the mode that is running', () => {
    const { funnel, keys } = harness();
    funnel.startMode('endless');
    funnel.startWave(3);
    expect(keys()).toEqual(['mode:endless:start', 'wave:endless-3:start']);
  });

  it('pairs a cleared wave with the start that opened it', () => {
    const { funnel, keys } = harness();
    funnel.startMode('campaign');
    funnel.startWave(1);
    funnel.completeWave(1);
    funnel.startWave(2);
    expect(keys()).toEqual([
      'mode:campaign:start',
      'wave:campaign-1:start',
      'wave:campaign-1:complete',
      'wave:campaign-2:start',
    ]);
  });

  it('fails the live wave and the mode together when a run ends badly', () => {
    const { funnel, keys } = harness();
    funnel.startMode('campaign');
    funnel.startWave(4);
    funnel.endRun('fail');
    expect(keys()).toEqual([
      'mode:campaign:start',
      'wave:campaign-4:start',
      'wave:campaign-4:fail',
      'mode:campaign:fail',
    ]);
  });

  it('does not fail a wave that was already cleared', () => {
    const { funnel, keys } = harness();
    funnel.startMode('campaign');
    funnel.startWave(4);
    funnel.completeWave(4);
    funnel.endRun('abandon');
    expect(keys()).not.toContain('wave:campaign-4:fail');
    expect(keys()).toContain('mode:campaign:abandon');
  });

  it('treats a second run in the same mode as one funnel entry', () => {
    const { funnel, sent } = harness();
    funnel.startMode('daily');
    funnel.endRun('fail');
    funnel.startMode('daily');
    funnel.endRun('fail');
    expect(sent.filter((m) => m.category === 'mode')).toHaveLength(2);
  });
});

describe('active play time', () => {
  it('counts only the time the player is actually playing', () => {
    const { funnel, keys } = harness();
    advance(funnel, 120, false);
    expect(keys()).toEqual([]);
    advance(funnel, 31, true);
    expect(keys()).toEqual(['playtime:30s:reached']);
  });

  it('crosses every mark it has passed', () => {
    const { funnel, keys } = harness();
    advance(funnel, 125, true);
    expect(keys()).toEqual([
      'playtime:30s:reached',
      'playtime:60s:reached',
      'playtime:120s:reached',
    ]);
  });

  it('will not bank a backgrounded tab as play time', () => {
    const { funnel, keys } = harness();
    // One frame delta after ten minutes in another tab. Counting it whole
    // would report a five-minute session nobody sat through.
    for (let i = 0; i < 25; i += 1) funnel.tick(600_000, true);
    expect(keys()).toEqual([]);
  });

  it('ignores a garbage delta rather than poisoning the clock', () => {
    const { funnel, keys } = harness();
    funnel.tick(Number.NaN, true);
    funnel.tick(-5_000, true);
    advance(funnel, 29, true);
    expect(keys()).toEqual([]);
  });
});

describe('garage friction', () => {
  it('separates having a legal rig from actually deploying it', () => {
    const { funnel, keys } = harness();
    funnel.garage('rig-ready');
    funnel.garage('deploy');
    expect(keys()).toEqual([
      'garage:rig-ready:reached',
      'garage:deploy:reached',
    ]);
  });

  it('reports a rig becoming legal once, not on every edit after it', () => {
    const { funnel, sent } = harness();
    for (let i = 0; i < 50; i += 1) funnel.garage('rig-ready');
    expect(sent).toHaveLength(1);
  });

  it('walks the garage tour step by step', () => {
    const { funnel, keys } = harness();
    funnel.tourStart();
    funnel.tourStep('buy');
    funnel.tourStep('attach');
    funnel.tourComplete();
    expect(keys()).toEqual([
      'tour:onboarding:start',
      'tour:buy:reached',
      'tour:attach:reached',
      'tour:onboarding:complete',
    ]);
  });
});

describe('friction inside a live wave', () => {
  it('keeps a sandbox bench trip apart from a forfeited campaign wave', () => {
    const { funnel, keys } = harness();
    funnel.friction('bench-trip');
    funnel.friction('garage-mid-wave');
    expect(keys()).toEqual([
      'friction:bench-trip:reached',
      'friction:garage-mid-wave:reached',
    ]);
  });

  it('reports a pause once however many times the player opens it', () => {
    const { funnel, sent } = harness();
    funnel.friction('pause');
    funnel.friction('pause');
    expect(sent).toHaveLength(1);
  });
});

describe('exit beacon', () => {
  it('names the screen the player was last looking at', () => {
    const { funnel, keys } = harness();
    funnel.enterScreen('garage');
    funnel.leave();
    expect(keys()).toContain('exit:garage:reached');
  });

  it('names the wave when the player leaves mid-fight', () => {
    const { funnel, keys } = harness();
    funnel.startMode('campaign');
    funnel.enterScreen('survival');
    funnel.startWave(6);
    funnel.leave();
    expect(keys()).toContain('exit:survival:reached');
    expect(keys()).toContain('exit-wave:campaign-6:reached');
  });

  it('does not repeat an exit from a state it already reported', () => {
    const { funnel, sent } = harness();
    funnel.enterScreen('title');
    funnel.leave();
    funnel.leave();
    expect(sent.filter((m) => m.category === 'exit')).toHaveLength(1);
  });

  it('reports a second exit from a place the player got to later', () => {
    const { funnel, sent } = harness();
    funnel.enterScreen('title');
    funnel.leave();
    funnel.enterScreen('garage');
    funnel.leave();
    expect(sent.filter((m) => m.category === 'exit')).toHaveLength(2);
  });
});

describe('the sink arriving late', () => {
  it('replays the boot funnel recorded before a sink existed', () => {
    const funnel = new RetentionFunnel();
    funnel.bootStage('scriptsReady');
    funnel.bootStage('engineReady');
    const sent: FunnelMeasure[] = [];
    funnel.connect((m) => sent.push(m));
    expect(sent.map((m) => m.what)).toEqual(['scriptsReady', 'engineReady']);
  });

  it('replays each buffered measure exactly once', () => {
    const funnel = new RetentionFunnel();
    funnel.bootStage('scriptsReady');
    const sent: FunnelMeasure[] = [];
    funnel.connect((m) => sent.push(m));
    funnel.bootStage('scriptsReady');
    funnel.enterScreen('title');
    expect(sent).toHaveLength(2);
  });
});

describe('sink failures', () => {
  it('never lets a broken sink reach the game', () => {
    const funnel = new RetentionFunnel(() => {
      throw new Error('analytics blocked');
    });
    expect(() => funnel.enterScreen('title')).not.toThrow();
    expect(() => funnel.startWave(1)).not.toThrow();
  });
});
