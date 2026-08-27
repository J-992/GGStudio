/** Lifetime collectible cosmetics. Pure data so saves, UI, and tests agree. */

export type DojoStyleId = 'classic' | 'crimson-dojo';

export interface DojoStylePalette {
  readonly frame: number;
  readonly panel: number;
  readonly panelDark: number;
  readonly plate: number;
  readonly accent: number;
  readonly accentBright: number;
  readonly board: number;
  readonly slot: number;
  readonly slotActive: number;
  readonly buy: number;
  readonly buyStroke: number;
  readonly bossAura: number;
  readonly ninjaAura: number;
  readonly vfx: number;
  readonly backgroundTint: number;
}

export interface DojoStyleDef {
  readonly id: DojoStyleId;
  readonly label: string;
  readonly description: string;
  readonly palette: DojoStylePalette;
}

export interface BossStickerDef {
  /** Stable save/telemetry id; never rename. */
  readonly id: string;
  readonly pageId: string;
  readonly stage: number;
  readonly slot: number;
  readonly rarity: 'bronze' | 'silver' | 'gold';
  readonly textureKey: string;
  readonly texturePath: string;
}

export interface StickerPageDef {
  readonly id: string;
  readonly label: string;
  readonly rewardStyleId: DojoStyleId;
  readonly stickers: readonly BossStickerDef[];
}

export const CLASSIC_DOJO_STYLE: DojoStyleDef = {
  id: 'classic',
  label: 'Classic Dojo',
  description: 'The original dojo colors.',
  palette: {
    frame: 0xffffff,
    panel: 0x8a5c3a,
    panelDark: 0x2b1d12,
    plate: 0xe8cf94,
    accent: 0xd9a441,
    accentBright: 0xffe58a,
    board: 0xffffff,
    slot: 0xffffff,
    slotActive: 0xffd23f,
    buy: 0x45b93d,
    buyStroke: 0x14520f,
    bossAura: 0xd66ac5,
    ninjaAura: 0x66e6a8,
    vfx: 0xffd35a,
    backgroundTint: 0xffffff,
  },
};

export const CRIMSON_DOJO_STYLE: DojoStyleDef = {
  id: 'crimson-dojo',
  label: 'Crimson Dojo',
  description: 'Lacquered crimson, warm gold, and victory-ink effects.',
  palette: {
    frame: 0xf4c96a,
    panel: 0x641f25,
    panelDark: 0x240d14,
    plate: 0xb62f35,
    accent: 0xd94a3f,
    accentBright: 0xffdf7c,
    board: 0x8e3033,
    slot: 0xf0b85c,
    slotActive: 0xffef91,
    buy: 0xb92f38,
    buyStroke: 0xffc85b,
    bossAura: 0xff4b45,
    ninjaAura: 0xffc85b,
    vfx: 0xff5b45,
    backgroundTint: 0xffd2c0,
  },
};

export const DOJO_STYLES: Readonly<Record<DojoStyleId, DojoStyleDef>> = {
  classic: CLASSIC_DOJO_STYLE,
  'crimson-dojo': CRIMSON_DOJO_STYLE,
};

const CRIMSON_STICKERS: readonly BossStickerDef[] = [
  {
    id: 'crimson-dojo-1', pageId: 'crimson-dojo', stage: 1, slot: 0, rarity: 'bronze',
    textureKey: 'sticker_crimson_dojo_1', texturePath: 'assets/stickers/crimson-dojo-seal-1.webp',
  },
  {
    id: 'crimson-dojo-2', pageId: 'crimson-dojo', stage: 5, slot: 1, rarity: 'silver',
    textureKey: 'sticker_crimson_dojo_2', texturePath: 'assets/stickers/crimson-dojo-seal-2.webp',
  },
  {
    id: 'crimson-dojo-3', pageId: 'crimson-dojo', stage: 10, slot: 2, rarity: 'gold',
    textureKey: 'sticker_crimson_dojo_3', texturePath: 'assets/stickers/crimson-dojo-seal-3.webp',
  },
] as const;

export const CRIMSON_DOJO_PAGE: StickerPageDef = {
  id: 'crimson-dojo',
  label: 'Crimson Dojo',
  rewardStyleId: 'crimson-dojo',
  stickers: CRIMSON_STICKERS,
};

export const STICKER_PAGES: readonly StickerPageDef[] = [CRIMSON_DOJO_PAGE];
export const BOSS_STICKERS: readonly BossStickerDef[] = STICKER_PAGES.flatMap((page) => page.stickers);

export function dojoStyle(id: DojoStyleId): DojoStyleDef {
  return DOJO_STYLES[id];
}

export function isDojoStyleId(value: unknown): value is DojoStyleId {
  return value === 'classic' || value === 'crimson-dojo';
}

export function bossStickerForStage(stage: number): BossStickerDef | null {
  const safe = Math.max(1, Math.floor(stage));
  return BOSS_STICKERS.find((sticker) => sticker.stage === safe) ?? null;
}

export function cleanStickerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set(BOSS_STICKERS.map((sticker) => sticker.id));
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && valid.has(id)))];
}

export function stickerPageProgress(page: StickerPageDef, collected: ReadonlySet<string>): {
  have: number;
  total: number;
  complete: boolean;
  next: BossStickerDef | null;
} {
  const have = page.stickers.filter((sticker) => collected.has(sticker.id)).length;
  return {
    have,
    total: page.stickers.length,
    complete: have === page.stickers.length,
    next: page.stickers.find((sticker) => !collected.has(sticker.id)) ?? null,
  };
}

export function isDojoStyleUnlocked(id: DojoStyleId, collected: ReadonlySet<string>): boolean {
  if (id === 'classic') return true;
  const page = STICKER_PAGES.find((candidate) => candidate.rewardStyleId === id);
  return page !== undefined && stickerPageProgress(page, collected).complete;
}

/**
 * Old builds knew only the highest stage reached. Reaching stage N proves that
 * every milestone below N was defeated; merely facing N does not prove it.
 */
export function legacyStickerIdsForReachedStage(reachedStage: number): string[] {
  const reached = Math.max(1, Math.floor(reachedStage));
  return BOSS_STICKERS.filter((sticker) => sticker.stage < reached).map((sticker) => sticker.id);
}

