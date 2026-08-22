/** The achievements rail button, kept out of the atlas as its own small icon. */
export const ACHIEVEMENTS_ICON_KEY = 'icon_achievements';
export const ACHIEVEMENTS_ICON_PATH = 'assets/ui/icon-achievements.png';

/** Dedicated raster assets for the New Ninja ceremony. */
export const REVEAL_ASSETS = {
  backdrop: { key: 'new_ninja_reveal_backdrop', path: 'assets/ui/new-ninja-reveal-backdrop.png' },
  halo: { key: 'new_ninja_reveal_halo', path: 'assets/ui/new-ninja-reveal-halo.png' },
  plinth: { key: 'new_ninja_reveal_plinth', path: 'assets/ui/new-ninja-reveal-plinth.png' },
  banner: { key: 'new_ninja_reveal_banner', path: 'assets/ui/new-ninja-reveal-banner.png' },
  button: { key: 'new_ninja_reveal_button', path: 'assets/ui/new-ninja-reveal-button.png' },
} as const;

/** Opaque-pixel bounds for frame zero of every ninja strip. */
export interface RevealNinjaRig {
  readonly frameW: number;
  readonly frameH: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const rig = (x: number, y: number, w: number, h: number, frame = 128): RevealNinjaRig => ({
  frameW: frame, frameH: frame, x, y, w, h,
});

/**
 * Reveal placement uses visible pixels rather than the full texture cell.
 * This matters most for tier 29: its wide dragon occupies only the bottom
 * 106px of a 256px frame and otherwise appears far below the modal centre.
 */
export const REVEAL_NINJA_RIGS: readonly RevealNinjaRig[] = [
  rig(13, 10, 101, 118), rig(8, 16, 112, 112), rig(8, 20, 112, 108),
  rig(8, 29, 112, 99), rig(8, 10, 112, 118), rig(8, 26, 112, 102),
  rig(8, 36, 112, 92), rig(8, 35, 112, 93), rig(13, 10, 102, 118),
  rig(8, 11, 112, 117), rig(9, 10, 110, 118), rig(19, 32, 90, 92),
  rig(8, 10, 111, 118), rig(13, 10, 102, 118), rig(8, 19, 112, 109),
  rig(8, 25, 112, 103), rig(8, 13, 112, 115), rig(8, 21, 112, 107),
  rig(8, 20, 112, 108), rig(8, 19, 112, 109), rig(8, 19, 112, 109),
  rig(13, 10, 102, 118), rig(8, 18, 112, 110), rig(8, 13, 112, 115),
  rig(17, 10, 94, 118), rig(16, 10, 96, 118), rig(10, 10, 108, 118),
  rig(8, 15, 112, 113), rig(4, 150, 248, 106, 256),
] as const;

export function revealNinjaRig(tier: number): RevealNinjaRig {
  return REVEAL_NINJA_RIGS[tier - 1] ?? REVEAL_NINJA_RIGS[0]!;
}
