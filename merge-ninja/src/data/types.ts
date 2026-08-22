export interface Ninja {
  readonly id: number;
  tier: number;
  slot: number;
}

/** Motion/VFX recipe only; it never replaces or recolours supplied character art. */
export type CombatStyle = 'blade' | 'projectile' | 'arcane' | 'storm' | 'void' | 'brute';

export interface CombatKit {
  /** Readable, frequent physical move. */
  basic: string;
  /** Less-frequent signature move with a distinct engine-driven VFX beat. */
  special: string;
  style: CombatStyle;
}

/**
 * Ninjas use four-frame strips; the creature bosses use bespoke eight-frame
 * strips with anatomy-specific anticipation, impact, and recovery.
 */
export type CombatAnimation = 'fourFrame' | 'eightFrame';

export interface TierDef {
  tier: number;
  name: string;
  /** Unique loaded texture for this tier; duplicates are prohibited by the roster data. */
  textureKey: string;
  spriteKey: string;
  accent: number;
  /** A gentle rank tint for repeat appearances; defaults to the native art. */
  artTint: number;
  attack: number;
  maxHealth: number;
  dps: number;
  combat: CombatKit;
  animation: 'fourFrame';
  vfx: { color: number; intensity: 1 | 2 | 3; ultimate: boolean };
}

export interface BossDef {
  stage: number;
  name: string;
  /** Unique boss identity from the curated boss ladder. */
  appearanceIndex: number;
  textureKey: string;
  spriteKey: string;
  artTint: number;
  accent: number;
  maxHealth: number;
  reward: number;
  attackDamage: number;
  scale: number;
  combat: CombatKit;
  animation: CombatAnimation;
}

/** Kept as an alias while the presentation layer transitions to boss naming. */
export type EnemyDef = BossDef;

export type DropTarget = { kind: 'slot'; slot: number } | { kind: 'trash' };
export type DropResult = 'merged' | 'moved' | 'swapped' | 'sold' | 'rejected';

export interface SessionMetrics {
  timePlayedMs: number;
  purchases: number;
  merges: number;
  sells: number;
  highestTier: number;
  bossDefeats: number;
  boardFullCount: number;
  coinsEarned: number;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
