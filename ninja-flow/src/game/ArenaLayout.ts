/** Shared world-space measurements for the imported garden. */

export const GARDEN_SCALE_X = 1.9;
export const GARDEN_SCALE_YZ = 1.15;
export const BRIDGE_DECK_LOCAL_Y = 1.86;
export const BRIDGE_HALF_SPAN = 3.42 * GARDEN_SCALE_X;
export const BRIDGE_RISE = (BRIDGE_DECK_LOCAL_Y - 1.1) * GARDEN_SCALE_YZ;
export const BRIDGE_RAIL_Z = 0.9 * GARDEN_SCALE_YZ;

/** The imported water surface after the garden's Y transform is applied. */
export const POND_SURFACE_Y = 1.06 * GARDEN_SCALE_YZ - BRIDGE_DECK_LOCAL_Y * GARDEN_SCALE_YZ;

/** World-space floor height of the arched bridge at horizontal position X. */
export function bridgeHeightAt(x: number): number {
  const t = Math.min(1, Math.abs(x) / BRIDGE_HALF_SPAN);
  return -BRIDGE_RISE * t * t;
}
