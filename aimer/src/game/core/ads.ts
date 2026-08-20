import {
    platformHasAds,
    requestPlatformCommercialBreak,
    requestPlatformRewardedBreak
} from '../platform/platform';
import { setGameplayActive } from './lifecycle';

/**
 * When the game is allowed to ask for an ad.
 *
 * Poki enforces their own frequency cap, so this is not about obeying a quota
 * -- it is about never handing them a moment that would feel like an
 * interruption. Two rules do most of the work: a player who has not finished
 * anything yet never sees an interstitial, and two breaks never land close
 * together even if the player is speed-running short levels.
 */

/** No interstitial until the player has finished this many levels, ever. */
const WARMUP_LEVELS = 3;

/** Floor between two interstitials, on top of whatever Poki enforces. */
const MIN_GAP_MS = 100000;

/** A rewarded break shorter than this cannot have put a video on screen. */
const AD_SHOWN_MS = 1500;

let clearedLevels = 0;
let lastBreakAt = -Infinity;

/** True when a rewarded button should be drawn at all. */
export function adsAvailable (): boolean
{
    return platformHasAds();
}

/** Called once per level cleared, so the warm-up rule can count. */
export function noteLevelCleared (): void
{
    clearedLevels += 1;
}

function canInterstitial (): boolean
{
    if (!platformHasAds()) return false;
    if (clearedLevels < WARMUP_LEVELS) return false;
    return Date.now() - lastBreakAt >= MIN_GAP_MS;
}

/**
 * Offer Poki a break at a moment where an ad interrupts nothing. Always
 * resolves -- including when the rules said no, when Poki declined, and when
 * the SDK never loaded -- so the caller can simply await it and carry on.
 *
 * The caller must already be off the playfield: gameplay is reported stopped
 * before the break and is *not* restarted here, because the screen the player
 * comes back to is a menu or a card, not the game.
 */
export async function offerInterstitial (): Promise<boolean>
{
    if (!canInterstitial()) return false;

    lastBreakAt = Date.now();
    setGameplayActive(false);

    return requestPlatformCommercialBreak();
}

/**
 * A rewarded video the player asked for. Resolves true once the break is over,
 * whatever Poki made of it, so the reward is owed on every path that got this
 * far.
 *
 * Poki's confirmation is not trustworthy enough to gate a reward on. An ad
 * blocker that only kills the tracking POST to `t.poki.io` still lets the video
 * play start to finish, and the break then comes back unconfirmed -- a player
 * who watched the whole thing gets nothing, which is the one outcome a rewarded
 * ad must never produce. Blocked SDK, no fill and a thrown request land in the
 * same place. So the reward follows the ask, not the portal's answer.
 *
 * The trade is deliberate and it is the cheaper half: a player who cancels the
 * prompt is also paid out. Rerolls and revives cost nothing to give away, and
 * paying a few skippers beats charging real viewers for Poki's failures.
 */
export async function watchRewarded (): Promise<boolean>
{
    if (!platformHasAds()) return false;

    setGameplayActive(false);

    const startedAt = Date.now();
    const confirmed = await requestPlatformRewardedBreak();

    //  A rewarded video counts against the interstitial pacing too: back to
    //  back ads are the fastest way to lose a player. Pacing is the one thing
    //  that still needs to know whether an ad *ran*, and an unconfirmed break
    //  that took real time did run, so it is timed rather than trusted.
    if (confirmed || Date.now() - startedAt > AD_SHOWN_MS) lastBreakAt = Date.now();

    return true;
}
