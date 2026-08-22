import { BOOSTS } from './boosts';
import { Gift, boostGift, coinGift, perkGift, skinGift } from './gifts';
import { boostCount, dailyStreak, perkLevel, unownedSkins, upgradablePerks } from '../core/state';

/**
 * The daily present.
 *
 * The mystery box is paid for in runs; this one is paid for in days, and it is
 * the only thing in the game a player can collect without firing a shot. That
 * is the whole job it does: it gives somebody who has not opened the app since
 * yesterday a reason that is already waiting for them on the menu.
 *
 * So it never pays in coins if it can help it. Coins are a number going up in
 * a corner -- what brings a player back tomorrow is a boost sitting in the bag
 * for the run they are about to play, a permanent upgrade they did not have to
 * save for, or a face on the board. Coins only turn up when the player owns
 * literally everything else, which is the one case where a box has to pay in
 * something rather than nothing.
 */

/** Picks one entry, in proportion to its weight. */
function weighted<T extends { weight: number }> (list: T[]): T
{
    let total = 0;
    for (const it of list) total += it.weight;

    let roll = Math.random() * total;

    for (const it of list)
    {
        roll -= it.weight;
        if (roll <= 0) return it;
    }

    return list[list.length - 1];
}

function pick<T> (list: T[]): T
{
    return list[Math.floor(Math.random() * list.length)];
}

/**
 * How many of a boost a day pays. A week of days back to back is worth more
 * than the seventh day on its own -- the stack is where the streak is felt,
 * because it is the number the player reads on the tile.
 */
function boostStack (streak: number): number
{
    if (streak >= 7) return 3;
    if (streak >= 3) return 2;

    return 1;
}

function dailyBoost (streak: number): Gift
{
    const room = BOOSTS.filter(b => boostCount(b.id) < b.max);

    if (room.length === 0) return coinGift(900);

    const boost = pick(room);
    const fits = Math.max(1, boost.max - boostCount(boost.id));

    return boostGift(boost.id, Math.min(boostStack(streak), fits));
}

/**
 * What today's present holds: a boost, a permanent upgrade, or a skin.
 *
 * The three are weighted rather than even. A boost is the safe one and turns
 * up most, because it is spent inside the next run and the player sees it
 * work. A skin is the rare one, so that the day it lands is a day worth
 * having been there for -- and a streak of a week pushes those odds up, which
 * is the only reward the streak itself pays.
 */
export function rollDaily (streak = dailyStreak()): Gift
{
    const perks = upgradablePerks();
    const skins = unownedSkins();

    const table: { weight: number; make: () => Gift }[] = [
        { weight: 46, make: () => dailyBoost(streak) }
    ];

    if (perks.length > 0)
    {
        table.push({ weight: 32, make: () =>
        {
            const perk = pick(perks);
            const room = perk.max - perkLevel(perk.id);

            //  A double level is the week's bonus, but never more levels than
            //  the upgrade has left -- the tile has to promise what it pays.
            return perkGift(perk.id, Math.min(streak >= 7 ? 2 : 1, room));
        } });
    }

    if (skins.length > 0)
    {
        table.push({ weight: streak >= 7 ? 34 : 22, make: () => skinGift(pick(skins)) });
    }

    return weighted(table).make();
}
