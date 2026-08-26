/** Moments where the game can ask Poki to fill an interstitial opportunity. */
export type CommercialBreakMoment = 'firstGameplay' | 'runRestart';

/**
 * The first tap is the player's first taste of the game, never a natural
 * break. A finished run is already paused behind its result card and is the
 * first honest interstitial opportunity.
 */
export function shouldOfferCommercialBreak(moment: CommercialBreakMoment): boolean {
  return moment === 'runRestart';
}
