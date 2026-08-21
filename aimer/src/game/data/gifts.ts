import { BOOSTS, BOOST_BY_ID } from './boosts';
import { SKIN_BY_ID, TargetSkin } from './skins';
import type { BodyShape } from '../core/shapes';
import {
    bankCoins, boostCount, grantBoost, grantSkin, saveMeta, unownedSkins
} from '../core/state';
import { fmt } from '../core/theme';

/**
 * The mystery present, and everything that can come out of one.
 *
 * A run that ends with a card of numbers ends. A run that ends with a wrapped
 * box the player has to open ends *somewhere* -- and what comes out is a face
 * on the board, which is the one reward in the game they keep seeing for the
 * rest of the week. So the first box is not random where it matters: it is
 * always a photograph, always one they do not own, and it is worn the moment
 * it lands.
 *
 * After that the box is a spinner: boosts for the next run, coins for the
 * store, and the rest of the wardrobe. Nothing in here can be a blank -- a
 * present that pays nothing teaches the player not to open the next one.
 */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export const RARITY: Record<Rarity, { label: string; color: number }> = {
    common:    { label: 'COMMON',    color: 0x8d97bd },
    rare:      { label: 'RARE',      color: 0x3fe0ff },
    epic:      { label: 'EPIC',      color: 0xb388ff },
    legendary: { label: 'LEGENDARY', color: 0xffc857 }
};

export type GiftKind = 'skin' | 'boost' | 'coins';

export interface Gift
{
    kind: GiftKind;
    /** Skin id or boost id. Empty for coins. */
    id: string;
    /** Boosts handed over, or coins paid. Always 1 for a skin. */
    amount: number;
    /** What the reveal calls it. */
    name: string;
    /** One line under the name, in the player's words. */
    sub: string;
    color: number;
    rarity: Rarity;
    /** Icon texture name, for the prizes that are drawn as a glyph. */
    icon?: string;
    /** Skin decal name, when the prize has a face to show off. */
    art?: string;
    /** Body silhouette, for a skin whose whole point is its shape. */
    shape?: BodyShape;
}

function pick<T> (list: T[]): T
{
    return list[Math.floor(Math.random() * list.length)];
}

/** How loud a shelf of the wardrobe is allowed to be about itself. */
const SKIN_RARITY: Record<string, Rarity> = {
    photo: 'legendary',
    crew: 'epic',
    core: 'epic',
    flags: 'rare'
};

/**
 * How often each shelf turns up once the guaranteed face is spent. Flags are
 * the filler and photographs are the prize, so the odds run the opposite way
 * to the price list.
 */
const SKIN_WEIGHT: Record<string, number> = { flags: 4, core: 2, crew: 2, photo: 1 };

export function skinGift (skin: TargetSkin): Gift
{
    return {
        kind: 'skin',
        id: skin.id,
        amount: 1,
        name: skin.name,
        sub: skin.blurb,
        color: skin.accent,
        rarity: SKIN_RARITY[skin.group] || 'rare',
        art: skin.art,
        shape: skin.shape
    };
}

export function boostGift (id: string, amount: number): Gift
{
    const boost = BOOST_BY_ID[id];

    return {
        kind: 'boost',
        id,
        amount,
        name: `${boost.name} x${amount}`,
        sub: boost.blurb,
        color: boost.color,
        rarity: amount >= 3 ? 'epic' : (amount === 2 ? 'rare' : 'common'),
        icon: boost.icon
    };
}

export function coinGift (amount: number): Gift
{
    return {
        kind: 'coins',
        id: '',
        amount,
        name: `${fmt(amount)} COINS`,
        sub: 'STRAIGHT INTO THE STORE',
        color: 0xffc857,
        rarity: amount >= 2000 ? 'epic' : (amount >= 800 ? 'rare' : 'common'),
        icon: 'coins'
    };
}

/** The coin bags, and how often each one is the one. */
const COIN_BAGS: { amount: number; weight: number }[] = [
    { amount: 350, weight: 5 },
    { amount: 900, weight: 3 },
    { amount: 2200, weight: 1 }
];

/** How many of a boost come at once. */
const BOOST_STACKS: { amount: number; weight: number }[] = [
    { amount: 1, weight: 6 },
    { amount: 2, weight: 3 },
    { amount: 3, weight: 1 }
];

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

