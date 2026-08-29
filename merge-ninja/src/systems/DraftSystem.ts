import { BALANCE } from '../data/balance';
import type { DraftCardId } from '../data/draftCards';

/** Which bet is standing: the steady one, the steep one, or none. */
export type BountyKind = 'bounty' | 'wager';

/**
 * The pending three-card offer, and the bounty a taken card can arm.
 *
 * Phaser-free and driven entirely by `update(dtMs)`, like `BossController`, so
 * a seeded run is reproducible and the whole thing is testable without a
 * scene. Crucially it never pauses anything: the offer is a countdown the
 * simulation runs underneath, and when the countdown ends the leftmost card
 * takes itself. A boss reward the player forgot to collect is not a stall
 * worth building a modal for.
 */
export interface DraftOffer {
  readonly stage: number;
  readonly cards: readonly DraftCardId[];
}

export interface DraftCallbacks {
  /** A card was taken, by the player or by the auto-pick timer running out. */
  readonly resolved: (stage: number, card: DraftCardId, auto: boolean) => void;
}

export class DraftSystem {
  private offer: DraftOffer | null = null;
  private remainingMs = 0;
  private bountyMsLeft = 0;
  private bountyKind: BountyKind | null = null;

  constructor(private readonly callbacks: DraftCallbacks) {}

  get pending(): DraftOffer | null { return this.offer; }
  get msLeft(): number { return this.remainingMs; }

  /** True once the leftmost card has started pulsing ahead of the auto-pick. */
  get warning(): boolean {
    return this.offer !== null && this.remainingMs <= BALANCE.draft.autoPickWarnMs;
  }

  get bountyActive(): boolean { return this.bountyMsLeft > 0; }
  get bountyMsRemaining(): number { return this.bountyMsLeft; }
  get bountyWindowMs(): number {
    return this.bountyKind === 'wager' ? BALANCE.draft.wagerWindowMs : BALANCE.draft.bountyWindowMs;
  }

  /**
   * Replaces any offer still on screen.
   *
   * A second boss can fall while the first one's cards are still up -- a merge
   * strike landing on a nearly dead boss does exactly that -- and leaving the
   * stale row to expire would silently drop the newer reward. The outgoing
   * offer resolves on its leftmost card first, so nothing is ever lost.
   */
  present(stage: number, cards: readonly DraftCardId[]): void {
    if (cards.length === 0) return;
    if (this.offer !== null) this.resolve(this.offer.cards[0]!, true);
    this.offer = { stage, cards: [...cards] };
    this.remainingMs = BALANCE.draft.autoPickMs;
  }

  /** Ignores a card that is not actually on offer, so a stale tap cannot cheat. */
  pick(card: DraftCardId): boolean {
    if (this.offer === null || !this.offer.cards.includes(card)) return false;
    this.resolve(card, false);
    return true;
  }

  update(dtMs: number): void {
    const step = Math.max(0, dtMs);
    if (this.bountyMsLeft > 0) {
      this.bountyMsLeft = Math.max(0, this.bountyMsLeft - step);
      if (this.bountyMsLeft === 0) this.bountyKind = null;
    }
    if (this.offer === null) return;
    this.remainingMs -= step;
    if (this.remainingMs <= 0) this.resolve(this.offer.cards[0]!, true);
  }

  armBounty(kind: BountyKind = 'bounty'): void {
    this.bountyKind = kind;
    this.bountyMsLeft = kind === 'wager' ? BALANCE.draft.wagerWindowMs : BALANCE.draft.bountyWindowMs;
  }

  /** Spends the bounty if it is still running. Returns which bet paid, or null. */
  consumeBounty(): BountyKind | null {
    if (this.bountyMsLeft <= 0 || this.bountyKind === null) return null;
    const kind = this.bountyKind;
    this.bountyMsLeft = 0;
    this.bountyKind = null;
    return kind;
  }

  /** A run reset must not carry a bet, or a card row, into the next run. */
  reset(): void {
    this.offer = null;
    this.remainingMs = 0;
    this.bountyMsLeft = 0;
    this.bountyKind = null;
  }

  private resolve(card: DraftCardId, auto: boolean): void {
    const stage = this.offer?.stage ?? 0;
    this.offer = null;
    this.remainingMs = 0;
    this.callbacks.resolved(stage, card, auto);
  }
}
