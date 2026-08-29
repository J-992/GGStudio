/**
 * Data-driven arena theming for Merge Ninja.
 *
 * Pure data + pure functions: no Phaser imports, so the renderer, the
 * orchestrator and the test suite all consume this module directly.
 * Every `backdropKey` listed in THEMES_MANIFEST must be preloaded by
 * BootScene before a theme is applied.
 */

export type FloorStyle = 'planks' | 'stone';

export interface ArenaFloorStyle {
  readonly baseColor: number;
  readonly lightColor: number;
  readonly shadowColor: number;
  readonly plankOrStone: FloorStyle;
}

export interface ArenaTheme {
  /** Stable id (saves/analytics); never rename. */
  readonly id: string;
  readonly label: string;
  /** Inclusive [firstStage, lastStage]; null last stage = open-ended final act. */
  readonly stageRange: readonly [number, number | null];
  /** Preloaded texture key (see THEMES_MANIFEST). */
  readonly backdropKey: string;
  /** Perspective foreground strip paired with this backdrop. */
  readonly floorTextureKey: string;
  readonly accent: number;
  /** Sky tint pair for the runtime vignette wash above the backdrop. */
  readonly sky: { readonly top: number; readonly bottom: number };
  readonly floor: ArenaFloorStyle;
  readonly portalTint: number;
  readonly vfxTint: number;
}

export const ARENA_THEMES: readonly ArenaTheme[] = [
  {
    id: 'dojo-dusk',
    label: 'Dojo at Dusk',
    stageRange: [1, 9],
    backdropKey: 'dojo_night_backdrop',
    floorTextureKey: 'floor_dojo',
    accent: 0xffb45c,
    sky: { top: 0x181430, bottom: 0x4a2c50 },
    floor: { baseColor: 0x6b4a34, lightColor: 0x9c7248, shadowColor: 0x3f2a1e, plankOrStone: 'planks' },
    portalTint: 0xd98cff,
    vfxTint: 0xffc46b,
  },
  {
    id: 'mountain-temple',
    label: 'Mountain Temple',
    stageRange: [10, 18],
    backdropKey: 'arena_mountain',
    floorTextureKey: 'floor_temple',
    accent: 0xbfe8ff,
    sky: { top: 0x0c1226, bottom: 0x2e4666 },
    floor: { baseColor: 0x55606e, lightColor: 0x8fa0b2, shadowColor: 0x303a48, plankOrStone: 'stone' },
    portalTint: 0x8fd0ff,
    vfxTint: 0xaee6ff,
  },
  {
    id: 'storm-sea',
    label: 'Storm Sea',
    stageRange: [19, 27],
    backdropKey: 'arena_storm',
    floorTextureKey: 'floor_storm',
    accent: 0x8ff0ff,
    sky: { top: 0x10141f, bottom: 0x23304a },
    floor: { baseColor: 0x39424f, lightColor: 0x5f7186, shadowColor: 0x222a36, plankOrStone: 'stone' },
    portalTint: 0x7fe8ff,
    vfxTint: 0xc9f4ff,
  },
  {
    id: 'rift',
    label: 'The Rift',
    stageRange: [28, 36],
    backdropKey: 'arena_rift_stage',
    floorTextureKey: 'floor_rift',
    accent: 0xc06bff,
    sky: { top: 0x150b26, bottom: 0x3a1d5e },
    floor: { baseColor: 0x4a3f63, lightColor: 0x7a68a0, shadowColor: 0x2b2140, plankOrStone: 'stone' },
    portalTint: 0xb96bff,
    vfxTint: 0xd9a6ff,
  },
  {
    id: 'dragon-shrine',
    label: 'Dragon Shrine',
    stageRange: [37, null],
    backdropKey: 'arena_shrine',
    floorTextureKey: 'floor_shrine',
    accent: 0xffcf6b,
    sky: { top: 0x2a1030, bottom: 0x7a3b2a },
    floor: { baseColor: 0x5c4436, lightColor: 0x9a744c, shadowColor: 0x38251c, plankOrStone: 'stone' },
    portalTint: 0xffb95e,
    vfxTint: 0xffdf9a,
  },
] as const;

/** Every texture key the themed arenas depend on; keep in sync with BootScene preloads. */
export const THEMES_MANIFEST = [
  'dojo_night_backdrop',
  'arena_mountain',
  'arena_storm',
  'arena_rift_stage',
  'arena_shrine',
] as const;

/** Foreground strips are separate so tests catch a missing preload or pairing. */
export const FLOOR_THEMES_MANIFEST = [
  'floor_dojo',
  'floor_temple',
  'floor_storm',
  'floor_rift',
  'floor_shrine',
] as const;

export type ThemeManifestKey = (typeof THEMES_MANIFEST)[number];

/** Deterministic: stages below 1 clamp to 1, stage 37+ pins to the final act. */
export function themeForStage(stage: number): ArenaTheme {
  const s = Math.max(1, Math.floor(stage));
  let current = ARENA_THEMES[0]!;
  for (const t of ARENA_THEMES) {
    if (s >= t.stageRange[0]) current = t;
  }
  return current;
}

/** True when moving between stages crosses into a different act. */
export function themeTransition(fromStage: number, toStage: number): boolean {
  return themeForStage(fromStage).id !== themeForStage(toStage).id;
}
