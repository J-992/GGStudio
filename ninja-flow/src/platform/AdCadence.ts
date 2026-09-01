import { PLATFORM } from '../config';

/** Session-scoped ad timing based only on time under player control. */
export class AdCadence {
  private active = 0;
  private lastBreak = 0;

  addActiveSeconds(seconds: number): void {
    if (Number.isFinite(seconds) && seconds > 0) this.active += seconds;
  }

  get activeSeconds(): number {
    return this.active;
  }

  consumeBreakDue(): boolean {
    if (this.active < PLATFORM.firstCommercialSeconds) return false;
    if (this.active - this.lastBreak < PLATFORM.minCommercialIntervalSeconds) return false;
    this.lastBreak = this.active;
    return true;
  }
}
