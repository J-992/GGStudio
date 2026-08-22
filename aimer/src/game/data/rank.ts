/**
 * The rank ladder -- the spine the run now hangs off.
 *
 * A run used to hand out one upgrade per level, on a screen the player had to
 * sit through between every single round. The parts are the same parts; what
 * changed is *when* they arrive. XP is earned by shooting, the bar under the
 * top edge of the screen fills while the player plays, and the moment it tops
 * out the run stops for as long as it takes to shoot one of three cards.
 *
 * That moves the reward off the level boundary and onto the player's own
 * shooting, which has three effects worth having:
 *
 *   -- levels flow into each other with nothing but a door between them;
 *   -- a good run levels faster than a bad one, so playing well compounds;
 *   -- the reward lands mid-fight, where it is a spike rather than a chore.
 *
 * The curve below is tuned against the real spawn tables: rank 2 lands inside
 * the first level, the early game pays about two ranks a level, and the back
 * half settles to roughly one. It never goes more than one level dry.
 */

/** XP to get off rank 1. */
const BASE = 100;

/**
 * How much more each rank costs than the one before.
 *
 * Steep on purpose, and steeper than it looks: at 1.64 the price of a rank more
 * than doubles every two rungs, while the kill rate over a run only about
 * doubles end to end. The cost curve outruns the game, which is the whole
 * point -- a ladder whose rungs are evenly spaced stops being a ladder about a
 * third of the way up, because rank 20 then arrives exactly as easily as rank 4
 * did.
 *
 * What that shakes out to over a full 40-level run is about a dozen upgrades,
 * against the forty the old one-per-level flow handed out. Rank 2 still lands
 * inside level 1 -- the system has to teach itself before it can be hard -- and
 * by the last world a rank is worth six or seven levels of work.
 *
 * This used to sit at 1.54, with a note that ~1.55 was the ceiling: past it, a
 * flawless run stopped out-ranking a sloppy one because no amount of streak XP
 * could keep up with the price. What moved the ceiling was the *supply* side --
 * XP now scales with the level it was earned on (see `xpWorth` in data/levels)
 * instead of being flat all run, which is worth about a third more XP over a
 * full run and roughly doubles the spread between a good run and a bad one at
 * the top end. The ladder was steepened to match, and then a little past it, so
 * the whole thing is a shade meaner than it was rather than a shade kinder.
 */
const GROWTH = 1.64;

/** XP needed to leave `rank` for the next one. */
export function xpForRank (rank: number): number
{
    return Math.round(BASE * Math.pow(GROWTH, Math.max(1, rank) - 1));
}

/**
 * The compounding half of the loop: every rank makes the next one come a
 * little sooner. Deliberately much smaller than the cost growth above -- it
 * takes the edge off the wall without flattening it, which is the difference
 * between a ladder that gets harder and one that only looks like it does.
 */
export function rankXpBonus (rank: number): number
{
    return 0.006 * (Math.max(1, rank) - 1);
}

/**
 * And the other half: every part bolted to the gun feeds the core a little, so
 * a build that is going well keeps some momentum. Same rule as above -- it
 * softens the curve, it never beats it.
 */
export function pickXpBonus (picks: number): number
{
    return 0.012 * Math.max(0, picks);
}

/**
 * Rank titles. Purely a name for the number, but a number with a name is a
 * place on a ladder and a bare number is a bare number.
 */
const TITLES: { at: number; name: string }[] = [
    { at: 1,  name: 'ROOKIE' },
    { at: 4,  name: 'MARKSMAN' },
    { at: 8,  name: 'SHARPSHOOTER' },
    { at: 12, name: 'DEADEYE' },
    { at: 17, name: 'ELITE' },
    { at: 22, name: 'ACE' },
    { at: 27, name: 'LEGEND' }
];

export function rankTitle (rank: number): string
{
    let name = TITLES[0].name;
    for (const t of TITLES) if (rank >= t.at) name = t.name;
    return name;
}
