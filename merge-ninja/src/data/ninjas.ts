import { BALANCE } from './balance';
import { ninjaCatalogPortrait } from '../render/atlasConfig';
import type { CombatKit, TierDef } from './types';

/**
 * Every step has a bespoke silhouette / portrait source. Names describe the
 * visible weapon, armour, creature, or aura so the roster remains legible
 * without relying on a colour-only distinction.
 */
const NAMES = [
  'Hooded Fang', 'Frosthook Scout', 'Forest Bow Keeper', 'Jade Staff Sentinel',
  'Masked Signal Runner', 'Ironclad Shadow', 'Sickle Assassin', 'Scarlet Dualblade',
  'Caskblade Corsair', 'Copper Gear Brawler', 'Clockblade Tactician', 'Flame Shogun',
  'Phase Runner', 'Thornscale Tracker', 'Ember Bow Stalker', 'Sunshield Paladin',
  'Goldwing Crusader', 'Golden Wingblade', 'Coral Tidecaller', 'Tide Crown Weaver',
  'Smokewisp Reaper', 'Rift Walker', 'Coilblade Ronin', 'Eclipse Wraith',
  'Cinderblade Ronin', 'Thorn Axe Warden', 'Briar Fang Hunter', 'Orbital Void Seer',
  'Umbral Dragon Sovereign',
] as const;

const ACCENTS = [
  0x9a7454, 0xc85b4e, 0x6eaa68, 0xc5a65b, 0x4baec7, 0x8cb35c,
  0xaee9ff, 0x778595, 0xae83d6, 0xf1bf55, 0x7c5caa, 0xf0a33f,
] as const;

/** Pure presentation identity shared by the arena, attacks, and roster idle pose. */
export type NinjaVfxStyle =
  | 'tide' | 'twin' | 'umbral' | 'scarlet' | 'sun' | 'crescent'
  | 'frost' | 'rune' | 'storm' | 'dawn' | 'eclipse' | 'astral';

const VFX_STYLES: readonly NinjaVfxStyle[] = [
  'tide', 'twin', 'umbral', 'scarlet', 'sun', 'crescent',
  'frost', 'rune', 'storm', 'dawn', 'eclipse', 'astral',
];

const COMBAT_KITS: readonly CombatKit[] = [
  { basic: 'Gear Slash', special: 'Clockwork Overdrive', style: 'blade' },
  { basic: 'Time Needle', special: 'Chrono Burst', style: 'arcane' },
  { basic: 'Wing Cut', special: 'Skyward Dive', style: 'blade' },
  { basic: 'Shadow Talon', special: 'Dusk Cyclone', style: 'void' },
  { basic: 'Charm Strike', special: 'Foxfire Volley', style: 'arcane' },
  { basic: 'Totem Swing', special: 'Ground Break', style: 'brute' },
  { basic: 'Phase Cut', special: 'Static Dash', style: 'storm' },
  { basic: 'Twin Blade Cut', special: 'Coilblade Dance', style: 'blade' },
  { basic: 'Glitch Shuriken', special: 'Signal Storm', style: 'projectile' },
  { basic: 'Sickle Sweep', special: 'Moon Reap', style: 'void' },
  { basic: 'Cipher Cut', special: 'Data Storm', style: 'storm' },
  { basic: 'Rift Slice', special: 'Singularity Pull', style: 'arcane' },
];

const spriteKeyFor = (): string => 'ninja_t1';
const textureKeyFor = (tier: number): string => ninjaCatalogPortrait(tier)?.textureKey ?? 'ninja_catalog_27';

export const NINJAS: readonly TierDef[] = NAMES.map((name, index) => {
  const tier = index + 1;
  const accent = ACCENTS[index % ACCENTS.length]!;
  const dps = Math.max(
    1,
    Math.round(BALANCE.progression.dpsBase * BALANCE.progression.dpsGrowth ** index),
  );

  return {
    tier,
    name,
    textureKey: textureKeyFor(tier),
    spriteKey: spriteKeyFor(),
    accent,
    artTint: 0xffffff,
    attack: dps,
    maxHealth: Math.round(BALANCE.tiers.healthBase * BALANCE.tiers.healthGrowth ** index),
    dps,
    combat: COMBAT_KITS[index % COMBAT_KITS.length]!,
    animation: 'fourFrame',
    vfx: { color: accent, intensity: tier <= 3 ? 1 : tier <= 18 ? 2 : 3, ultimate: tier >= 25 },
  };
});

if (NINJAS.length !== BALANCE.tiers.count) {
  throw new Error(`Expected ${BALANCE.tiers.count} ninja tiers, found ${NINJAS.length}`);
}
if (new Set(NINJAS.map((ninja) => ninja.textureKey)).size !== NINJAS.length) {
  throw new Error('Every ninja tier must have a distinct portrait texture');
}

export function ninjaDef(tier: number): TierDef {
  return NINJAS[tier - 1] ?? NINJAS[0]!;
}

/** Stable visual language even if a future save has an out-of-range tier. */
export function ninjaVfxStyle(tier: number): NinjaVfxStyle {
  const safe = Math.max(0, Math.floor(tier) - 1);
  return VFX_STYLES[safe % VFX_STYLES.length]!;
}
