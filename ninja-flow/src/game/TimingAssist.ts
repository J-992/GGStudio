import { TIMING } from '../config';
import type { TimingWindow } from './TimingEvaluator';

export interface TimingAssistSnapshot {
  errorMs: number;
  samples: number;
}

/**
 * Learns the player's real timing error without moving the Perfect window.
 *
 * A cold-open player begins with enough room for the ~320 ms error observed in
 * playtests. Each press updates one rolling estimate; accurate play therefore
 * narrows naturally toward the authored window instead of leaving an invisible
 * permanent easy mode switched on.
 */
export class TimingAssist {
  private errorMs: number;
  private samples: number;

  constructor(errorMs: number = TIMING.assist.initialErrorMs, samples = 0) {
    this.errorMs = finiteError(errorMs);
    this.samples = Math.max(0, Math.floor(samples));
  }

  reset(errorMs: number = TIMING.assist.initialErrorMs, samples = 0): void {
    this.errorMs = finiteError(errorMs);
    this.samples = Math.max(0, Math.floor(samples));
  }

  observe(signedErrorMs: number): void {
    if (!Number.isFinite(signedErrorMs)) return;
    const sample = Math.min(TIMING.whiffBeyondMs, Math.abs(signedErrorMs));
    this.errorMs += (sample - this.errorMs) * TIMING.assist.smoothing;
    this.samples += 1;
  }

  get window(): TimingWindow {
    return {
      goodEarlyMs: clamp(
        this.errorMs * TIMING.assist.earlyScale + TIMING.assist.earlyPaddingMs,
        TIMING.goodEarlyMs,
        TIMING.assist.maxEarlyMs,
      ),
      goodLateMs: clamp(
        this.errorMs * TIMING.assist.lateScale + TIMING.assist.latePaddingMs,
        TIMING.goodLateMs,
        TIMING.assist.maxLateMs,
      ),
    };
  }

  get snapshot(): TimingAssistSnapshot {
    return { errorMs: this.errorMs, samples: this.samples };
  }
}

function finiteError(value: number): number {
  if (!Number.isFinite(value)) return TIMING.assist.initialErrorMs;
  return clamp(Math.abs(value), 0, TIMING.whiffBeyondMs);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