/** A boost the bag still has room for, so a present is never wasted. */
function roomyBoosts (): typeof BOOSTS
{
    const room = BOOSTS.filter(b => boostCount(b.id) < b.max);
    return room.length > 0 ? room : BOOSTS;
}

function rollBoost (): Gift
{
    const boost = pick(roomyBoosts());
    const stack = weighted(BOOST_STACKS);
    const room = Math.max(1, boost.max - boostCount(boost.id));

    return boostGift(boost.id, Math.min(stack.amount, room));
}

function rollCoins (): Gift
{
    return coinGift(weighted(COIN_BAGS).amount);
}

function rollSkin (): Gift | null
{
    const left = unownedSkins();

    if (left.length === 0) return null;

    const weights = left.map(s => ({ skin: s, weight: SKIN_WEIGHT[s.group] || 1 }));

    return skinGift(weighted(weights).skin);
}

/**
 * What the box actually holds.
 *
 * The very first one is a photograph the player does not own, no roll made --
 * see the note at the top of this file. Everything after it is the spinner.
 *
 * `first` is passed in rather than read from the save, because the present has
 * usually already been booked as opened by the time the roll is made and the
 * answer would be wrong.
 */
export function rollGift (first: boolean): Gift
{
    if (first)
    {
        const faces = unownedSkins('photo');
        if (faces.length > 0) return skinGift(pick(faces));
    }

    const skin = rollSkin();
    const table: { weight: number; make: () => Gift }[] = [
        { weight: 42, make: rollBoost },
        { weight: 28, make: rollCoins }
    ];

    if (skin) table.push({ weight: 30, make: () => skin });

    return weighted(table).make();
}

/** How many tiles the reel is long, and where in it the real prize sits. */
const REEL_LEN = 32;
const REEL_WIN = REEL_LEN - 5;

/**
 * The strip of tiles the spinner flies through, with the prize sitting five
 * from the end so there is still reel to the right of it when it stops.
 *
 * The decoys are rolled the same way the prize was, so the strip is an honest
 * advertisement for the box rather than a wall of things that never drop.
 */
export function reelFor (prize: Gift): { items: Gift[]; win: number }
{
    const items: Gift[] = [];

    for (let i = 0; i < REEL_LEN; i++)
    {
        if (i === REEL_WIN) { items.push(prize); continue; }

        //  Decoys are cosmetic, so they may repeat what the player owns and
        //  may repeat the prize -- a reel that never shows the prize twice
        //  tells the player where it is going to stop.
        const roll = Math.random();

        if (roll < 0.34) items.push(rollCoins());
        else if (roll < 0.72) items.push(rollBoost());
        else items.push(decoySkin());
    }

    return { items, win: REEL_WIN };
}

/** Any skin at all, for the reel to fly past. Owned ones are fine as scenery. */
function decoySkin (): Gift
{
    const ids = Object.keys(SKIN_BY_ID).filter(id => SKIN_BY_ID[id].cost > 0);
    const skin = SKIN_BY_ID[pick(ids)];

    return skin ? skinGift(skin) : coinGift(350);
}

/**
 * Pays the present out.
 *
 * A skin the player somehow already owns, or a bag with no room left, is
 * turned into coins rather than dropped on the floor: the box always pays.
 * Returns what was actually banked, which is what the reveal says out loud.
 */
export function grantGift (gift: Gift): Gift
{
    if (gift.kind === 'coins')
    {
        bankCoins(gift.amount);
        saveMeta();
        return gift;
    }

    if (gift.kind === 'skin')
    {
        if (grantSkin(gift.id)) return gift;

        const fallback = coinGift(Math.max(350, Math.round((SKIN_BY_ID[gift.id]?.cost || 700) / 2)));
        bankCoins(fallback.amount);
        saveMeta();

        return fallback;
    }

    const fitted = grantBoost(gift.id, gift.amount);

    if (fitted > 0) return fitted === gift.amount ? gift : boostGift(gift.id, fitted);

    const fallback = coinGift(Math.max(350, (BOOST_BY_ID[gift.id]?.cost || 700) * gift.amount));
    bankCoins(fallback.amount);
    saveMeta();

    return fallback;
}
