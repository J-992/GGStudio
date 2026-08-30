import { PALETTE } from './ProceduralProps';

/**
 * Maps Downtown City MegaKit material names onto the game's own palette.
 *
 * The kit ships ~130 MB of 4K PBR textures which this game does not want: they
 * are semi-realistic, and every other surface in the world is flat-shaded from
 * {@link PALETTE}. `scripts/extract-assets.mjs` therefore strips all texture
 * references at extraction time and keeps only material *names*, which is the
 * one piece of authoring intent that survives - and it turns out to be the only
 * piece needed, because the kit names materials by what they represent
 * (`MI_RedBrick`, `MI_Glass`) rather than by index.
 *
 * Anything unmapped falls back to the coastal cream, matching the "colorful
 * coastal city" palette the rest of the building/rooftop surfaces now use.
 */

/** A darkened coastal teal for glazing depth - `FakeInterior` needs to read
 *  as a shadowed room behind the glass, not another coat of the same bright
 *  teal the glass itself uses. Derived rather than a new named palette
 *  entry: this one role is the only thing that wants it. */
const GLASS_INTERIOR = 0x2f6d61;

export const MEGAKIT_COLORS: Readonly<Record<string, number>> = {
  // Masonry - the warm brick tone from the coastal building palette.
  MI_RedBrick: PALETTE.coastalPeach,
  MI_RedBrick_Pale: PALETTE.coastalCream,
  MI_Concrete: PALETTE.coastalBlue,
  MI_Asphalt: PALETTE.coastalBlue,

  // Painted trim and plaster.
  MI_Trim: PALETTE.coastalCream,
  MI_Trim_Dark: PALETTE.roofSand,
  MI_Trim_MetalConcrete: PALETTE.coastalBlue,
  MI_MarbleFloor: PALETTE.coastalCream,

  // Glazing. `FakeInterior` is the flat card behind each window that stands in
  // for a room, so it wants to read as depth rather than as a surface.
  MI_Glass: PALETTE.coastalTeal,
  MI_FakeInterior: GLASS_INTERIOR,
  MI_FakeInterior_1: GLASS_INTERIOR,
  MI_FakeInterior_2: GLASS_INTERIOR,
  MI_FakeInterior_3: GLASS_INTERIOR,
  MI_FakeInterior_4: GLASS_INTERIOR,
};

/**
 * The inside face of every wall panel. Facades are assembled as closed boxes, so
 * this is never visible and is dropped at build time rather than drawn.
 */
export const MEGAKIT_INTERIOR_MATERIAL = 'MI_InteriorWall';

export function megaKitColor(materialName: string | undefined): number {
  if (!materialName) return PALETTE.coastalCream;
  return MEGAKIT_COLORS[materialName] ?? PALETTE.coastalCream;
}
