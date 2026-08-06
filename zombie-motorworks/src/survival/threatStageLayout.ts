/**
 * Where the threat alert stands its subjects and where it puts the camera.
 *
 * Split out of `ThreatAlert` because it is the part that can be wrong without
 * looking broken: a camera that clips a boss's head or leaves two subjects
 * half out of frame renders perfectly happily. Pure numbers here, and
 * `unit/threat-stage-layout.test.ts` projects the result and checks that every
 * subject actually lands inside the frustum.
 */

/** Footprint of one thing on the stage, in world metres. */
export interface StageSubjectSize {
  readonly heightM: number;
  /** Posed width. Also stands in for depth, since the subject turns. */
  readonly widthM: number;
}

export interface StageLayout {
  /** Stage-space x for each subject, in the order given. */
  readonly positionsX: readonly number[];
  readonly cameraY: number;
  readonly cameraZ: number;
  /** Height the camera is aimed at. Camera x and look-at x are both 0. */
  readonly lookAtY: number;
}

/** Metres of clear ground between two subjects sharing one stage. */
export const SUBJECT_GAP_M = 0.9;
/** Fraction of the frame the subjects fill, on whichever axis binds first. */
export const FRAME_FILL = 0.86;
export const CAMERA_FOV_DEG = 30;
/** How far the camera is lifted above the subjects' mid-height. Barely. */
export const CAMERA_PITCH_DEG = 5;

/**
 * A turning subject sweeps its own diagonal, so the width the camera has to
 * clear is larger than the width it was measured at. Sizing off the diagonal
 * of a square footprint keeps a subject inside the frame at every yaw rather
 * than only at the one it was measured in.
 */
const TURN_SWEEP = Math.SQRT2;

export function layoutThreatStage(
  sizes: readonly StageSubjectSize[],
  aspect: number,
): StageLayout {
  if (sizes.length === 0) {
    return { positionsX: [], cameraY: 0, cameraZ: 1, lookAtY: 0 };
  }

  const swept = sizes.map((size) => Math.max(0.4, size.widthM) * TURN_SWEEP);
  const totalWidth =
    swept.reduce((sum, width) => sum + width, 0) +
    SUBJECT_GAP_M * (sizes.length - 1);

  const tallest = Math.max(...sizes.map((size) => Math.max(0.1, size.heightM)));
  const halfVFovTan = Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  const halfHFovTan = halfVFovTan * Math.max(aspect, 0.1);
  const heightDistance = tallest / 2 / FRAME_FILL / halfVFovTan;
  // A wide stage has to clear horizontally too, or two subjects sit half out
  // of frame at whatever distance the tallest one alone wanted.
  const widthDistance = totalWidth / 2 / FRAME_FILL / halfHFovTan;
  // Half the deepest subject, so the near face of a turning body cannot swing
  // in front of the camera on a stage that is only as deep as it is tall.
  const distance =
    Math.max(heightDistance, widthDistance) + Math.max(...swept) / 2;

  // The stage element is far wider than it is tall, so a stage framed on its
  // height alone leaves most of the width empty and huddles two subjects
  // together in the middle of it. Spend that spare width on the gap between
  // them — it costs nothing, since pulling further back was never needed.
  const bodyWidth = swept.reduce((sum, width) => sum + width, 0);
  const usableWidth = 2 * distance * halfHFovTan * FRAME_FILL;
  const span =
    sizes.length > 1
      ? Math.max(totalWidth, Math.min(usableWidth, bodyWidth * 3))
      : totalWidth;
  const gap = sizes.length > 1 ? (span - bodyWidth) / (sizes.length - 1) : 0;

  const positionsX: number[] = [];
  let cursor = -span / 2;
  for (const width of swept) {
    positionsX.push(cursor + width / 2);
    cursor += width + gap;
  }

  // The camera sits barely above the subjects' own mid-height, so a boss fills
  // the frame looking down at you rather than being looked down on.
  const pitch = (CAMERA_PITCH_DEG * Math.PI) / 180;
  const lookAtY = tallest / 2;
  return {
    positionsX,
    cameraY: lookAtY + Math.sin(pitch) * distance,
    cameraZ: Math.cos(pitch) * distance,
    lookAtY,
  };
}
