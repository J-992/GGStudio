import { DENSITY } from '../core/theme';
import { FINAL_LEVEL, TargetKind } from './levels';

/**
 * The cash round.
 *
 * Every fifth cleared level the blast doors open onto the vault instead of the
 * next arena: no goal, no way to lose the run -- a few seconds of money and a
 * gun already pointed at it.
 *
 * The clock is the only rule in the room. What the player shoots is banked the
 * moment it is shot; what is still standing when the clock stops is left
 * behind. Nothing is swept up at the end, which is the only thing making the
 * round worth playing quickly, and it is deliberately short enough that the
 * player is still greedy when it ends.
 */

/** A cash round drops in after every Nth level cleared. */
export const BONUS_EVERY = 5;

/** True when clearing `level` should hand the player the vault. */
export function isBonusAfter (level: number): boolean
{
    return level > 0 && level < FINAL_LEVEL && level % BONUS_EVERY === 0;
}

export interface BonusConfig
{
    /** Seconds of money. */
    duration: number;
    spawnRate: number;
    maxActive: number;
    size: number;
    lifetime: number;
    speed: number;
    moveChance: number;
    weights: Partial<Record<TargetKind, number>>;
}

/**
 * Every kill nudges a multiplier that never falls back, so the round pays more
 * the longer it goes and the last second is always the loudest one.
 */
export const CASH_STEP = 5;
export const CASH_MAX = 5;

export function cashMult (kills: number): number
{
    return Math.min(CASH_MAX, 1 + Math.floor(kills / CASH_STEP));
}

/**
 * Late rounds pay more, but gently -- the vault is a treat, not the economy.
 * A player who reaches level 35 is worth about twice one who reached level 5.
 */
export function cashScale (level: number): number
{
    return 1 + level * 0.03;
}

export function bonusConfig (level: number): BonusConfig
{
    const cfg: BonusConfig = {
        duration: 7,
        spawnRate: 175,
        maxActive: 9,
        size: 46,
        lifetime: 2400,
        speed: 60,
        moveChance: 0.5,
        //  Mostly loose bills, a fair few stacks, and the odd jackpot.
        weights: { cash: 10, stack: 4, vault: 1 }
    };

    //  Deeper runs get a slightly busier vault, on top of the wider one a wide
    //  screen already earns.
    const wide = Math.min(1.5, DENSITY) * (1 + Math.min(0.35, level * 0.01));

    cfg.maxActive = Math.round(cfg.maxActive * wide);
    cfg.spawnRate = Math.round(cfg.spawnRate / wide);

    return cfg;
}

/** Weighted pick from the vault's spawn table. */
export function pickMoney (weights: Partial<Record<TargetKind, number>>): TargetKind
{
    let total = 0;
    for (const k in weights) total += weights[k as TargetKind] || 0;

    let roll = Math.random() * total;

    for (const k in weights)
    {
        roll -= weights[k as TargetKind] || 0;
        if (roll <= 0) return k as TargetKind;
    }

    return 'cash';
}
