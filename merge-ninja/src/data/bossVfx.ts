import { BOSS_COUNT } from './enemies';

/**
 * Pure data: which spawn choreography each boss identity performs.
 *
 * No Phaser here — this file only answers "what should identity N's entrance
 * look like". The arena turns a recipe into tweens and pooled VFX; tests can
 * assert on it in plain node.
 */

export type BossEntranceKind =
  | 'portal'
  | 'pillar'
  | 'riftTear'
  | 'summonCircle'
  | 'skyFall'
  | 'eruption';

export type BossMotif = 'flame' | 'bolt' | 'petal' | 'ember' | 'shadow' | 'spark' | 'void';

export type BossGroundImpact = 'none' | 'dust' | 'shockwave' | 'crack';

export interface BossSpawnVfxRecipe {
  /** 2-3 tint colors (0xRRGGBB) driving portal/aura/burst tints. */
  palette: number[];
  entrance: BossEntranceKind;
  motif: BossMotif;
  /** Multiplies every entrance tween duration; late dragons move slower and heavier. */
  timingScale: number;
  groundImpact: BossGroundImpact;
  /** 0 none, 1 small camera shake, 2 full capped shake on landing. */
  shake: 0 | 1 | 2;
  /** Index into the existing sfx name set ('strongHit' | 'newTier' | 'hit'). */
  soundVariant: 0 | 1 | 2;
  /** Roughly 1..2; scales burst sizes, trail counts, aura alpha. */
  intensity: number;
}

type FamilyName =
  | 'blade'
  | 'gear'
  | 'arcane'
  | 'spirit'
  | 'brute'
  | 'avian'
  | 'serpent'
  | 'beast'
  | 'void'
  | 'dragon';

const FAMILIES: Record<FamilyName, BossSpawnVfxRecipe> = {
  // First-act humanoids: classic gate portal, modest dust.
  blade: { palette: [0xd95248, 0xc7d5e3], entrance: 'portal', motif: 'spark', timingScale: 1, groundImpact: 'dust', shake: 1, soundVariant: 0, intensity: 1 },
  // Copper enforcers: hauled up a light pillar, gear-heavy landing.
  gear: { palette: [0xc88a55, 0xef5a4a], entrance: 'pillar', motif: 'spark', timingScale: .92, groundImpact: 'shockwave', shake: 1, soundVariant: 0, intensity: 1.1 },
  // Alchemists and rift casters: reality opens sideways.
  arcane: { palette: [0x9473d6, 0xe7dcff], entrance: 'riftTear', motif: 'void', timingScale: 1.05, groundImpact: 'none', shake: 1, soundVariant: 1, intensity: 1.15 },
  // Foxfire and wisp spirits: materialize inside a drawn circle.
  spirit: { palette: [0xa778dd, 0xe7dcff, 0x9fd7ff], entrance: 'summonCircle', motif: 'ember', timingScale: 1.15, groundImpact: 'none', shake: 0, soundVariant: 1, intensity: .9 },
  // Staff bruisers and colossi: shoved up through the floor.
  brute: { palette: [0x6fd8e6, 0x4a8f5c], entrance: 'eruption', motif: 'ember', timingScale: 1.05, groundImpact: 'crack', shake: 1, soundVariant: 0, intensity: 1.2 },
  // Winged fighters and warhawks: drop out of the sky.
  avian: { palette: [0xb9e8ff, 0xe35443], entrance: 'skyFall', motif: 'spark', timingScale: .95, groundImpact: 'dust', shake: 1, soundVariant: 2, intensity: 1.05 },
  // Leviathans and tentacle horrors: surge up like a wave.
  serpent: { palette: [0x6fd8e6, 0x35608f], entrance: 'skyFall', motif: 'void', timingScale: 1.1, groundImpact: 'shockwave', shake: 1, soundVariant: 2, intensity: 1.25 },
  // Mid-roster animals: ground erupts under them.
  beast: { palette: [0x4a8f5c, 0xc88a55], entrance: 'eruption', motif: 'ember', timingScale: 1.05, groundImpact: 'dust', shake: 1, soundVariant: 0, intensity: 1.15 },
  // Rift constructs: punched through by something else.
  void: { palette: [0x9473d6, 0x2b2440], entrance: 'pillar', motif: 'shadow', timingScale: 1.1, groundImpact: 'shockwave', shake: 1, soundVariant: 1, intensity: 1.3 },
  // Late-game dragons: heaviest choreography in the game.
  dragon: { palette: [0xef5a4a, 0x2b2440, 0xffe7a3], entrance: 'skyFall', motif: 'flame', timingScale: 1.25, groundImpact: 'crack', shake: 2, soundVariant: 0, intensity: 1.5 },
};

