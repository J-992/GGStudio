export type FacePattern = string;

/**
 * A level is a list of slices. Each slice is 2 units of tunnel, and each of the
 * four faces carries a 5-character pattern — one character per column. Omitting
 * a face leaves it fully solid.
 *
 *   #   solid panel
 *   .   nothing; a hole in that face
 *   ~   crumble tile — breaks a beat after weight lands on it
 *   ^   launch pad — fires you off the face far higher than a jump
 *   <   conveyor belt, pushes toward column 0
 *   >   conveyor belt, pushes toward column 4
 *   =   slider — a platform tracking back and forth across the face
 *   +   slider running half a cycle behind "="
 *   !   shutter — a barrier rising out of the face on a cycle; lethal while up
 *   ?   shutter running half a cycle behind "!", so a "!?" pair always leaves
 *       exactly one lane open
 *
 * Columns run left to right on the floor and ceiling, bottom to top on the two
 * walls. Directions are stated in that column order, so a ">" belt on the left
 * wall pushes you up the wall.
 */
export interface SliceDef {
  f?: FacePattern;
  l?: FacePattern;
  r?: FacePattern;
  c?: FacePattern;
}

export type FaceKey = "f" | "l" | "r" | "c";

export const LEGAL_CHARS = "#.~^<>=+!?M";
export const SOLID_CHARS = "#^<>!?M";
export const FEATURE_CHARS = "^<>=+!?M";

export interface HintDef {
  atSlice: number;
  text: string;
  /** Shown instead of `text` on a touch device, where key names mean nothing. */
  touchText?: string;
}

export interface SpinnerDef {
  atSlice: number;
  speed?: number;
}

export interface LevelDef {
  name: string;
  /** Signed rotation in radians/second for a rigid whole-course drum. */
  drum?: { speed: number };
  /** Learning courses retry locally; challenge courses retain the run stakes. */
  localRetry?: boolean;
  /** Optional authored rewards; negative height invites a below-face swing. */
  elasticRewards?: { face: FaceKey; col: number; atSlice: number; height: number }[];
  slices: SliceDef[];
  hints?: HintDef[];
  spinners?: SpinnerDef[];
  /** Visual identity only; never changes collision or mechanic colors. */
  environment?: "dock" | "orbital" | "induction" | "transit" | "reactor";
  /** Authored phrase boundaries, also used for environmental signs. */
  beats?: { atSlice: number; label: string }[];
}
