import { BALANCE } from './balance';
import { bossCatalogPortrait, enemyFrame } from '../render/atlasConfig';
import type { BossDef, CombatAnimation, CombatKit } from './types';

/**
 * One unique visual identity per boss-stage slot; no boss texture is reused.
 * The first act stays human / ninja-forward. Animal and monster silhouettes
 * take over only once the player reaches the later boss stages.
 *
 * Stages 1-6 are deliberately plain (Training Dummy through Hooded Duelist):
 * PLAN.md's gentle-ramp intent got lost once every stage became a named boss
 * with its own portal entrance, and a 6-year-old's first opponent should not
 * need a word like "Executioner" sounded out. Stage 7 onward ramps back into
 * the existing ladder's vocabulary.
 */
const BOSS_NAMES = [
  'Training Dummy', 'Rookie Rival Ninja', 'Masked Bandit',
  'Bamboo Guard', 'Twin Blade Trainee', 'Hooded Duelist',
  'Ironfist Ninja', 'Copper Gear Enforcer', 'Copper Gear Brawler',
  'Chain Sickle Assassin', 'Caskblade Reaper', 'Rift Eye Adept',
  'Foxflame Warlord', 'Jade Staff Bruiser', 'Goldwing Duelist',
  'Cinderblade Warden', 'Abyssal Tentacle Ronin', 'Smokewisp Executioner',
  'Verdant Arrow Captain',
  'Frostbound Warhawk', 'Thornroot Colossus', 'Briar Fang Stalker',
  'Thorn Axe Warden', 'Tide Crown Leviathan', 'Orbital Void Construct',
  'Thornscale Raider', 'Stonefist Bear Chief', 'Tengu-Tengu Bio-Fused Bird',
  'Kappa Bio-Merge Frog', 'Nine-Tailed Kitsune Construct', 'Fused Spider Construct',
  'Oni-Ainu Totem Bear', 'Shadow Ninja Serpentine Dragon', 'Alchemical Bio-Dragon',
  'Clockwork Multi-Fanged Dragon', 'Bio-Mecha Hydra Dragon', 'Molten Dragon-Wolf Fusion',
] as const;

const ACCENTS = [
  0xc7d5e3, 0xd95248, 0x6fd8e6, 0xc88a55, 0xb9e8ff, 0xe35443,
  0x9fd7ff, 0xef5a4a, 0x7bdffc, 0x9473d6, 0xe7dcff, 0xa778dd,
] as const;

const BOSS_COMBAT_KITS: readonly CombatKit[] = [
  { basic: 'Serpent Bite', special: 'Shadow Coil', style: 'void' },
  { basic: 'Vial Volley', special: 'Alchemical Nova', style: 'arcane' },
  { basic: 'Gear Fang', special: 'Clockwork Barrage', style: 'projectile' },
  { basic: 'Hydra Cut', special: 'Multi-Head Storm', style: 'storm' },
  { basic: 'Kappa Cleave', special: 'Reefquake', style: 'brute' },
  { basic: 'Totem Crush', special: 'Oni Quake', style: 'brute' },
  { basic: 'Wing Slash', special: 'Feather Tempest', style: 'blade' },
  { basic: 'Charm Lance', special: 'Nine-Tail Eclipse', style: 'void' },
  { basic: 'Spider Scythe', special: 'Web Singularity', style: 'arcane' },
  { basic: 'Molten Claw', special: 'Cinder Breath', style: 'storm' },
];

/**
 * These silhouettes are animals or creatures, not humanoid weapon fighters.
 * Each owns a bespoke eight-frame source strip rather than inheriting the
 * humanoid transform choreography.
 */
const ANIMAL_BOSS_APPEARANCES = new Set<number>([
  22, 23, 24, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
]);

export function bossAnimationFor(appearance: number): CombatAnimation {
  return ANIMAL_BOSS_APPEARANCES.has(appearance) ? 'eightFrame' : 'fourFrame';
}

/** How many distinct boss identities exist before the late-game ladder loops. */
export const BOSS_COUNT = BOSS_NAMES.length;

/** Which boss identity a stage puts in the arena. */
export function bossIdentityFor(stage: number): number {
  return (Math.max(1, Math.floor(stage)) - 1) % BOSS_COUNT;
}

const textureKeyFor = (appearance: number): string =>
  bossCatalogPortrait(appearance)?.textureKey ?? 'boss_catalog_26';

/** Roster entry for a boss identity, independent of the stage it showed up at. */
export function bossIdentity(index: number): Omit<BossDef, 'stage' | 'maxHealth' | 'reward' | 'attackDamage' | 'scale'> {
  const safe = ((Math.floor(index) % BOSS_COUNT) + BOSS_COUNT) % BOSS_COUNT;
  const appearanceIndex = safe + 1;
  return {
    name: BOSS_NAMES[safe]!,
    appearanceIndex,
    textureKey: textureKeyFor(appearanceIndex),
    spriteKey: enemyFrame((appearanceIndex - 1) % 6),
    artTint: 0xffffff,
    accent: ACCENTS[safe % ACCENTS.length]!,
    combat: BOSS_COMBAT_KITS[safe % BOSS_COMBAT_KITS.length]!,
    animation: bossAnimationFor(appearanceIndex),
  };
}

const BOSS_TEXTURES = Array.from({ length: BOSS_COUNT }, (_, index) => bossIdentity(index).textureKey);
if (new Set(BOSS_TEXTURES).size !== BOSS_COUNT) {
  throw new Error('Every boss identity must have a distinct portrait texture');
}

export function bossForStage(stage: number): BossDef {
  const safeStage = Math.max(1, Math.floor(stage));
  const identity = bossIdentity(bossIdentityFor(safeStage));

  return {
    stage: safeStage,
    ...identity,
    maxHealth: Math.max(1, Math.round(BALANCE.boss.baseHp * BALANCE.boss.hpGrowth ** (safeStage - 1))),
    reward: Math.round(BALANCE.boss.defeatBonus * BALANCE.boss.defeatBonusGrowth ** (safeStage - 1)),
    attackDamage: Math.max(1, Math.round(BALANCE.boss.attackDamage * BALANCE.boss.attackDamageGrowth ** (safeStage - 1))),
    scale: BALANCE.boss.scale,
  };
}