/** Family membership per identity (matches src/data/enemies.ts roster order). */
const IDENTITY_FAMILY: readonly FamilyName[] = [
  // Chronofog .. Masked Signal: first-act humanoid ladder.
  'blade', 'blade', 'arcane', 'blade', 'blade', 'blade',
  // Ironfist .. Rift Eye Adept.
  'blade', 'gear', 'gear', 'blade', 'blade', 'void',
  // Foxflame .. Verdant Arrow.
  'spirit', 'brute', 'avian', 'blade', 'serpent', 'spirit', 'blade',
  // Frostbound Warhawk .. Thornscale Raider.
  'avian', 'brute', 'beast', 'beast', 'serpent', 'void', 'beast',
  // Stonefist Bear Chief .. Molten Dragon-Wolf Fusion.
  'beast', 'avian', 'beast', 'spirit', 'void', 'beast',
  'dragon', 'dragon', 'dragon', 'dragon', 'dragon',
];

if (IDENTITY_FAMILY.length !== BOSS_COUNT) {
  throw new Error('Every boss identity must map to a spawn-vfx family');
}

/** Hand-tuned per-identity flavor where the family default is not enough. */
const OVERRIDES: Record<number, Partial<BossSpawnVfxRecipe>> = {
  4: { motif: 'bolt', palette: [0x9fd7ff, 0x2b2440] }, // Glitchblade Raider
  10: { motif: 'shadow', palette: [0x2b2440, 0xa778dd] }, // Caskblade Reaper
  12: { entrance: 'portal', motif: 'flame', palette: [0xef5a4a, 0xffe7a3] }, // Foxflame Warlord
  14: { shake: 0 }, // Goldwing Duelist lands light for a fencer
  15: { motif: 'flame', palette: [0xef5a4a, 0xc88a55] }, // Cinderblade Warden
  17: { motif: 'shadow', palette: [0x66707a, 0xa778dd] }, // Smokewisp Executioner
  18: { motif: 'petal', palette: [0x4a8f5c, 0xe7dcff] }, // Verdant Arrow Captain
  23: { entrance: 'eruption', timingScale: 1.15 }, // Tide Crown Leviathan surges up
  27: { groundImpact: 'shockwave', shake: 2, timingScale: 1.15, intensity: 1.4, palette: [0xb9e8ff, 0x9473d6] }, // Tengu-Tengu storm dive
  // Late-game creatures (26+): strongest entrances, always shake 2.
  26: { entrance: 'eruption', groundImpact: 'crack', shake: 2, timingScale: 1.15, intensity: 1.4 }, // Stonefist Bear Chief
  28: { entrance: 'eruption', groundImpact: 'shockwave', shake: 2, timingScale: 1.1, intensity: 1.35 }, // Kappa Bio-Merge Frog
  29: { entrance: 'eruption', motif: 'flame', groundImpact: 'crack', shake: 2, soundVariant: 1, timingScale: 1.2, intensity: 1.45 }, // Nine-Tailed Kitsune Construct
  30: { entrance: 'eruption', groundImpact: 'crack', shake: 2, timingScale: 1.2, intensity: 1.45 }, // Fused Spider Construct
  31: { entrance: 'eruption', motif: 'flame', groundImpact: 'crack', shake: 2, timingScale: 1.2, intensity: 1.5 }, // Oni-Ainu Totem Bear
  32: { entrance: 'skyFall', motif: 'shadow', palette: [0x2b2440, 0xa778dd], shake: 2, timingScale: 1.25, intensity: 1.5 }, // Shadow Ninja Serpentine Dragon
  33: { entrance: 'eruption', motif: 'ember', palette: [0x9473d6, 0xe7dcff, 0xef5a4a], shake: 2, timingScale: 1.2, intensity: 1.45 }, // Alchemical Bio-Dragon
  34: { entrance: 'skyFall', motif: 'bolt', palette: [0x9fd7ff, 0x2b2440, 0xffe7a3], shake: 2, timingScale: 1.15, intensity: 1.5 }, // Clockwork Multi-Fanged Dragon
  35: { entrance: 'eruption', motif: 'void', palette: [0x9473d6, 0x2b2440, 0x6fd8e6], shake: 2, timingScale: 1.3, intensity: 1.65 }, // Bio-Mecha Hydra Dragon
  36: { entrance: 'eruption', motif: 'flame', palette: [0xef5a4a, 0xffe7a3, 0x2b2440], shake: 2, timingScale: 1.35, intensity: 1.8 }, // Molten Dragon-Wolf Fusion
};

const clampTiming = (value: number): number => Math.max(.8, Math.min(1.4, value));

/** Deterministic: the same identity always resolves to the same recipe. */
export function bossSpawnRecipe(identity: number): BossSpawnVfxRecipe {
  const safe = ((Math.floor(identity) % BOSS_COUNT) + BOSS_COUNT) % BOSS_COUNT;
  const base = FAMILIES[IDENTITY_FAMILY[safe]!]!;
  const override = OVERRIDES[safe];
  const recipe: BossSpawnVfxRecipe = override ? { ...base, ...override } : { ...base };
  recipe.palette = [...recipe.palette];
  recipe.timingScale = clampTiming(recipe.timingScale);
  return recipe;
}
