/**
 * Where the retention funnel's measures actually go, and the one instance of
 * it the game shares.
 *
 * `funnel.ts` is the vocabulary and the discipline; this file is the plumbing.
 * They are separate so the recorder can be tested without a network, a portal
 * SDK, or a DOM — and so a build that reports nowhere still runs every rule.
 *
 * Two sinks, because the game ships to two different kinds of host:
 *
 * - **Vercel Web Analytics**, already installed by `main.ts` for page views.
 *   This is the one that gets read: the playtest deploy is a Vercel site, and
 *   the dashboard groups a custom event by name with its properties broken out
 *   underneath — so the funnel's `category` becomes the event name and `what` /
 *   `action` become the breakdown. Note that custom events are a paid Vercel
 *   feature; on a plan without them the calls are simply ignored, and on a
 *   portal-hosted copy the insights script is not on the origin at all. Neither
 *   case is an error, and neither reaches the game.
 * - **The portal**, through `platform.ts`. Only Poki has anywhere to put these
 *   (Game Events); CrazyGames has no equivalent and takes none.
 *
 * In development nothing is sent anywhere — the measures go to the console
 * instead, so a funnel change can be verified by playing the game with the
 * console open rather than by waiting on a dashboard.
 */

import { track } from '@vercel/analytics';
import { measurePlatformFunnel } from './platform.ts';
import { funnel, type FunnelMeasure } from './funnel.ts';

/**
 * Send one measure to every sink that will take it.
 *
 * Each sink is isolated: an ad blocker eating the Vercel script must not stop
 * the portal being told, and neither may throw into the frame loop that called
 * it. `RetentionFunnel` also guards the whole call, so this is belt and braces
 * on the one path most likely to be broken in a player's browser.
 */
function report(measure: FunnelMeasure): void {
  const { category, what, action } = measure;

  if (import.meta.env.DEV) {
    console.debug(`[funnel] ${category}:${what}:${action}`);
    return;
  }

  try {
    track(category, { what, action });
  } catch {
    /* analytics blocked, or no custom events on this plan */
  }

  try {
    measurePlatformFunnel(category, what, action);
  } catch {
    /* no portal, or a portal with no game-events API */
  }
}

/**
 * Point the shared funnel at the real sinks and start watching for the exit.
 *
 * Called once, from `main.ts`, at the point the portal seam has been loaded.
 * Everything the funnel recorded before this — the whole boot funnel — is
 * buffered and replayed on connection, so the earliest and most valuable part
 * of the curve survives being recorded before its sink existed.
 *
 * `pagehide` rather than `visibilitychange`, deliberately. A tab switch is not
 * a player leaving — phones fire it constantly — and reporting one as an exit
 * would put most of the game's sessions under whatever screen the player
 * happened to alt-tab from. `pagehide` is the closest thing a browser offers
 * to "this session is over"; it can still be missed on a hard kill, which is
 * why the exit beacon is a supplement to the reached-counts rather than the
 * primary reading.
 */
export function connectFunnel(): void {
  funnel.connect(report);
  window.addEventListener('pagehide', () => funnel.leave());
}
